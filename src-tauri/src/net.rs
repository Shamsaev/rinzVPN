//! Сетевые команды: пинг, резолв, загрузка подписки.

use serde::Serialize;
use std::net::IpAddr;
use std::time::{Duration, Instant};
use tauri::AppHandle;
use tokio::net::{lookup_host, TcpStream};

const USER_AGENT: &str = concat!("Nebo/", env!("CARGO_PKG_VERSION"), " v2rayN/7.0");

async fn resolve(host: &str) -> Result<IpAddr, String> {
    if let Ok(ip) = host.parse::<IpAddr>() {
        return Ok(ip);
    }
    let addrs: Vec<_> = lookup_host((host, 0)).await.map_err(|e| format!("Не удалось найти {host}: {e}"))?.collect();
    addrs
        .iter()
        .find(|a| a.is_ipv4())
        .or(addrs.first())
        .map(|a| a.ip())
        .ok_or_else(|| format!("Не удалось найти {host}"))
}

/// Время TCP-соединения до сервера в мс (без учёта DNS).
#[tauri::command]
pub async fn tcp_ping(host: String, port: u16) -> Result<u32, String> {
    let ip = resolve(&host).await?;
    let start = Instant::now();
    tokio::time::timeout(Duration::from_secs(4), TcpStream::connect((ip, port)))
        .await
        .map_err(|_| "таймаут".to_string())?
        .map_err(|e| e.to_string())?;
    Ok(start.elapsed().as_millis() as u32)
}

#[tauri::command]
pub async fn resolve_host(host: String) -> Result<String, String> {
    Ok(resolve(&host).await?.to_string())
}

#[derive(Serialize)]
pub struct SubscriptionResponse {
    body: String,
    userinfo: Option<String>,
    title: Option<String>,
    update_interval: Option<String>,
}

/// Подписку качаем из Rust, а не из webview — так не мешает CORS.
#[tauri::command]
pub async fn fetch_subscription(url: String) -> Result<SubscriptionResponse, String> {
    let client = reqwest::Client::builder()
        .no_proxy()
        .user_agent(USER_AGENT)
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|e| e.to_string())?;
    let resp = client.get(&url).send().await.map_err(|e| format!("Подписка недоступна: {e}"))?;
    let status = resp.status();
    if !status.is_success() {
        return Err(format!("Сервер подписки ответил {status}"));
    }
    let header = |name: &str| resp.headers().get(name).and_then(|v| v.to_str().ok()).map(String::from);
    let userinfo = header("subscription-userinfo");
    let title = header("profile-title");
    let update_interval = header("profile-update-interval");
    let body = resp.text().await.map_err(|e| e.to_string())?;
    Ok(SubscriptionResponse { body, userinfo, title, update_interval })
}

#[tauri::command]
pub fn free_ports(count: usize) -> Result<Vec<u16>, String> {
    crate::core::free_ports(count.clamp(1, 512))
}

const TEST_URL: &str = "https://www.gstatic.com/generate_204";

async fn delay_via(port: u16) -> Option<u32> {
    let proxy = reqwest::Proxy::all(format!("socks5h://127.0.0.1:{port}")).ok()?;
    let client = reqwest::Client::builder()
        .no_proxy()
        .proxy(proxy)
        .timeout(Duration::from_secs(8))
        .build()
        .ok()?;
    let start = Instant::now();
    let resp = client.get(TEST_URL).send().await.ok()?;
    let ok = resp.status().as_u16() == 204 || resp.status().is_success();
    ok.then(|| start.elapsed().as_millis() as u32)
}

/// Настоящий пинг: поднимаем отдельный xray, где у каждого сервера свой SOCKS-порт,
/// и через каждый делаем запрос на generate_204. `None` — сервер не ответил.
#[tauri::command]
pub async fn url_test(app: AppHandle, config: String, ports: Vec<u16>) -> Result<Vec<Option<u32>>, String> {
    let mut child = crate::core::spawn_test_core(&app, &config)?;

    // ждём, пока xray начнёт слушать порты
    let first = *ports.first().ok_or("Нет серверов для проверки")?;
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        if TcpStream::connect(("127.0.0.1", first)).await.is_ok() {
            break;
        }
        if let Ok(Some(_)) = child.try_wait() {
            let mut err = String::new();
            if let Some(mut e) = child.stderr.take() {
                use std::io::Read;
                let _ = e.read_to_string(&mut err);
            }
            let reason = err.lines().filter(|l| !l.trim().is_empty()).last().unwrap_or("").to_string();
            return Err(format!("Xray не запустился для проверки: {reason}"));
        }
        if Instant::now() > deadline {
            let _ = child.kill();
            return Err("Xray не запустился для проверки".into());
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }

    let mut set = tokio::task::JoinSet::new();
    for (i, port) in ports.iter().copied().enumerate() {
        set.spawn(async move { (i, delay_via(port).await) });
    }
    let mut results = vec![None; ports.len()];
    while let Some(Ok((i, r))) = set.join_next().await {
        results[i] = r;
    }
    let _ = child.kill();
    let _ = child.wait();
    Ok(results)
}
