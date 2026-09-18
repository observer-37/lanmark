//! M2 手机端同步服务器：axum + JSON over HTTP，监听 0.0.0.0:4180（被占则 +1 重试）。
//! 手机 = 局域网同步中心节点；桌面端（客户端）发现/配对后驱动双向同步回合。
//! 端点幂等可重放；token 仅防误连（docs/05：TLS+证书固定推迟到 M4）。
//!
//! 并发说明：单客户端串行同步（锁在客户端侧），文件写入走 M1 的 tmp+rename，
//! handler 内联阻塞 IO 在当前量级（1e3-1e4 文件）是毫秒级，可接受。

use std::collections::HashMap;
use std::net::{TcpListener, UdpSocket};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use axum::response::IntoResponse;
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::commands::{self, CmdResult};
use crate::fs_ops;
use crate::sync::{
    b64_decode, b64_encode, local_manifest, write_conflict_copy, FileMeta, PullFile, PullRequest,
    PullResponse, PushFile, PushResult,
};
use crate::vault::AppState;

pub const SERVICE_TYPE: &str = "_lanmark._tcp.local.";
pub const DEFAULT_PORT: u16 = 4180;
const MAX_PORT_TRIES: u16 = 10;

/// vault 内同步元数据（.lanmark/sync.json）：设备名 + 配对码 + 已发 token
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SyncConfig {
    pub device_name: String,
    pub pairing_code: String,
    #[serde(default)]
    pub tokens: Vec<String>,
}

fn sync_config_path(vault: &std::path::Path) -> PathBuf {
    vault.join(fs_ops::META_DIR).join("sync.json")
}

pub fn load_sync_config(vault: &std::path::Path) -> SyncConfig {
    std::fs::read_to_string(sync_config_path(vault))
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_else(|| {
            let cfg = SyncConfig {
                device_name: "Lanmark 手机".into(),
                pairing_code: gen_pairing_code(),
                tokens: Vec::new(),
            };
            let _ = save_sync_config(vault, &cfg);
            cfg
        })
}

pub fn save_sync_config(vault: &std::path::Path, cfg: &SyncConfig) -> std::io::Result<()> {
    let path = sync_config_path(vault);
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    // tmp+rename 原子写，与笔记落盘同纪律
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, serde_json::to_string_pretty(cfg).map_err(std::io::Error::other)?)?;
    std::fs::rename(&tmp, &path)?;
    Ok(())
}

/// 8 位数字配对码：sha256(time_ns + pid + vault path) 取数字，防误连足够（M4 前不加密）
fn gen_pairing_code() -> String {
    let mut material = format!(
        "{}{}{:?}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0),
        std::process::id(),
        std::env::temp_dir()
    );
    use sha2::{Digest, Sha256};
    // 混入指针地址增加熵（同一纳秒内两次调用的场景）
    material.push_str(&format!("{:p}", &material));
    let hash = Sha256::digest(material.as_bytes());
    hash.iter().map(|b| (b % 10).to_string()).collect::<Vec<_>>()[..8]
        .concat()
}

fn gen_token(code: &str) -> String {
    use sha2::{Digest, Sha256};
    let material = format!(
        "{code}{}{}{:p}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0),
        std::process::id(),
        code,
    );
    let hash = Sha256::digest(material.as_bytes());
    hash.iter().map(|b| format!("{b:02x}")).collect()
}

/// 服务器上下文：AppState + 内存中的 sync 配置（落盘 .lanmark/sync.json）
pub struct ServerCtx {
    pub app: Arc<AppState>,
    pub cfg: Mutex<SyncConfig>,
}

impl ServerCtx {
    fn vault(&self) -> Result<PathBuf, String> {
        self.app
            .vault
            .lock()
            .map_err(|_| "vault 锁中毒".to_string())?
            .clone()
            .ok_or_else(|| "尚未打开 vault".to_string())
    }

    fn check_token(&self, headers: &HeaderMap) -> Result<(), (StatusCode, String)> {
        let auth = headers
            .get("authorization")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("");
        let token = auth.strip_prefix("Bearer ").unwrap_or("");
        if token.is_empty() {
            return Err((StatusCode::UNAUTHORIZED, "缺少 token（先 /api/v1/pair）".into()));
        }
        let ok = self
            .cfg
            .lock()
            .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "配置锁中毒".into()))?
            .tokens
            .iter()
            .any(|t| t == token);
        if ok {
            Ok(())
        } else {
            Err((StatusCode::FORBIDDEN, "token 无效（服务器可能重启过，重新配对）".into()))
        }
    }
}

// ---------- 端点 ----------

/// GET /api/v1/info —— 无需鉴权：设备名 + vault 统计（不含任何笔记数据）
async fn info(State(ctx): State<Arc<ServerCtx>>) -> impl IntoResponse {
    let stats = local_manifest(&ctx.app).map(|m| {
        (
            m.iter().filter(|f| f.kind == "note").count(),
            m.iter().filter(|f| f.kind == "asset").count(),
        )
    });
    let (notes, assets) = stats.unwrap_or((0, 0));
    let cfg = ctx.cfg.lock().map(|c| c.clone()).unwrap_or_default();
    Json(json!({
        "app": "lanmark",
        "name": cfg.device_name,
        "notes": notes,
        "assets": assets,
        "requiresPairing": true,
    }))
}

#[derive(Deserialize)]
struct PairBody {
    code: String,
}

/// POST /api/v1/pair —— 配对码换 token（token 持久化，服务器重启后仍有效）
async fn pair(
    State(ctx): State<Arc<ServerCtx>>,
    Json(body): Json<PairBody>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let mut cfg = ctx.cfg.lock().map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "配置锁中毒".into()))?;
    if body.code.trim() != cfg.pairing_code {
        return Err((StatusCode::FORBIDDEN, "配对码错误".into()));
    }
    let token = gen_token(&cfg.pairing_code);
    cfg.tokens.push(token.clone());
    let vault = ctx.vault().map_err(|e| (StatusCode::CONFLICT, e))?;
    save_sync_config(&vault, &cfg).map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("保存配置失败: {e}")))?;
    Ok(Json(json!({ "token": token, "name": cfg.device_name })))
}

/// GET /api/v1/manifest —— 全量清单（notes + assets）
async fn manifest(
    State(ctx): State<Arc<ServerCtx>>,
    headers: HeaderMap,
) -> Result<Json<Vec<FileMeta>>, (StatusCode, String)> {
    ctx.check_token(&headers)?;
    let list = local_manifest(&ctx.app).map_err(|e| (StatusCode::CONFLICT, e))?;
    Ok(Json(list))
}

/// POST /api/v1/pull —— 按路径取文件内容（base64）；仅服务当前清单内的路径
async fn pull(
    State(ctx): State<Arc<ServerCtx>>,
    headers: HeaderMap,
    Json(req): Json<PullRequest>,
) -> Result<Json<PullResponse>, (StatusCode, String)> {
    ctx.check_token(&headers)?;
    let vault = ctx.vault().map_err(|e| (StatusCode::CONFLICT, e))?;
    let current = local_manifest(&ctx.app).map_err(|e| (StatusCode::CONFLICT, e))?;
    let by_path: HashMap<String, FileMeta> =
        current.into_iter().map(|m| (m.path.clone(), m)).collect();

    let mut files = Vec::new();
    let mut missing = Vec::new();
    for path in &req.paths {
        let Some(meta) = by_path.get(path) else {
            missing.push((path.clone(), "不在服务器清单中".into()));
            continue;
        };
        let abs = match fs_ops::safe_join(&vault, path) {
            Ok(a) => a,
            Err(e) => {
                missing.push((path.clone(), e.to_string()));
                continue;
            }
        };
        match std::fs::read(&abs) {
            Ok(bytes) => files.push(PullFile {
                path: path.clone(),
                kind: meta.kind.clone(),
                content_base64: b64_encode(&bytes),
                hash: meta.hash.clone(),
                mtime_ms: meta.mtime_ms,
            }),
            Err(e) => missing.push((path.clone(), format!("读取失败: {e}"))),
        }
    }
    Ok(Json(PullResponse { files, missing }))
}

#[derive(Deserialize)]
pub struct PushBody {
    pub files: Vec<PushFile>,
}

/// POST /api/v1/push —— 客户端推送更新。
/// 冲突判定：服务器现 hash ≠ base_hash（客户端所见旧版）→ 服务器现有版本先改名保留（双份铁律），
/// 再落客户端内容。内容 hash 校验不符则拒绝该文件。
async fn push(
    State(ctx): State<Arc<ServerCtx>>,
    headers: HeaderMap,
    Json(body): Json<PushBody>,
) -> Result<Json<Vec<PushResult>>, (StatusCode, String)> {
    ctx.check_token(&headers)?;
    let vault = ctx.vault().map_err(|e| (StatusCode::CONFLICT, e))?;
    let mut results = Vec::new();

    for pf in &body.files {
        let result = write_pushed_file(&ctx, &vault, pf);
        match result {
            Ok(conflict_saved_as) => results.push(PushResult {
                path: pf.path.clone(),
                ok: true,
                error: None,
                conflict_saved_as,
            }),
            Err(e) => results.push(PushResult {
                path: pf.path.clone(),
                ok: false,
                error: Some(e),
                conflict_saved_as: None,
            }),
        }
    }
    Ok(Json(results))
}

/// 单文件落盘逻辑（阻塞，从 handler 分离便于测试）
fn write_pushed_file(
    ctx: &Arc<ServerCtx>,
    vault: &std::path::Path,
    pf: &PushFile,
) -> Result<Option<String>, String> {
    let bytes = b64_decode(&pf.content_base64)?;
    // 内容完整性：hash 必须与内容一致
    let actual_hash = fs_ops::content_hash(&bytes);
    if actual_hash != pf.hash {
        return Err(format!("内容 hash 不符（声称 {} 实际 {}）", pf.hash, &actual_hash[..16.min(actual_hash.len())]));
    }

    match pf.kind.as_str() {
        "note" => {
            if !pf.path.ends_with(".md") {
                return Err("笔记必须以 .md 结尾".into());
            }
            let conn_guard = ctx
                .app
                .db
                .lock()
                .map_err(|_| "DB 锁中毒".to_string())?;
            let conn = conn_guard.as_ref().ok_or("尚未打开 vault")?;
            // 服务器侧冲突命名：现有版本 hash ≠ 客户端所见 base_hash 且非空 → 改名保留
            let mut conflict_saved_as = None;
            if !pf.base_hash.is_empty() {
                if let Ok(existing) = fs_ops::read_note(vault, &pf.path) {
                    if fs_ops::content_hash(existing.as_bytes()) != pf.base_hash {
                        let saved = write_conflict_copy(
                            vault,
                            conn,
                            &pf.path,
                            "note",
                            existing.as_bytes(),
                            fs_ops::now_ms(),
                        )
                        .map_err(|e| format!("冲突副本落盘失败: {e}"))?;
                        // 从原位置移除（已在副本中），避免 write_note 覆盖两份一样
                        let abs = fs_ops::safe_join(vault, &pf.path).map_err(|e| e.to_string())?;
                        let _ = std::fs::remove_file(&abs);
                        conflict_saved_as = Some(saved);
                    }
                }
            }
            // write_note：tmp+rename 原子落盘 + 更新索引
            fs_ops::write_note(vault, &pf.path, &String::from_utf8_lossy(&bytes), conn)
                .map_err(|e| format!("写入失败: {e}"))?;
            Ok(conflict_saved_as)
        }
        "asset" => {
            // 附件内容寻址：重算名字必须与声称路径一致（否则视为数据错乱）
            let ext = pf.path.rsplit('.').next().unwrap_or("bin").to_string();
            let saved = crate::commands::asset_save_op(&ctx.app, &pf.content_base64, &ext)?;
            if saved != pf.path {
                return Err(format!("附件路径与内容不符（期望 {} 实际 {}）", pf.path, saved));
            }
            Ok(None)
        }
        other => Err(format!("未知类型: {other}")),
    }
}

#[derive(Deserialize)]
struct DeleteBody {
    paths: Vec<String>,
}

/// POST /api/v1/delete —— 软删（入回收站，铁律永不硬删）。M2 同步回合不主动调用。
async fn delete_files(
    State(ctx): State<Arc<ServerCtx>>,
    headers: HeaderMap,
    Json(body): Json<DeleteBody>,
) -> Result<Json<Vec<PushResult>>, (StatusCode, String)> {
    ctx.check_token(&headers)?;
    let mut results = Vec::new();
    for path in &body.paths {
        match commands::entry_delete_op(&ctx.app, path) {
            Ok(trash) => results.push(PushResult {
                path: path.clone(),
                ok: true,
                error: None,
                conflict_saved_as: Some(trash),
            }),
            Err(e) => results.push(PushResult {
                path: path.clone(),
                ok: false,
                error: Some(e),
                conflict_saved_as: None,
            }),
        }
    }
    Ok(Json(results))
}

pub fn router(ctx: Arc<ServerCtx>) -> Router {
    Router::new()
        .route("/api/v1/info", get(info))
        .route("/api/v1/pair", post(pair))
        .route("/api/v1/manifest", get(manifest))
        .route("/api/v1/pull", post(pull))
        .route("/api/v1/push", post(push))
        .route("/api/v1/delete", post(delete_files))
        .with_state(ctx)
}

/// 绑定端口并开始服务（供测试与 spawn 共用）：4180 被占则 +1 重试。
/// 返回 (实际端口, TcpListener)。
pub fn bind_listener() -> std::io::Result<(u16, TcpListener)> {
    for port in DEFAULT_PORT..DEFAULT_PORT + MAX_PORT_TRIES {
        match TcpListener::bind(("0.0.0.0", port)) {
            Ok(l) => return Ok((port, l)),
            Err(e) if e.kind() == std::io::ErrorKind::AddrInUse => continue,
            Err(e) => return Err(e),
        }
    }
    Err(std::io::Error::new(
        std::io::ErrorKind::AddrInUse,
        format!("{DEFAULT_PORT}..{} 全部被占", DEFAULT_PORT + MAX_PORT_TRIES),
    ))
}

/// mDNS fullname（`设备名._lanmark._tcp.local.`）→ 实例名（还原转义的 `.`）
pub fn service_instance_name(fullname: &str) -> String {
    fullname.trim_end_matches('.').replace("\\.", ".")
}

/// 生产启动：独立线程 + 单线程 tokio runtime（不依赖 tauri runtime 的 feature 组合）。
/// 返回实际端口。幂等：已启动则直接返回端口。服务器随进程存活（M2 无停止需求）。
pub fn spawn(app: Arc<AppState>) -> Result<u16, String> {
    // 幂等：Android 端 vault 每次打开都会调；进程重建后状态归零会重新走到这里
    {
        let port = app.sync_port.lock().map_err(|_| "锁中毒".to_string())?;
        if let Some(p) = *port {
            return Ok(p);
        }
    }
    let (port, listener) = bind_listener().map_err(|e| format!("绑定端口失败: {e}"))?;
    // 先记端口再起线程：并发的幂等检查在 bind 后立即生效，避免双绑
    *app.sync_port.lock().map_err(|_| "锁中毒".to_string())? = Some(port);
    let vault = app
        .vault
        .lock()
        .map_err(|_| "vault 锁中毒".to_string())?
        .clone()
        .ok_or("尚未打开 vault")?;
    let cfg = load_sync_config(&vault);
    let ctx = Arc::new(ServerCtx { app, cfg: Mutex::new(cfg) });

    // mDNS 广播（best effort；Android 需 multicast lock，失败不阻断服务器）
    let mdns_name = {
        let cfg = ctx.cfg.lock().map_err(|_| "锁中毒".to_string())?;
        cfg.device_name.clone()
    };
    advertise_mdns(port, mdns_name);

    std::thread::Builder::new()
        .name("lanmark-sync-server".into())
        .spawn(move || {
            let rt = match tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
            {
                Ok(rt) => rt,
                Err(e) => {
                    eprintln!("同步服务器 runtime 启动失败: {e}");
                    return;
                }
            };
            rt.block_on(async move {
                if let Err(e) = serve_on(listener, ctx).await {
                    eprintln!("同步服务器退出: {e}");
                }
            });
        })
        .map_err(|e| format!("启动同步服务器线程失败: {e}"))?;
    Ok(port)
}

/// std listener → tokio listener → axum serve（spawn 与测试共用）
pub(crate) async fn serve_on(
    listener: std::net::TcpListener,
    ctx: Arc<ServerCtx>,
) -> std::io::Result<()> {
    // tokio 要求 fd 先行 nonblocking（否则 panic，tokio#7172）
    listener.set_nonblocking(true)?;
    let listener = tokio::net::TcpListener::from_std(listener)?;
    axum::serve(listener, router(ctx)).await
}

/// mDNS 注册 _lanmark._tcp（服务名 = 设备名）。失败仅记日志。
fn advertise_mdns(port: u16, name: String) {
    std::thread::Builder::new()
        .name("lanmark-mdns".into())
        .spawn(move || {
            let result = (|| -> Result<(), String> {
                let mdns = mdns_sd::ServiceDaemon::new().map_err(|e| e.to_string())?;
                let host = {
                    // 本机局域网地址作 host 提示；enable_addr_auto 会按网卡实际发送
                    let ip = local_lan_ip().unwrap_or_else(|| "lanmark".into());
                    format!("{ip}.")
                };
                let props = [("app", "lanmark")];
                let service = mdns_sd::ServiceInfo::new(
                    SERVICE_TYPE,
                    &name,
                    &host,
                    (), // addr_auto：地址按网卡动态填充
                    port,
                    &props[..],
                )
                .map_err(|e| e.to_string())?
                .enable_addr_auto();
                mdns.register(service).map_err(|e| e.to_string())?;
                Ok(())
            })();
            if let Err(e) = result {
                eprintln!("mDNS 广播失败（可用手输 URL 兜底）: {e}");
            }
        })
        .ok();
}

/// 本机局域网 IPv4（UDP connect 技巧，不真正发包）
fn local_lan_ip() -> Option<String> {
    let s = UdpSocket::bind("0.0.0.0:0").ok()?;
    s.connect("8.8.8.8:80").ok()?;
    s.local_addr().ok().map(|a| a.ip().to_string())
}

// ---------- Tauri 命令 ----------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncPairingInfo {
    pub running: bool,
    pub port: Option<u16>,
    pub device_name: String,
    pub pairing_code: String,
}

/// 同步服务器状态 + 配对信息（手机端 UI 展示）
#[tauri::command]
pub fn sync_pairing_info(state: tauri::State<'_, Arc<AppState>>) -> CmdResult<SyncPairingInfo> {
    let port = *state.sync_port.lock().map_err(|_| "锁中毒")?;
    let vault = state
        .vault
        .lock()
        .map_err(|_| "锁中毒")?
        .clone()
        .ok_or("尚未打开 vault")?;
    let cfg = load_sync_config(&vault);
    Ok(SyncPairingInfo {
        running: port.is_some(),
        port,
        device_name: cfg.device_name,
        pairing_code: cfg.pairing_code,
    })
}

/// 启动同步服务器（幂等；Android 端在 vault 打开后自动调用，桌面端可手动开）
#[tauri::command]
pub fn sync_server_start(state: tauri::State<'_, Arc<AppState>>) -> CmdResult<u16> {
    spawn(state.inner().clone())
}

// ---------- 测试工具（跨模块共享） ----------

/// 测试用：在独立线程 + current_thread runtime 上起 axum 服务器（与生产 spawn 同构）。
/// 用普通 #[test] 而非 #[tokio::test]：reqwest blocking client 的内部 runtime
/// 不能在异步上下文里 drop（tokio blocking/shutdown panic）。
#[cfg(test)]
pub(crate) mod test_util {
    use super::*;
    use std::path::Path;

    pub(crate) fn start_phone_server(phone_vault: &Path, app: Arc<AppState>) -> (String, String) {
        let (port, listener) = bind_listener().unwrap();
        let cfg = load_sync_config(phone_vault);
        let code = cfg.pairing_code.clone();
        let ctx = Arc::new(ServerCtx { app, cfg: Mutex::new(cfg) });
        std::thread::spawn(move || {
            let rt = tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
                .unwrap();
            rt.block_on(async move {
                let _ = serve_on(listener, ctx).await;
            });
        });
        (format!("http://127.0.0.1:{port}"), code)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pairing_code_is_8_digits_and_varies() {
        let a = gen_pairing_code();
        let b = gen_pairing_code();
        assert_eq!(a.len(), 8);
        assert!(a.chars().all(|c| c.is_ascii_digit()));
        assert_ne!(a, b, "连续两次生成应不同");
    }

    #[test]
    fn sync_config_roundtrip_and_defaults() {
        let dir = tempfile::TempDir::new().unwrap();
        let vault = dir.path();
        // 首次读取自动生成并落盘
        let cfg1 = load_sync_config(vault);
        assert_eq!(cfg1.pairing_code.len(), 8);
        assert!(cfg1.tokens.is_empty());
        // 第二次读取同一份（不再重新生成）
        let cfg2 = load_sync_config(vault);
        assert_eq!(cfg1.pairing_code, cfg2.pairing_code);
        // 修改后往返
        let mut cfg3 = cfg2.clone();
        cfg3.tokens.push("tok123".into());
        cfg3.device_name = "测试机".into();
        save_sync_config(vault, &cfg3).unwrap();
        let cfg4 = load_sync_config(vault);
        assert_eq!(cfg4.tokens, vec!["tok123".to_string()]);
        assert_eq!(cfg4.device_name, "测试机");
        assert!(sync_config_path(vault).exists());
    }

    #[test]
    fn server_end_to_end_pair_manifest_pull_push_conflict() {
        use crate::commands::open_vault_at;

        let dir = tempfile::TempDir::new().unwrap();
        let app = Arc::new(AppState::default());
        open_vault_at(&app, dir.path()).unwrap();

        // 手机端建一篇笔记 + 一个附件
        let note = commands::note_create_op(&app, "", "手机笔记").unwrap();
        commands::note_write_op(&app, &note.path, "手机端内容").unwrap();
        let asset = commands::asset_save_op(&app, &b64_encode(b"phone-bytes"), "png").unwrap();

        let (base, code) = test_util::start_phone_server(dir.path(), Arc::clone(&app));

        // 用 blocking reqwest 模拟桌面客户端（与 sync_client 同一 HTTP 栈）
        let client = reqwest::blocking::Client::new();
        wait_ready(&client, &base);

        // 1. info 无需鉴权
        let info: serde_json::Value = client.get(format!("{base}/api/v1/info")).send().unwrap().json().unwrap();
        assert_eq!(info["app"], "lanmark");
        assert!(info["notes"].as_u64().unwrap() >= 1);

        // 2. 未配对时 manifest 拒绝
        let r = client.get(format!("{base}/api/v1/manifest")).send().unwrap();
        assert_eq!(r.status(), StatusCode::UNAUTHORIZED);

        // 3. 错误配对码 → 403
        let r = client
            .post(format!("{base}/api/v1/pair"))
            .json(&json!({ "code": "00000000" }))
            .send()
            .unwrap();
        assert_eq!(r.status(), StatusCode::FORBIDDEN);

        // 4. 正确配对码 → token；token 持久化到 .lanmark/sync.json
        let paired: serde_json::Value = client
            .post(format!("{base}/api/v1/pair"))
            .json(&json!({ "code": code }))
            .send()
            .unwrap()
            .json()
            .unwrap();
        let token = paired["token"].as_str().unwrap().to_string();
        let saved: SyncConfig =
            serde_json::from_str(&std::fs::read_to_string(sync_config_path(dir.path())).unwrap()).unwrap();
        assert_eq!(saved.tokens, vec![token.clone()]);

        let auth = format!("Bearer {token}");

        // 5. manifest 含笔记与附件
        let manifest: Vec<FileMeta> = client
            .get(format!("{base}/api/v1/manifest"))
            .header("authorization", &auth)
            .send()
            .unwrap()
            .json()
            .unwrap();
        let note_meta = manifest.iter().find(|m| m.path == note.path).expect("笔记在清单");
        assert_eq!(note_meta.hash, fs_ops::content_hash("手机端内容".as_bytes()));

        // 6. pull 取回内容
        let pulled: PullResponse = client
            .post(format!("{base}/api/v1/pull"))
            .header("authorization", &auth)
            .json(&json!({ "paths": [note.path, asset, ".lanmark/db"] }))
            .send()
            .unwrap()
            .json()
            .unwrap();
        assert_eq!(pulled.files.len(), 2);
        assert_eq!(b64_decode(&pulled.files[0].content_base64).unwrap(), "手机端内容".as_bytes());
        assert_eq!(pulled.missing.len(), 1, "清单外路径拒绝");
        assert_eq!(pulled.missing[0].0, ".lanmark/db");

        // 7. push 桌面版内容（base_hash = 服务器现 hash → 干净覆盖）
        let desktop_content = "桌面端内容";
        let pushed: Vec<PushResult> = client
            .post(format!("{base}/api/v1/push"))
            .header("authorization", &auth)
            .json(&json!({
                "files": [{
                    "path": note.path,
                    "kind": "note",
                    "contentBase64": b64_encode(desktop_content.as_bytes()),
                    "hash": fs_ops::content_hash(desktop_content.as_bytes()),
                    "mtimeMs": 123,
                    "baseHash": note_meta.hash,
                }]
            }))
            .send()
            .unwrap()
            .json()
            .unwrap();
        assert_eq!(pushed.len(), 1);
        assert!(pushed[0].ok, "push 应成功: {:?}", pushed[0].error);
        assert!(pushed[0].conflict_saved_as.is_none(), "base_hash 相同不是冲突");
        let after = std::fs::read_to_string(dir.path().join(&note.path)).unwrap();
        assert_eq!(after, desktop_content);

        // 8. 冲突 push：base_hash 与服务器现 hash 不一致 → 服务器版本改名保留 + 客户端内容落原路径
        let third = "第三方版本";
        let pushed2: Vec<PushResult> = client
            .post(format!("{base}/api/v1/push"))
            .header("authorization", &auth)
            .json(&json!({
                "files": [{
                    "path": note.path,
                    "kind": "note",
                    "contentBase64": b64_encode(third.as_bytes()),
                    "hash": fs_ops::content_hash(third.as_bytes()),
                    "mtimeMs": 456,
                    "baseHash": "stale-hash".to_string(),
                }]
            }))
            .send()
            .unwrap()
            .json()
            .unwrap();
        assert!(pushed2[0].ok, "冲突 push 也应成功: {:?}", pushed2[0].error);
        let conflict_path = pushed2[0].conflict_saved_as.clone().expect("应有冲突副本");
        assert!(conflict_path.contains("冲突"), "冲突命名: {conflict_path}");
        // 双份都在：原路径 = 第三方版本，冲突副本 = 桌面版本
        assert_eq!(std::fs::read_to_string(dir.path().join(&note.path)).unwrap(), third);
        assert_eq!(
            std::fs::read_to_string(dir.path().join(&conflict_path)).unwrap(),
            desktop_content
        );
        // 冲突副本进了索引
        assert!(crate::db::get_file(
            app.db.lock().unwrap().as_ref().unwrap(),
            &conflict_path
        )
        .unwrap()
        .is_some());

        // 9. push 内容 hash 造假的被拒
        let pushed3: Vec<PushResult> = client
            .post(format!("{base}/api/v1/push"))
            .header("authorization", &auth)
            .json(&json!({
                "files": [{
                    "path": "伪造.md",
                    "kind": "note",
                    "contentBase64": b64_encode(b"x"),
                    "hash": "deadbeef".to_string(),
                    "mtimeMs": 1,
                    "baseHash": "",
                }]
            }))
            .send()
            .unwrap()
            .json()
            .unwrap();
        assert!(!pushed3[0].ok);
        assert!(pushed3[0].error.as_deref().unwrap().contains("hash 不符"));

        // 10. delete → 回收站
        let deleted: Vec<PushResult> = client
            .post(format!("{base}/api/v1/delete"))
            .header("authorization", &auth)
            .json(&json!({ "paths": [note.path] }))
            .send()
            .unwrap()
            .json()
            .unwrap();
        assert!(deleted[0].ok);
        assert!(deleted[0].conflict_saved_as.as_deref().unwrap().starts_with(".lanmark/trash/"));
        assert!(!dir.path().join(&note.path).exists());
    }

    /// 等服务器就绪（最多 2s）
    fn wait_ready(client: &reqwest::blocking::Client, base: &str) {
        for _ in 0..40 {
            if client.get(format!("{base}/api/v1/info")).send().is_ok() {
                return;
            }
            std::thread::sleep(std::time::Duration::from_millis(50));
        }
        panic!("服务器 2s 内未就绪");
    }
}
