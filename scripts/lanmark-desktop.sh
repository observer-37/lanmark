#!/usr/bin/env bash
# Lanmark Linux 原生启动器（Arch 等 rolling 发行版推荐用原生二进制而非 AppImage）
# 用法: scripts/lanmark-desktop.sh [--build]
set -e
WS="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BIN="$WS/src-tauri/target/release/lanmark"

if [ "--build" = "$1" ] || [ ! -x "$BIN" ]; then
  echo "构建 release 二进制…"
  (cd "$WS" && pnpm tauri build --no-bundle)
fi

exec "$BIN" "$@"
