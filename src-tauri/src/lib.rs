mod bridge;

use bridge::{build_echo, now_unix_ms, EchoPayload, ECHO_EVENT};
use tauri::Emitter;

/// 前端 → Rust：最简单的 invoke 命令
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {name}! 这条回复来自 Lanmark 的 Rust core。")
}

/// 双向桥演示：invoke 直接返回一个载荷，同时通过事件通道回推同一载荷。
/// M3 的同步引擎将大量使用「命令触发 + 事件回推」这个模式。
#[tauri::command]
fn ping(app: tauri::AppHandle, message: String) -> Result<EchoPayload, String> {
    let payload = build_echo(&message, now_unix_ms(), "lanmark-core");
    app.emit(ECHO_EVENT, payload.clone())
        .map_err(|e| e.to_string())?;
    Ok(payload)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![greet, ping])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
