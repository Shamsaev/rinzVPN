//! Управление ядрами: xray (протоколы) и sing-box (TUN).

use crate::platform::{self, KillOnCloseJob, ProxySnapshot};
use serde::Serialize;
use std::collections::VecDeque;
use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager};

const MAX_LOG_LINES: usize = 600;
const PROXY_MARKER: &str = "proxy-marker.txt";

/// Если в прошлый раз приложение упало с включённым системным прокси — выключаем его.
pub fn cleanup_stale_proxy(app: &AppHandle) {
    let Ok(dir) = runtime_dir(app) else { return };
    let marker = dir.join(PROXY_MARKER);
    if let Ok(ours) = std::fs::read_to_string(&marker) {
        if let Ok(cur) = platform::read_proxy() {
            if cur.enable == 1 && cur.server == ours.trim() {
                let _ = platform::write_proxy(&ProxySnapshot { enable: 0, ..cur });
            }
        }
        let _ = std::fs::remove_file(marker);
    }
}

/// Свободные TCP-порты на 127.0.0.1 (берём у системы и сразу освобождаем).
pub fn free_ports(n: usize) -> Result<Vec<u16>, String> {
    let listeners: Vec<_> = (0..n)
        .map(|_| std::net::TcpListener::bind("127.0.0.1:0"))
        .collect::<Result<_, _>>()
        .map_err(|e| format!("Не удалось подобрать свободный порт: {e}"))?;
    listeners.iter().map(|l| l.local_addr().map(|a| a.port()).map_err(|e| e.to_string())).collect()
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Mode {
    Proxy,
    Tun,
}

#[derive(Clone, Debug, Serialize)]
pub struct LogLine {
    pub ts: u64,
    pub source: &'static str,
    pub line: String,
}

#[derive(Clone, Debug, Serialize)]
pub struct Status {
    pub running: bool,
    pub mode: Option<Mode>,
    pub started_at: Option<u64>,
}

#[derive(Default)]
struct Running {
    xray: Option<Child>,
    singbox: Option<Child>,
    mode: Option<Mode>,
    started_at: Option<u64>,
    proxy_before: Option<ProxySnapshot>,
    /// адрес, который мы прописали в системный прокси
    proxy_server: Option<String>,
    /// растёт при каждом старте/стопе — сторожевой поток по нему понимает,
    /// что сессия, за которой он следил, уже закончилась
    generation: u64,
}

pub struct CoreManager {
    running: Mutex<Running>,
    logs: Arc<Mutex<VecDeque<LogLine>>>,
    job: Option<KillOnCloseJob>,
}

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

impl CoreManager {
    pub fn new() -> Self {
        Self {
            running: Mutex::new(Running::default()),
            logs: Arc::new(Mutex::new(VecDeque::new())),
            job: KillOnCloseJob::new(),
        }
    }

    pub fn status(&self) -> Status {
        let r = self.running.lock().unwrap();
        Status { running: r.xray.is_some(), mode: r.mode, started_at: r.started_at }
    }

    pub fn logs(&self) -> Vec<LogLine> {
        self.logs.lock().unwrap().iter().cloned().collect()
    }

    pub fn clear_logs(&self) {
        self.logs.lock().unwrap().clear();
    }

    fn push_log(app: &AppHandle, logs: &Arc<Mutex<VecDeque<LogLine>>>, source: &'static str, line: String) {
        let entry = LogLine { ts: now_ms(), source, line };
        {
            let mut l = logs.lock().unwrap();
            if l.len() >= MAX_LOG_LINES {
                l.pop_front();
            }
            l.push_back(entry.clone());
        }
        let _ = app.emit("core-log", entry);
    }

    fn pipe_output<R: Read + Send + 'static>(&self, app: &AppHandle, source: &'static str, stream: R) {
        let app = app.clone();
        let logs = self.logs.clone();
        std::thread::spawn(move || {
            let mut reader = BufReader::new(stream);
            let mut buf = Vec::new();
            loop {
                buf.clear();
                match reader.read_until(b'\n', &mut buf) {
                    Ok(0) | Err(_) => break,
                    Ok(_) => {
                        let line = String::from_utf8_lossy(&buf).trim_end().to_string();
                        if !line.is_empty() {
                            Self::push_log(&app, &logs, source, line);
                        }
                    }
                }
            }
        });
    }

    fn spawn_core(&self, app: &AppHandle, source: &'static str, bin: &Path, args: &[&str], cwd: &Path) -> Result<Child, String> {
        let mut cmd = Command::new(bin);
        cmd.args(args)
            .current_dir(cwd)
            .env("XRAY_LOCATION_ASSET", cwd)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        platform::hide_console(&mut cmd);
        let mut child = cmd.spawn().map_err(|e| format!("Не удалось запустить {source}: {e}"))?;
        if let Some(job) = &self.job {
            job.assign(&child);
        }
        if let Some(out) = child.stdout.take() {
            self.pipe_output(app, source, out);
        }
        if let Some(err) = child.stderr.take() {
            self.pipe_output(app, source, err);
        }
        Ok(child)
    }

    /// Ждёт `dur`; если процесс за это время умер — возвращает ошибку.
    fn ensure_alive(child: &mut Child, source: &str, dur: Duration) -> Result<(), String> {
        let deadline = Instant::now() + dur;
        while Instant::now() < deadline {
            if let Ok(Some(code)) = child.try_wait() {
                return Err(format!("{source} завершился сразу после запуска (код {code}). Подробности — в журнале."));
            }
            std::thread::sleep(Duration::from_millis(100));
        }
        Ok(())
    }

    fn last_log_lines(&self, source: &str, n: usize) -> String {
        let l = self.logs.lock().unwrap();
        let lines: Vec<_> = l.iter().filter(|e| e.source == source).rev().take(n).map(|e| e.line.clone()).collect();
        lines.into_iter().rev().collect::<Vec<_>>().join("\n")
    }

    pub fn start(
        &self,
        app: &AppHandle,
        mode: Mode,
        xray_config: &str,
        singbox_config: Option<&str>,
        http_port: u16,
    ) -> Result<Status, String> {
        self.stop(app, None);

        let cores = cores_dir(app)?;
        let xray_bin = cores.join(platform::exe_name("xray"));
        if !xray_bin.exists() {
            return Err(format!("Не найдено ядро Xray: {}. Запустите scripts/fetch-cores.ps1 и пересоберите приложение.", xray_bin.display()));
        }
        let runtime = runtime_dir(app)?;
        let xray_cfg = runtime.join("xray.json");
        std::fs::write(&xray_cfg, xray_config).map_err(|e| format!("Не удалось записать конфиг: {e}"))?;
        let xray_cfg_s = xray_cfg.to_string_lossy().to_string();

        // 1. проверяем конфиг — так ошибка ключа будет понятной, а не «процесс упал»
        let mut test = Command::new(&xray_bin);
        test.args(["run", "-test", "-c", &xray_cfg_s]).current_dir(&cores);
        platform::hide_console(&mut test);
        let out = test.output().map_err(|e| format!("Не удалось запустить Xray: {e}"))?;
        if !out.status.success() {
            let text = String::from_utf8_lossy(&out.stdout).to_string() + &String::from_utf8_lossy(&out.stderr);
            let reason = text.lines().filter(|l| !l.trim().is_empty()).last().unwrap_or("неизвестная ошибка").to_string();
            Self::push_log(app, &self.logs, "xray", text.trim().to_string());
            return Err(format!("Xray не принял конфиг: {reason}"));
        }

        if mode == Mode::Tun && !platform::is_elevated() {
            return Err("NEED_ADMIN".into());
        }

        // 2. xray
        let mut xray = self.spawn_core(app, "xray", &xray_bin, &["run", "-c", &xray_cfg_s], &cores)?;
        if let Err(e) = Self::ensure_alive(&mut xray, "Xray", Duration::from_millis(500)) {
            let tail = self.last_log_lines("xray", 3);
            return Err(if tail.is_empty() { e } else { format!("{e}\n{tail}") });
        }

        // 3. режим
        let mut singbox = None;
        let mut proxy_before = None;
        let mut proxy_server = None;
        match mode {
            Mode::Tun => {
                let sb_bin = cores.join(platform::exe_name("sing-box"));
                if !sb_bin.exists() {
                    let _ = xray.kill();
                    return Err(format!("Не найдено ядро sing-box: {}", sb_bin.display()));
                }
                let sb_cfg = runtime.join("singbox.json");
                std::fs::write(&sb_cfg, singbox_config.ok_or("Нет конфига для TUN")?)
                    .map_err(|e| format!("Не удалось записать конфиг: {e}"))?;
                let sb_cfg_s = sb_cfg.to_string_lossy().to_string();
                let runtime_s = runtime.to_string_lossy().to_string();
                let mut sb = match self.spawn_core(app, "sing-box", &sb_bin, &["run", "-c", &sb_cfg_s, "-D", &runtime_s], &cores) {
                    Ok(c) => c,
                    Err(e) => {
                        let _ = xray.kill();
                        return Err(e);
                    }
                };
                if let Err(e) = Self::ensure_alive(&mut sb, "sing-box", Duration::from_millis(1500)) {
                    let _ = xray.kill();
                    let tail = self.last_log_lines("sing-box", 3);
                    return Err(if tail.is_empty() { e } else { format!("{e}\n{tail}") });
                }
                singbox = Some(sb);
            }
            Mode::Proxy => match platform::enable_proxy(http_port) {
                Ok(before) => {
                    let ours = platform::our_proxy_server(http_port);
                    // метка: если приложение упадёт, при следующем запуске выключим этот прокси
                    let _ = std::fs::write(runtime.join(PROXY_MARKER), &ours);
                    proxy_before = Some(before);
                    proxy_server = Some(ours);
                }
                Err(e) => {
                    let _ = xray.kill();
                    return Err(format!("Не удалось включить системный прокси: {e}"));
                }
            },
        }

        let generation = {
            let mut r = self.running.lock().unwrap();
            r.generation += 1;
            r.xray = Some(xray);
            r.singbox = singbox;
            r.mode = Some(mode);
            r.started_at = Some(now_ms());
            r.proxy_before = proxy_before;
            r.proxy_server = proxy_server;
            r.generation
        };
        self.spawn_watchdog(app.clone(), generation);
        let st = self.status();
        let _ = app.emit("core-status", &st);
        Ok(st)
    }

    /// Останавливает ядра и возвращает прокси как было. `reason` уходит во фронтенд.
    pub fn stop(&self, app: &AppHandle, reason: Option<String>) {
        let was_running;
        {
            let mut r = self.running.lock().unwrap();
            was_running = r.xray.is_some();
            r.generation += 1;
            for child in [r.singbox.take(), r.xray.take()].into_iter().flatten() {
                let mut c = child;
                let _ = c.kill();
                let _ = c.wait();
            }
            let ours = r.proxy_server.take();
            if let Some(before) = r.proxy_before.take() {
                // если до нас прокси был наш же (после падения) — просто выключаем
                let restore = if Some(&before.server) == ours.as_ref() {
                    ProxySnapshot { enable: 0, ..before }
                } else {
                    before
                };
                let _ = platform::write_proxy(&restore);
                if let Ok(dir) = runtime_dir(app) {
                    let _ = std::fs::remove_file(dir.join(PROXY_MARKER));
                }
            }
            r.mode = None;
            r.started_at = None;
        }
        if was_running {
            #[derive(Serialize, Clone)]
            struct Stopped {
                reason: Option<String>,
            }
            let _ = app.emit("core-stopped", Stopped { reason });
            let _ = app.emit("core-status", self.status());
        }
    }

    /// Следит, чтобы ядра не умерли молча: если умерли — чистим за ними и сообщаем.
    fn spawn_watchdog(&self, app: AppHandle, generation: u64) {
        std::thread::spawn(move || loop {
            std::thread::sleep(Duration::from_secs(1));
            let state = app.state::<CoreManager>();
            let dead = {
                let mut r = state.running.lock().unwrap();
                if r.generation != generation {
                    return;
                }
                let x = r.xray.as_mut().map(|c| matches!(c.try_wait(), Ok(Some(_)))).unwrap_or(false);
                let s = r.singbox.as_mut().map(|c| matches!(c.try_wait(), Ok(Some(_)))).unwrap_or(false);
                if x {
                    Some("Ядро Xray неожиданно завершилось")
                } else if s {
                    Some("sing-box (TUN) неожиданно завершился")
                } else {
                    None
                }
            };
            if let Some(reason) = dead {
                state.stop(&app, Some(reason.to_string()));
                return;
            }
        });
    }
}

pub fn cores_dir(app: &AppHandle) -> Result<PathBuf, String> {
    // Рядом с exe (портативный режим / dev), иначе — в ресурсах установленного приложения.
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let p = dir.join("cores");
            if p.join(platform::exe_name("xray")).exists() {
                return Ok(p);
            }
        }
    }
    let res = app.path().resource_dir().map_err(|e| e.to_string())?;
    Ok(res.join("cores"))
}

pub fn runtime_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?.join("runtime");
    std::fs::create_dir_all(&dir).map_err(|e| format!("Не удалось создать папку {}: {e}", dir.display()))?;
    Ok(dir)
}

/// Запускает отдельный xray для проверки пинга (не трогает основное подключение).
/// Возвращает процесс; вызывающий обязан его завершить.
pub fn spawn_test_core(app: &AppHandle, config: &str) -> Result<Child, String> {
    let cores = cores_dir(app)?;
    let xray_bin = cores.join(platform::exe_name("xray"));
    if !xray_bin.exists() {
        return Err("Не найдено ядро Xray".into());
    }
    let cfg = runtime_dir(app)?.join("xray-test.json");
    std::fs::write(&cfg, config).map_err(|e| format!("Не удалось записать конфиг: {e}"))?;
    let mut cmd = Command::new(&xray_bin);
    cmd.args(["run", "-c", &cfg.to_string_lossy()])
        .current_dir(&cores)
        .env("XRAY_LOCATION_ASSET", &cores)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped());
    platform::hide_console(&mut cmd);
    let child = cmd.spawn().map_err(|e| format!("Не удалось запустить Xray: {e}"))?;
    if let Some(job) = &app.state::<CoreManager>().job {
        job.assign(&child);
    }
    Ok(child)
}
