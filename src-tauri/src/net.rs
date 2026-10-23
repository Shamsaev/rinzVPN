//! Сетевые команды: пинг, резолв, загрузка подписки.

use serde::Serialize;
use std::net::IpAddr;
use std::time::{Duration, Instant};
use tokio::net::{lookup_host, TcpStream};

const USER_AGENT: &str = concat!("rinzVPN/", env!("CARGO_PKG_VERSION"), " v2rayN/7.0");

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
