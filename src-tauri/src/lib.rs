mod bridge;
mod commands;
mod db;
mod fs_ops;
mod protocol;
mod sanitize;
mod vault;

use std::path::PathBuf;
use std::sync::Arc;

use tauri::Emitter;
use tauri::Manager;
use vault::AppState;

/// M0 双向桥演示保留（ping 的事件模式将被同步引擎复用）
#[tauri::command]
fn ping(app: tauri::AppHandle, message: String) -> Result<bridge::EchoPayload, String> {
    let payload = bridge::build_echo(&message, bridge::now_unix_ms(), "lanmark-core");
    app.emit(bridge::ECHO_EVENT, payload.clone())
        .map_err(|e| e.to_string())?;
    Ok(payload)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let state = Arc::new(vault::AppState::default());
    let protocol_state = Arc::clone(&state);
    tauri::Builder::default()
        // vault:// 协议：笔记内相对路径（图片等）→ vault 内真实文件
        .register_asynchronous_uri_scheme_protocol("vault", move |_ctx, request, responder| {
            let state = Arc::clone(&protocol_state);
            let path = request.uri().path().to_string();
            tauri::async_runtime::spawn(async move {
                let file = tauri::async_runtime::spawn_blocking(move || protocol::resolve(&state, &path))
                    .await
                    .ok()
                    .flatten();
                responder.respond(protocol::respond(file));
            });
        })
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        // 日志：stdout（无头 E2E / 终端可见 WebView console）+ 日志文件
        .plugin(
            tauri_plugin_log::Builder::new()
                .targets([
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Stdout),
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::LogDir {
                        file_name: Some("lanmark".to_string()),
                    }),
                ])
                .build(),
        )
        .manage(state.clone())
        // 启动时自动打开上次配置的 vault（重索引 + 恢复 DB）
        .setup(|app| {
            let handle = app.handle().clone();
            let state = app.state::<Arc<AppState>>().inner().clone();
            tauri::async_runtime::spawn(async move {
                let cfg = vault::load_config(&handle);
                if let Some(p) = cfg.vault_path.filter(|p| !p.is_empty()) {
                    let path = PathBuf::from(p);
                    if path.is_dir() {
                        if let Err(e) = commands::open_vault_at(&state, &path) {
                            eprintln!("自动打开 vault 失败: {e}");
                        }
                    }
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            ping,
            commands::vault_status,
            commands::vault_pick_and_set,
            commands::vault_open_path,
            commands::reindex_vault,
            commands::tree_list,
            commands::note_create,
            commands::folder_create,
            commands::entry_rename,
            commands::entry_move,
            commands::entry_delete,
            commands::note_read,
            commands::note_write,
            commands::search,
            commands::recents_list,
            commands::favorites_list,
            commands::favorite_toggle,
            commands::asset_save,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
