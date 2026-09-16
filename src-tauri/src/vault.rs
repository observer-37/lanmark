//! Vault 全局配置（app_config_dir/config.json）与运行时状态。

use std::path::PathBuf;
use std::sync::Mutex;

use rusqlite::Connection;
use serde::{Deserialize, Serialize};

/// 运行时共享状态：当前 vault 路径 + 它的索引连接。
/// 以 Arc 形式 manage 进 Tauri（Mutex 不可 Clone，无法直接 clone 状态结构体）。
#[derive(Default)]
pub struct AppState {
    pub vault: Mutex<Option<PathBuf>>,
    pub db: Mutex<Option<Connection>>,
}

#[derive(Debug, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AppConfig {
    pub vault_path: Option<String>,
}

pub fn config_path(app: &tauri::AppHandle) -> Option<PathBuf> {
    tauri::Manager::path(app)
        .app_config_dir()
        .ok()
        .map(|d| d.join("config.json"))
}

pub fn load_config(app: &tauri::AppHandle) -> AppConfig {
    config_path(app)
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

pub fn save_config(app: &tauri::AppHandle, cfg: &AppConfig) -> std::io::Result<()> {
    let path = config_path(app)
        .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::NotFound, "无法定位配置目录"))?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    std::fs::write(path, serde_json::to_string_pretty(cfg)?)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn config_roundtrip() {
        let cfg = AppConfig { vault_path: Some("/tmp/vault".into()) };
        let json = serde_json::to_string(&cfg).unwrap();
        let back: AppConfig = serde_json::from_str(&json).unwrap();
        assert_eq!(back.vault_path.as_deref(), Some("/tmp/vault"));
        assert_eq!(AppConfig::default().vault_path, None);
    }
}
