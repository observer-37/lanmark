# Android 端内嵌 HTTP 服务器保活调研（Tauri 2 + axum）

> 调研日期：2026-02（web_search/web_fetch 查证一手资料）。所有结论附来源 URL。
> 场景：`com.lanmark.app`，Rust(tokio+axum) 监听 0.0.0.0:4180 作为局域网同步中心，WebView 有同步状态 UI，侧载分发。

## 结论速览

1. Activity 退后台/熄屏不会暂停 Rust 线程；进程继续运行。真正会杀进程的是：LMK/缓存进程管理、用户上滑划掉任务（Tauri 默认在此 `std::process::exit(0)`）、force-stop、OEM 省电。前台服务 + `prevent_exit()` 可解。
2. Tauri 无内建 service API；最少 ~40 行 Kotlin（Service + MainActivity 启动）或用社区插件 `tauri-plugin-background-service`（0 Kotlin）。
3. `tauri android build/dev` 不会覆盖手改（已存在文件只读不写）；删掉 gen/android 重 init 才会重新生成。AndroidManifest.xml / MainActivity.kt 手改安全，gen/android 应入库。
4. axum/tokio 本体交叉编译无问题；坑集中在 TLS（aws-lc-rs）与 mDNS 多播锁。
5. 熄屏后 WiFi 连接一般保持；深度 Doze（静置+拔电+熄屏一段时间）才会挂起网络且忽略 wakelock；电池"不受限"豁免比 WifiLock 有效。

---

## Q1 进程/生命周期

- **退后台不暂停代码**：Android 无"暂停后台进程线程"的机制；退后台只是失去前台重要性。tauri issue #15671 实测：FGS 让进程存活、上滑划掉 Activity 后 "The Rust side keeps running fine the whole time"。
  来源：https://github.com/tauri-apps/tauri/issues/15671
- **Tauri 特有关键坑**：默认 last-window-close 行为下，Activity 销毁（上滑划掉）会关闭唯一 webview window，tao 的 Android `EventLoop::run` 调 `std::process::exit(0)` **连 FGS 一起杀掉**。必须用 `RunEvent::ExitRequested { api, .. } => api.prevent_exit()`。
  来源：https://github.com/tauri-apps/tauri/issues/15671（含复现步骤与 adb 命令）
- **划掉后重新打开白屏（当前已知 bug）**：FGS 保活的进程在上滑后重启 Activity，新 Activity 拿到全新 id，wry 无法为其重建 webview → 白屏；再启动也不恢复，需杀进程。 workaround：在 `RunEvent::Resumed` 里当 `app.webview_windows().is_empty()` 时重建 `WebviewWindowBuilder`（issue 内有完整补丁）。
  来源：https://github.com/tauri-apps/tauri/issues/15671
- **历史泄漏 bug 已修**：FGS 存活时进程比 MainActivity 长寿，曾导致 `__TAURI_INVOKE_KEY__` 不匹配/双 MainActivity；tao/wry 已修复（release 构建验证正常）。
  来源：https://github.com/tauri-apps/tauri/issues/11609
- **系统何时杀进程**：内存压力（按进程重要性 LMK）、缓存应用冻结、用户 force-stop；OEM（小米/华为/三星）激进省电可无视 START_STICKY。FGS 把进程提到 foreground importance，躲开缓存冻结与大部分杀戮。START_STICKY 是被杀后的兜底（进程重建，Rust 状态全丢，需可恢复设计）。
  来源：https://developer.android.com/topic/performance/power/power-details ；https://github.com/dardourimohamed/tauri-background-service/blob/main/tauri-plugin-background-service/docs/android.md

## Q2 声明与启动前台服务（specialUse）

**Manifest（gen/android/app/src/main/AndroidManifest.xml）**：
```xml
<uses-permission android:name="android.permission.FOREGROUND_SERVICE"/>
<uses-permission android:name="android.permission.FOREGROUND_SERVICE_SPECIAL_USE"/>
<uses-permission android:name="android.permission.POST_NOTIFICATIONS"/>
<!-- 可选：WiFi 锁 / mDNS -->
<uses-permission android:name="android.permission.WAKE_LOCK"/>
<uses-permission android:name="android.permission.CHANGE_WIFI_MULTICAST_STATE"/>

<service android:name=".SyncService"
         android:exported="false"
         android:foregroundServiceType="specialUse"
         android:stopWithTask="false">
  <property android:name="android.app.PROPERTY_SPECIAL_USE_FGS_SUBTYPE"
            android:value="lanmark_lan_sync_server"/>
</service>
```
- API 34+ 强制 FGS 类型；`specialUse` 需 `FOREGROUND_SERVICE_SPECIAL_USE` 权限 + service 内 `PROPERTY_SPECIAL_USE_FGS_SUBTYPE` 属性（侧载无 Play 审核，但仍要填说明）。
  来源：https://developer.android.com/develop/background-work/services/fgs/service-types ；https://developer.android.com/reference/kotlin/android/content/pm/ServiceInfo
- 类型未声明会 `MissingForegroundServiceTypeException`；`startForeground` 传未声明类型抛 `IllegalArgumentException`；缺权限抛 `SecurityException`。
  来源：https://developer.android.com/develop/background-work/services/fgs/declare ；https://developer.android.com/develop/background-work/services/fgs/launch
- `stopWithTask="false"`：上滑划掉任务时不随 Activity 一起停服务。来源：https://developer.android.com/guide/topics/manifest/service-element

**Kotlin 最小骨架（SyncService.kt，放 gen/android/app/src/main/java/com/lanmark/app/）**：
```kotlin
package com.lanmark.app

import android.app.*
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.ServiceCompat

class SyncService : Service() {
    override fun onBind(intent: Intent?): IBinder? = null
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val ch = NotificationChannel("sync", "Lanmark 同步", NotificationManager.IMPORTANCE_LOW)
        (getSystemService(NOTIFICATION_SERVICE) as NotificationManager).createNotificationChannel(ch)
        val n = Notification.Builder(this, "sync")
            .setContentTitle("Lanmark 同步中").setOngoing(true)
            .setSmallIcon(android.R.drawable.ic_menu_share).build()
        if (Build.VERSION.SDK_INT >= 34)
            ServiceCompat.startForeground(this, 1, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
        else startForeground(1, n)
        return START_STICKY
    }
}
```
（骨架出自 tauri#15671 的官方协作者验证过的复现代码，加 specialUse 适配。）

**启动位置**：`MainActivity.onCreate`（前台上下文；Android 12+ 限制后台启动 FGS，`ForegroundServiceStartNotAllowedException`）：
```kotlin
class MainActivity : TauriActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(
                android.Manifest.permission.POST_NOTIFICATIONS) !=
            android.content.pm.PackageManager.PERMISSION_GRANTED)
            requestPermissions(arrayOf(android.Manifest.permission.POST_NOTIFICATIONS), 4180)
        startForegroundService(Intent(this, SyncService::class.java))
    }
}
```
- Android 13+ 必须运行时请求 `POST_NOTIFICATIONS`（targetSdk 33+ 时完全由 App 控制时机）；**不请求也能启动 FGS**，只是通知不出现在抽屉（用户会失去可见提示）。
  来源：https://developer.android.com/develop/ui/views/notifications/notification-permission

## Q3 gen/android 会不会被覆盖

- CLI 源码 `crates/tauri-cli/src/mobile/android/project.rs::generate_out_file`：模板文件**已存在则跳过**（仅 `BuildTask.kt` 每次截断重写）。所以 `tauri android build/dev` 甚至重复 `android init` 都不会覆盖手改。
  来源：https://github.com/tauri-apps/tauri/blob/5712549c/crates/tauri-cli/src/mobile/android/project.rs
- 插件经 `tauri-build::update_android_manifest` 注入的内容只重写 `<!-- {id}. AUTO-GENERATED. DO NOT REMOVE. -->` 注释对之间的块，块外手改安全。
  来源：https://github.com/tauri-apps/tauri/commit/1e1d839e7e3d9496f71b6bc1336ced01f2965541
- 唯一重置方式：手动删除 gen/android 再 `tauri android init`（官方 issue 亦如此指示）。**建议把 gen/android 提交 git**。

## Q4 社区插件

- **`tauri-plugin-background-service`**（dardourimohamed/tauri-background-service）：v1.0.1（crates.io 2026-04 创建、约 700 下载、6 star，年轻但活跃）。Rust 实现 `BackgroundService` trait（init/run + `ctx.shutdown` CancellationToken），插件在 Kotlin 侧 `LifecycleService` 起 FGS；支持 `specialUse`、START_STICKY、开机自启、`stopWithTask=false`。API：`init_with_service(|| MyService::new())` + JS `startService({ serviceLabel, foregroundServiceType: "specialUse" })`。注意：OS 重启服务后是新进程，Rust 状态要持久化恢复。
  来源：https://crates.io/crates/tauri-plugin-background-service ；https://github.com/dardourimohamed/tauri-background-service
- 未检索到以 `tauri-plugin-foreground-service` / `tauri-plugin-android-service` 命名且维护中的 Tauri v2 插件；官方 plugins-workspace 无 FGS 插件。
- Rust 直接调移动插件桥（`run_mobile_plugin`）必须在 **async 上下文**，否则 Android 上崩溃（#13063）。
  来源：https://github.com/tauri-apps/tauri/issues/13063

## Q5 axum/tokio 交叉编译 & 无 Kotlin 启动

- tokio/hyper/axum 本体（纯 Rust + libc/socket2）对 `aarch64-linux-android` 编译运行无已知问题；**坑在 TLS**：
  - rustls 0.23+ 默认 `aws-lc-rs`，`aws-lc-sys` 交叉编译 Android 失败/崩溃（CMake 系统名、NDK 28+ 链接 `rlib incompatible with aarch64linux`、16KB page 模拟器 SIGSEGV）。解法：`rustls default-features=false, features=["ring",...]`，axum-server 用 `tls-rustls-no-provider`。局域网明文 HTTP 则完全不涉及。
    来源：https://github.com/aws/aws-lc-rs/issues/775 ；https://github.com/matrix-org/matrix-rust-sdk/issues/6442 ；https://github.com/programatik29/axum-server/issues/153
  - 旧 ring 0.16 需要 NDK clang 包装名（已由 ring 0.17 / cargo-ndk 解决）；裸 `cargo build --target aarch64-linux-android` 链接会失败，cargo-ndk 负责接 NDK clang（tauri CLI 自带此逻辑）。
    来源：https://github.com/rust-lang/rust/issues/115833
- **Rust 侧不写 Kotlin 启动 FGS**：Tauri 2 无内建 service API；FGS 的 Service 类必须是 Java/Kotlin。两条路：① 社区插件自带 Kotlin（0 手写，但 startService 由 JS 触发或 Rust 经插件桥异步调用）；② 手写 ~40 行 Kotlin（上面骨架，最透明可控）。纯 Rust 起不了 FGS。

## Q6 熄屏 WiFi / Doze / 锁

- **Doze 触发条件**：拔电 + 静止（significant motion 检测）+ 熄屏持续一段时间。此时"挂起网络访问、**忽略 wakelock**、不扫 WiFi"，仅在维护窗口放行；插电=无限制。
  来源：https://developer.android.com/training/monitoring-device-state/doze-standby ；https://developer.android.com/topic/performance/power/power-details
- **前台服务进程 → Network: No restrictions**（官方表格，按进程重要性覆盖 bucket 限制）。日常熄屏场景 FGS 足以维持 4180 监听可达。
  来源：https://developer.android.com/topic/performance/power/power-details
- **WifiLock 基本无效于熄屏**：`WIFI_MODE_FULL_LOW_LATENCY` 仅在"连上 AP + **亮屏** + 前台"时生效；`WIFI_MODE_FULL_HIGH_PERF` 已在 API 34 废弃并自动映射为 LOW_LATENCY。`PARTIAL_WAKE_LOCK` 同样被 Doze 忽略。真正有效的杠杆：让用户把 App 电池设为"不受限/不优化"（用户手动解除优化会覆盖系统限制）。
  来源：https://developer.android.com/reference/android/net/wifi/WifiManager ；https://developer.android.com/reference/kotlin/android/net/wifi/WifiManager.WifiLock ；https://developer.android.com/topic/performance/power/power-details
- **mDNS 需 MulticastLock**：WiFi 栈默认过滤多播包，做发现（mdns-sd 等）必须 `WifiManager.createMulticastLock`，否则收不到 mDNS 查询/响应。
  来源：https://developer.android.com/reference/android/net/wifi/WifiManager.MulticastLock

## 推荐落地步骤

1. `src-tauri/src/lib.rs`：改 `.run()` 为 `.run(|_, event| if let RunEvent::ExitRequested { api, .. } = event { api.prevent_exit() })`（防上滑杀进程）；可选加 `Resumed` 时 webview 重建 workaround（#15671）。
2. Manifest 加三个权限 + `<service ... foregroundServiceType="specialUse" stopWithTask="false">` + `PROPERTY_SPECIAL_USE_FGS_SUBTYPE` 属性。
3. 新增 `SyncService.kt`（骨架见上）；`MainActivity.onCreate` 里请求 POST_NOTIFICATIONS（API 33+）并 `startForegroundService`。
4. Rust 侧 axum 在 `tauri::async_runtime` 启动不变；同步状态经 `app_handle.emit` 推给 WebView UI；Rust 侧持久化监听端口/对端状态，以应对 START_STICKY 重建进程。
5. 熄屏可靠性：设置页引导用户关电池优化（不受限）；用 mDNS 才加 MulticastLock；不依赖 WifiLock。
6. 交叉编译注意：若将来加 TLS，选 ring 后端；构建统一走 `tauri android build`（内部已接 cargo-ndk 逻辑）。
7. 备选：`tauri-plugin-background-service`（免 Kotlin、跨平台 iOS/桌面同构），但引入较新依赖 + JS 触发服务生命周期；lanmark 需求简单，手写骨架更稳。
