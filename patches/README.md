# patches/ — vendor 的依赖补丁

## tauri-runtime-wry 2.11.4（tauri#15671）

上游 crates.io `tauri-runtime-wry` 2.11.4 的完整副本，**仅 `src/lib.rs` 有 7 行差异**
（其余文件与 registry 原件逐字节一致，可用
`~/.cache/cargo/registry/src/*/tauri-runtime-wry-2.11.4/` 对照 diff）。

**补丁内容**：移动端 `Event::Resumed` 原本只按窗口分发；零窗口时（FGS 保活、
Activity 被划掉）事件被静默丢弃，App 层收不到 `RunEvent::Resumed`，无法重建 webview
→ 划掉重开白屏。补丁在分发前直接 `callback(RunEvent::Resumed)`。

**引用方式**：`src-tauri/Cargo.toml` 的 `[patch.crates-io]` 指向本目录。
路径依赖不进 Cargo.lock，版本升级 tauri-runtime-wry 时必须同步更新这里的副本
（重新从 registry 拷原件 + 重放 lib.rs 补丁），并跑 `scripts/android-check.sh`
与 `cd src-tauri && cargo check` 双验证。

**历史**：2026-09-18 前补丁存放在 `.cache/patches/`（gitignore），导致 CI
全新 checkout 找不到路径、三端构建全挂；本目录为入库修复。
