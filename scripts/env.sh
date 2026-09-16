#!/usr/bin/env bash
# Lanmark 构建环境（桌面 + Android）。用法：source scripts/env.sh
# 原则：工具链与缓存统一放在仓库 .cache/（已 gitignore），不污染 $HOME。
WS="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

export RUSTUP_HOME="$WS/.cache/rustup"
export CARGO_HOME="$WS/.cache/cargo"

# Temurin JDK 21（Gradle 8.9 不支持 JDK 26）
jdk="$(ls -d "$WS"/.cache/jdk/jdk-21* 2>/dev/null | head -n1)"
if [ -n "$jdk" ]; then
  export JAVA_HOME="$jdk"
fi

# Android SDK / NDK（curl 手工组装在 .cache/android-sdk，见 docs/03）
if [ -d "$WS/.cache/android-sdk" ]; then
  export ANDROID_HOME="$WS/.cache/android-sdk"
  export ANDROID_SDK_ROOT="$ANDROID_HOME"
  export NDK_HOME="$(ls -d "$ANDROID_HOME"/ndk/* 2>/dev/null | head -n1)"
  export ANDROID_NDK_HOME="$NDK_HOME"
  export GRADLE_USER_HOME="$WS/.cache/gradle"
  # AGP 的 debug keystore/analytics 写到 ANDROID_USER_HOME（默认 ~/.android，沙箱只读会崩）。
  # 注意：不能同时设已弃用的 ANDROID_SDK_HOME，AGP 会因路径语义冲突直接报错。
  export ANDROID_USER_HOME="$WS/.cache/android-user-home"
  mkdir -p "$ANDROID_USER_HOME"
  # 本网络下 Java 直连 dl.google.com 会被重置（curl 正常）：强制 IPv4 + 阿里云镜像 init 脚本
  export JAVA_TOOL_OPTIONS="-Djava.net.preferIPv4Stack=true"
fi

export PATH="$CARGO_HOME/bin:${JAVA_HOME:+$JAVA_HOME/bin}:$ANDROID_HOME/platform-tools:$PATH"

echo "lanmark env → cargo=$(command -v cargo) | JAVA_HOME=${JAVA_HOME:-unset} | ANDROID_HOME=${ANDROID_HOME:-unset} | NDK_HOME=${NDK_HOME:-unset}"
