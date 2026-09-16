# Lanmark

局域网优先的 Markdown 笔记软件（Windows / Linux / Android），手机作为局域网同步中心节点。

```
Tauri 2 (Rust core) + React 19 + TypeScript + Tailwind CSS v4 + Zustand
```

## 文档

| 文档 | 内容 |
|---|---|
| [docs/01-可行性评估与需求确认.md](docs/01-可行性评估与需求确认.md) | 可行性、风险、已确认需求 |
| [docs/02-技术选型与工程路线.md](docs/02-技术选型与工程路线.md) | 选型论证、架构、同步协议、里程碑 |
| [docs/03-M0-环境与构建指南.md](docs/03-M0-环境与构建指南.md) | 本机开发环境、构建、Android 安装 |

## 开发

```bash
pnpm install

# 桌面端开发调试（热重载）
pnpm tauri dev

# 前端构建 + 类型检查
pnpm build

# Rust 侧检查与测试
cd src-tauri && cargo check && cargo test
```

## 构建

```bash
pnpm tauri build          # 桌面安装包（deb/AppImage/NSIS）
pnpm tauri android build --apk --target aarch64   # Android APK（需 SDK/NDK）
```

推送到 GitHub 后，[build workflow](.github/workflows/build.yml) 会自动产出三端构建物（Artifacts）。

## 约定

- 本仓库把 pnpm/cargo 缓存重定向到 `.cache/`（已 gitignore），避免污染 `$HOME`。
- Rust 桥接命令位于 `src-tauri/src/`，前端封装位于 `src/lib/`，状态位于 `src/stores/`。

## 许可

见 [LICENSE](LICENSE)。
