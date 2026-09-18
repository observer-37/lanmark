#!/usr/bin/env bash
# M2 交叉编译门禁：不跑完整 gradle 构建，快速验证 Rust 侧 Android target 编译通过。
# 用法：scripts/android-check.sh [target...]   （默认 aarch64-linux-android）
# 说明：cargo check 也会执行 build.rs（rusqlite bundled 需编译 SQLite C 代码），
# cc-rs 需要 CC_<target> 指向 NDK 的 API 级 clang 包装器——tauri android build 会自动
# 设置这些变量，直接裸调 cargo check 则必须手动补齐，本脚本即为此存在。
set -euo pipefail
WS="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=env.sh
source "$WS/scripts/env.sh" >/dev/null

API=24  # 与 gen/android/app/build.gradle.kts 的 minSdk 保持一致
TC="$(ls -d "$NDK_HOME"/toolchains/llvm/prebuilt/*/bin | head -n1)"
if [ -z "$TC" ]; then
  echo "错误: 未找到 NDK 工具链（NDK_HOME=$NDK_HOME）" >&2
  exit 1
fi

targets=("$@")
[ ${#targets[@]} -eq 0 ] && targets=(aarch64-linux-android)

for t in "${targets[@]}"; do
  # armv7-linux-androideabi 的 clang 包装器叫 armv7a-linux-androideabi<API>-clang
  clang_prefix="$t"
  [ "$t" = "armv7-linux-androideabi" ] && clang_prefix="armv7a-linux-androideabi"
  # cc-rs 读取 CC_<triple 下划线形式>（大小写敏感，需保持小写）
  var_name="CC_${t//-/_}"
  export "$var_name=$TC/${clang_prefix}${API}-clang"
  export "AR_${t//-/_}=$TC/llvm-ar"
  echo "=== cargo check --target $t ==="
  cargo check --quiet --target "$t" --manifest-path "$WS/src-tauri/Cargo.toml"
  echo "=== $t OK ==="
done
echo "全部 Android target 编译检查通过"
