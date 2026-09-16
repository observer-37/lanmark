//! M0 桥接层：纯逻辑与类型定义，不依赖 Tauri 运行时，便于单元测试。

use serde::Serialize;

/// Rust → 前端 事件通道名（事件桥演示用）
pub const ECHO_EVENT: &str = "rust://echo";

/// `ping` 命令的载荷：invoke 直接返回 + 事件回推共用同一结构
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EchoPayload {
    pub message: String,
    pub received_at_unix_ms: u64,
    pub server_name: String,
}

pub fn build_echo(message: &str, received_at_unix_ms: u64, server_name: &str) -> EchoPayload {
    EchoPayload {
        message: message.to_string(),
        received_at_unix_ms,
        server_name: server_name.to_string(),
    }
}

pub fn now_unix_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn echo_payload_fields() {
        let p = build_echo("你好", 1234, "lanmark-core");
        assert_eq!(p.message, "你好");
        assert_eq!(p.received_at_unix_ms, 1234);
        assert_eq!(p.server_name, "lanmark-core");
    }

    #[test]
    fn echo_serializes_camel_case() {
        let p = build_echo("m", 1, "s");
        let json = serde_json::to_string(&p).unwrap();
        assert!(json.contains("receivedAtUnixMs"));
        assert!(!json.contains("received_at_unix_ms"));
    }

    #[test]
    fn now_is_sane() {
        assert!(now_unix_ms() > 1_700_000_000_000);
    }
}
