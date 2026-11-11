mod core;
mod net;
mod platform;

use crate::core::{CoreManager, LogLine, Mode, Status};
use std::sync::Mutex;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, RunEvent, State, WindowEvent};

/// Пункт меню трея «Подключить / Отключить» — меняем его текст по состоянию.
struct TrayToggle(Mutex<Option<MenuItem<tauri::Wry>>>);

// ---------------- команды для фронтенда ----------------

#[tauri::command]
async fn connect(
    app: AppHandle,
    mode: Mode,
    xray_config: String,
    singbox_config: Option<String>,
    http_port: u16,
) -> Result<Status, String> {
    // запуск ядер блокирующий (ждём проверку конфига) — уводим с UI-потока
    tauri::async_runtime::spawn_blocking(move || {
        let core = app.state::<CoreManager>();
        core.start(&app, mode, &xray_config, singbox_config.as_deref(), http_port)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn disconnect(app: AppHandle) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        app.state::<CoreManager>().stop(&app, None);
    })
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
fn status(core: State<CoreManager>) -> Status {
    core.status()
}

#[tauri::command]
fn get_logs(core: State<CoreManager>) -> Vec<LogLine> {
    core.logs()
}

#[tauri::command]
fn clear_logs(core: State<CoreManager>) {
    core.clear_logs()
}

#[tauri::command]
fn is_elevated() -> bool {
    platform::is_elevated()
}

#[tauri::command]
fn launch_args() -> Vec<String> {
    std::env::args().skip(1).collect()
}

#[tauri::command]
async fn relaunch_as_admin(app: AppHandle, connect_after: bool) -> Result<(), String> {
    app.state::<CoreManager>().stop(&app, None);
    platform::relaunch_as_admin(if connect_after { "--connect" } else { "" })?;
    app.exit(0);
    Ok(())
}

#[tauri::command]
fn set_tray_state(app: AppHandle, toggle: State<TrayToggle>, connected: bool, server: Option<String>) {
    if let Some(item) = toggle.0.lock().unwrap().as_ref() {
        let _ = item.set_text(if connected { "Отключить" } else { "Подключить" });
    }
    if let Some(tray) = app.tray_by_id("main") {
        let tip = match (connected, server) {
            (true, Some(s)) => format!("rinzVPN — подключено\n{s}"),
            (true, None) => "rinzVPN — подключено".to_string(),
            _ => "rinzVPN — отключено".to_string(),
        };
        let _ = tray.set_tooltip(Some(tip));
    }
}

fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

fn build_tray(app: &tauri::App) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show", "Открыть rinzVPN", true, None::<&str>)?;
    let toggle = MenuItem::with_id(app, "toggle", "Подключить", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Выход", true, None::<&str>)?;
    let sep = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(app, &[&show, &toggle, &sep, &quit])?;
    app.state::<TrayToggle>().0.lock().unwrap().replace(toggle);

    let mut builder = TrayIconBuilder::with_id("main")
        .tooltip("rinzVPN — отключено")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => show_main(app),
            // подключение собирает конфиг на фронтенде — просим его
            "toggle" => {
                let _ = app.emit("tray-toggle", ());
            }
            "quit" => {
                app.state::<CoreManager>().stop(app, None);
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                show_main(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .manage(CoreManager::new())
        .manage(TrayToggle(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![
            connect,
            disconnect,
            status,
            get_logs,
            clear_logs,
            is_elevated,
            launch_args,
            relaunch_as_admin,
            set_tray_state,
            net::tcp_ping,
            net::resolve_host,
            net::fetch_subscription,
            net::free_ports,
            net::url_test,
        ])
        .setup(|app| {
            // если в прошлый раз упали с включённым прокси — выключаем
            core::cleanup_stale_proxy(app.handle());
            build_tray(app)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            // крестик прячет окно в трей, а не закрывает VPN
            if let WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("не удалось запустить rinzVPN");

    app.run(|app, event| {
        if let RunEvent::Exit = event {
            app.state::<CoreManager>().stop(app, None);
        }
    });
}
