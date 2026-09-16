//! Tauri 命令层：薄封装，业务在 fs_ops / db / vault 模块。
//! 约定：所有路径参数均为 vault 相对路径（'/' 分隔）；未打开 vault 时返回错误。

use std::path::PathBuf;
use std::sync::Arc;

use rusqlite::Connection;
use serde::Serialize;
use tauri::State;

use crate::db;
use crate::fs_ops::{self, Node};
use crate::vault::{self, AppState, AppConfig};

pub type CmdResult<T> = Result<T, String>;

fn with_db<T>(
    state: &Arc<AppState>,
    f: impl FnOnce(&Connection) -> CmdResult<T>,
) -> CmdResult<T> {
    let guard = state.db.lock().map_err(|_| "DB 锁中毒")?;
    let conn = guard.as_ref().ok_or("尚未打开 vault")?;
    f(conn)
}

fn with_vault<T>(state: &Arc<AppState>, f: impl FnOnce(&PathBuf) -> CmdResult<T>) -> CmdResult<T> {
    let guard = state.vault.lock().map_err(|_| "vault 锁中毒")?;
    let vault = guard.as_ref().ok_or("尚未打开 vault")?;
    f(vault)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultStatus {
    pub configured: bool,
    pub open: bool,
    pub path: Option<String>,
}

#[tauri::command]
pub fn vault_status(app: tauri::AppHandle, state: State<Arc<AppState>>) -> CmdResult<VaultStatus> {
    let cfg = vault::load_config(&app);
    let open = state.vault.lock().map_err(|_| "锁中毒")?.is_some();
    Ok(VaultStatus {
        configured: cfg.vault_path.is_some(),
        open,
        path: cfg.vault_path.clone(),
    })
}

/// 打开（或创建）vault：文件夹选择对话框 → 校验/初始化 → 写配置 → 开库 → 重索引。
#[tauri::command]
pub fn vault_pick_and_set(app: tauri::AppHandle, state: State<Arc<AppState>>, mode: String) -> CmdResult<String> {
    use tauri_plugin_dialog::DialogExt;

    let picked = app
        .dialog()
        .file()
        .blocking_pick_folder()
        .ok_or("已取消选择")?;
    let path: PathBuf = picked
        .into_path()
        .map_err(|e| format!("路径无效: {e}"))?;
    if !path.is_dir() {
        return Err("所选路径不是目录".into());
    }

    match mode.as_str() {
        "create" => {
            // 允许空目录；若目录里已有笔记则拒绝，避免误吞
            let has_notes = std::fs::read_dir(&path)
                .map(|rd| {
                    rd.filter_map(|e| e.ok())
                        .any(|e| e.file_name().to_string_lossy().ends_with(".md"))
                })
                .unwrap_or(false);
            if has_notes {
                return Err("所选目录已包含 .md 笔记，请改用「打开」模式".into());
            }
        }
        "open" => {}
        _ => return Err(format!("未知模式: {mode}")),
    }

    open_vault_at(&state, &path)?;
    let cfg = AppConfig { vault_path: Some(path.to_string_lossy().to_string()) };
    vault::save_config(&app, &cfg).map_err(|e| format!("保存配置失败: {e}"))?;
    Ok(path.to_string_lossy().to_string())
}

/// 直接按路径打开 vault（设置页 / 测试用）
#[tauri::command]
pub fn vault_open_path(state: State<Arc<AppState>>, path: String) -> CmdResult<String> {
    let p = PathBuf::from(&path);
    if !p.is_dir() {
        return Err(format!("目录不存在: {path}"));
    }
    open_vault_at(&state, &p)?;
    Ok(path)
}

pub fn open_vault_at(state: &Arc<AppState>, path: &PathBuf) -> CmdResult<()> {
    fs_ops::ensure_layout(path).map_err(|e| format!("初始化 vault 失败: {e}"))?;
    let db_path = path.join(fs_ops::META_DIR).join("lanmark.db");
    let conn = Connection::open(&db_path).map_err(|e| format!("打开数据库失败: {e}"))?;
    conn.pragma_update(None, "journal_mode", "WAL").ok();
    db::init_db(&conn).map_err(|e| format!("初始化数据库失败: {e}"))?;
    {
        let mut vg = state.vault.lock().map_err(|_| "锁中毒")?;
        let mut dg = state.db.lock().map_err(|_| "锁中毒")?;
        fs_ops::reindex(path, &conn).map_err(|e| format!("重索引失败: {e}"))?;
        *vg = Some(path.clone());
        *dg = Some(conn);
    }
    Ok(())
}

#[tauri::command]
pub fn reindex_vault(state: State<Arc<AppState>>) -> CmdResult<usize> {
    with_vault(&state, |vault| {
        with_db(&state, |conn| {
            fs_ops::reindex(vault, conn).map_err(|e| e.to_string())
        })
    })
}

#[tauri::command]
pub fn tree_list(state: State<Arc<AppState>>) -> CmdResult<Vec<Node>> {
    with_vault(&state, |vault| {
        fs_ops::list_tree(vault).map_err(|e| e.to_string())
    })
}

#[tauri::command]
pub fn note_create(state: State<Arc<AppState>>, dir: String, name: String) -> CmdResult<Node> {
    with_vault(&state, |vault| {
        with_db(&state, |conn| {
            let node = fs_ops::create_note(vault, &dir, &name).map_err(|e| e.to_string())?;
            db::upsert_file(conn, &node.path, node.title.as_deref().unwrap_or(""), "", fs_ops::now_ms(), "", true)
                .map_err(|e| e.to_string())?;
            Ok(node)
        })
    })
}

#[tauri::command]
pub fn folder_create(state: State<Arc<AppState>>, dir: String, name: String) -> CmdResult<Node> {
    with_vault(&state, |vault| {
        fs_ops::create_folder(vault, &dir, &name).map_err(|e| e.to_string())
    })
}

#[tauri::command]
pub fn entry_rename(state: State<Arc<AppState>>, path: String, new_name: String) -> CmdResult<String> {
    with_vault(&state, |vault| {
        with_db(&state, |conn| {
            fs_ops::rename_entry(vault, &path, &new_name, conn).map_err(|e| e.to_string())
        })
    })
}

#[tauri::command]
pub fn entry_move(state: State<Arc<AppState>>, path: String, new_dir: String) -> CmdResult<String> {
    with_vault(&state, |vault| {
        with_db(&state, |conn| {
            fs_ops::move_entry(vault, &path, &new_dir, conn).map_err(|e| e.to_string())
        })
    })
}

#[tauri::command]
pub fn entry_delete(state: State<Arc<AppState>>, path: String) -> CmdResult<String> {
    with_vault(&state, |vault| {
        with_db(&state, |conn| {
            fs_ops::delete_entry(vault, &path, conn).map_err(|e| e.to_string())
        })
    })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteContent {
    pub content: String,
    pub title: String,
}

/// 读取笔记内容，同时记入「最近」
#[tauri::command]
pub fn note_read(state: State<Arc<AppState>>, path: String) -> CmdResult<NoteContent> {
    with_vault(&state, |vault| {
        let content = fs_ops::read_note(vault, &path).map_err(|e| e.to_string())?;
        with_db(&state, |conn| {
            db::record_recent(conn, &path, fs_ops::now_ms(), 50).map_err(|e| e.to_string())?;
            let title = fs_ops::title_from_stem(path.rsplit('/').next().unwrap_or(&path));
            Ok(NoteContent { content, title })
        })
    })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WriteResult {
    pub mtime_ms: i64,
    pub hash: String,
}

#[tauri::command]
pub fn note_write(state: State<Arc<AppState>>, path: String, content: String) -> CmdResult<WriteResult> {
    with_vault(&state, |vault| {
        with_db(&state, |conn| {
            let (mtime_ms, hash) =
                fs_ops::write_note(vault, &path, &content, conn).map_err(|e| e.to_string())?;
            Ok(WriteResult { mtime_ms, hash })
        })
    })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    pub path: String,
    pub title: String,
    pub snippet: String,
}

#[tauri::command]
pub fn search(state: State<Arc<AppState>>, query: String) -> CmdResult<Vec<SearchHit>> {
    with_db(&state, |conn| {
        Ok(db::search(conn, &query, 50)
            .map_err(|e| e.to_string())?
            .into_iter()
            .map(|h| SearchHit { path: h.path, title: h.title, snippet: h.snippet })
            .collect())
    })
}

#[tauri::command]
pub fn recents_list(state: State<Arc<AppState>>) -> CmdResult<Vec<(String, String)>> {
    with_db(&state, |conn| db::list_recents(conn, 20).map_err(|e| e.to_string()))
}

#[tauri::command]
pub fn favorites_list(state: State<Arc<AppState>>) -> CmdResult<Vec<(String, String)>> {
    with_db(&state, |conn| db::list_favorites(conn).map_err(|e| e.to_string()))
}

/// 返回切换后的状态（true=已收藏）
#[tauri::command]
pub fn favorite_toggle(state: State<Arc<AppState>>, path: String) -> CmdResult<bool> {
    with_db(&state, |conn| {
        db::favorite_toggle(conn, &path, fs_ops::now_ms()).map_err(|e| e.to_string())
    })
}

#[tauri::command]
pub fn asset_save(state: State<Arc<AppState>>, data_base64: String, ext: String) -> CmdResult<String> {
    use base64::Engine;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(&data_base64)
        .map_err(|e| format!("base64 解码失败: {e}"))?;
    with_vault(&state, |vault| {
        fs_ops::save_asset(vault, &bytes, &ext).map_err(|e| e.to_string())
    })
}

