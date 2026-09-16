import { invoke } from "@tauri-apps/api/core";

/** 与 src-tauri/src/bridge.rs 的 EchoPayload 对应（serde camelCase） */
export interface EchoPayload {
  message: string;
  receivedAtUnixMs: number;
  serverName: string;
}

/** 与 bridge.rs 的 ECHO_EVENT 对应 */
export const ECHO_EVENT = "rust://echo";

/** 前端 → Rust：invoke 命令 */
export async function greet(name: string): Promise<string> {
  return invoke<string>("greet", { name });
}

/** 前端 → Rust → 前端：直接返回 + 事件回推 */
export async function ping(message: string): Promise<EchoPayload> {
  return invoke<EchoPayload>("ping", { message });
}
