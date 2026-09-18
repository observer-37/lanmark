# Android 用户自选笔记库目录调研（Tauri 2 / com.lanmark.app / 侧载）

调研时间：2026-08。方法：官方文档 + GitHub 源码/issue 一手查证。每个结论后附来源。

## 1. SAF tree URI → 真实路径映射 + std::fs 可行性

- `ACTION_OPEN_DOCUMENT_TREE` 返回的 tree URI 官方定位是**不透明 URI**，不承诺对应文件系统路径（CommonsWare Scoped Storage Stories: Trees；SO 74062576 "It is not a filesystem path"）。
- 但对 `com.android.externalstorage.documents` 提供者，`tree/primary%3A<rel>` 可**确定性换算**为 `/storage/emulated/0/<rel>`：`DocumentsContract.getTreeDocumentId(uri)` 得 `"primary:rel"`，primary 卷路径即 `/storage/emulated/0`（用 `StorageManager.getStorageVolumes()` + `StorageVolume.getDirectory()`（API 30+）获取，勿硬编码）。Syncthing-android 的 `FileUtils.getFullPathFromTreeUri` 与 plugins-workspace#933 中的 Kotlin 片段即此法。限制：非 primary 卷（SD 卡）只能猜 `/storage/<uuid>`；选择器左侧的 "Downloads" 项是 provider（`providers.downloads.documents`）不是目录，无路径。
- **映射成功 ≠ 可访问（关键结论）**。Android 11+ 经 FUSE/MediaProvider 按"文件用途"放行直接路径访问：scoped storage 应用用 File API/`fopen` 只能访问**媒体文件**（图片/视频/音频，且需 READ_* 权限）；`.md` 这类**非媒体文件**的直接路径读写被拒，官方只允许走 SAF 或 MediaStore Downloads/Documents。只有持有 `MANAGE_EXTERNAL_STORAGE` 时，直接文件路径访问（含写入）才对整个共享存储开放。
  来源: developer.android.com/training/data-storage/manage-all-files（"Write access ... includes direct file path access"）、training/data-storage/shared/media、about/versions/11/privacy/storage、source.android.com/docs/core/storage/scoped（FUSE 按策略放行）。
- 因此：**仅持 SAF 树授权（`takePersistableUriPermission` 持久化，跨重启，上限 Android 11+ 512 个、之前 128 个）时，std::fs 直写映射路径在 Android 11–15 上对 .md 会 EACCES（targetSdk≥30）**。persistable 上限来源：AOSP `UriGrantsManagerService.MAX_PERSISTED_URI_GRANTS=512`、CommonsWare "Count Your SAF Uri Persisted Permissions!"。
- Android 11+ 还禁止用 OPEN_DOCUMENT_TREE 选择 `Android/data`、`Android/obb`（about/versions/11/privacy/storage）。
- 结论：**"SAF + 映射回路径 + std::fs" 组合只在 targetSdk≤29（legacy 存储视图）下成立；targetSdk≥30 必须叠加 MANAGE_EXTERNAL_STORAGE。**

## 2. MANAGE_EXTERNAL_STORAGE（侧载：可行、最简单可靠）

- API 30+ 引入。两步：manifest 声明 + 用户在系统设置授权。检查 `Environment.isExternalStorageManager()`；引导授权用 `Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION` + `Uri.parse("package:com.lanmark.app")` 直达本 app 开关页（或 `ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION` 打开列表）。
  来源: developer.android.com/training/data-storage/manage-all-files、developer.android.com/reference/android/provider/Settings。
- 授权后：共享存储全部文件读写，**支持直接文件路径**（std::fs 全可用）；唯一例外：其他 app 的 `Android/data`、`Android/obb` 仍不可见。
- Google Play 政策（support.google.com/googleplay/android-developer/answer/10467955）只约束上架审核；侧载无任何限制。
- 风险：属"特殊访问"，需引导用户一次手动授权（可直达设置页）；用户可随时撤销 → 每次启动校验 `isExternalStorageManager()`；个别 ROM 对老式直接路径有兼容差异，需真机回归。

## 3. targetSdk 29 + requestLegacyExternalStorage（Android 14/15 侧载）

- 可安装：Android 14 起设备级最低 targetSdk=23，Android 15/16 起 24，**含侧载安装**（报 `INSTALL_FAILED_DEPRECATED_SDK_VERSION`；仅 `adb install --bypass-low-target-sdk-block` 可绕过）。targetSdk 29 满足。
  来源: bayton.org/android/android-minimum-targetsdk-matrix/、androidpolice.com/android-15-blocks-android-marshmallow-apps/、developer.android.com/about/versions/14/behavior-changes-14。
- Android 11 官方文档原文："Apps that run on Android 11 but target Android 10 (API 29) can still request the requestLegacyExternalStorage attribute... After you update your app to target Android 11, the system ignores the flag." → targetSdk 29 在 Android 11–15 设备上 legacy 视图仍生效；配合 `WRITE_EXTERNAL_STORAGE` 运行时权限 = **std::fs 全共享存储读写，无需 SAF/MANAGE**。
- 坑：①时间炸弹——任何原因把 targetSdk 提到 30+（新系统适配、依赖要求）即全盘失效且无替代；②设备最低 targetSdk 逐年上调（14:23、15/16:24），余量尚可但方向明确；③本仓库 gen 工程现为 targetSdk=36，降级需改 `gen/android/app/build.gradle.kts` 并全量回归；④Android 10 新装同样依赖该 flag + WRITE 权限。

## 4. Tauri 2 gen/android 自定义的正规做法

- 本仓库事实：`gen/android` 被 git 跟踪（`src-tauri/.gitignore` 仅忽略 `/gen/schemas`）；MainActivity 在 `app/src/main/java/com/lanmark/app/MainActivity.kt`；`compileSdk=36 / minSdk=24 / targetSdk=36`；manifest 目前只有 `INTERNET`。
- tauri-cli 源码（`crates/tauri-cli/src/mobile/android/project.rs` 的 `generate_out_file`）：生成文件**仅当不存在才创建**，唯一例外 `BuildTask.kt` 每次强制重写 → 重复 `tauri android init` 不会覆盖手改的 MainActivity/manifest；但**删除 gen/android 或修改 identifier 会全量重建**（官方报错文本即要求用户删除重建，issue #10065），手改丢失。
- 结论：少量一次性改动（manifest 权限、MainActivity 加代码）直接改 gen/android 可行且常见（社区亦有 postinit patch 脚本，如 ps5upload commit ea08fd5）；可复用、有接口面的原生功能正规做法是 **Tauri 插件**（`tauri plugin new <name> --android`），插件以 gradle 依赖注入、自带 AndroidManifest 由 manifest merger 合并，不碰 gen。
- 插件最小骨架（官方 develop-mobile 文档）：

```kotlin
@TauriPlugin
class VaultPlugin(private val activity: Activity) : Plugin(activity) {
    @Command
    fun hasAllFilesAccess(invoke: Invoke) =
        invoke.resolve(JSObject().put("granted", Environment.isExternalStorageManager()))

    @Command
    fun requestAllFilesAccess(invoke: Invoke) {
        activity.startActivity(Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION,
            Uri.parse("package:" + activity.packageName)))
        invoke.resolve()
    }
    // pickFolder: ACTION_OPEN_DOCUMENT_TREE + ActivityResult 回调, IO 放 CoroutineScope(Dispatchers.IO)
}
```

  - JS 调用：`invoke('plugin:vault|has_all_files_access')`；Rust 调用：`PluginHandle::run_mobile_plugin("hasAllFilesAccess", payload)`。
  - 命令名加入插件 `build.rs` 的 `COMMANDS` 数组自动生成权限文件；app 的 capabilities 里加 `allow-*`。
  - 来源: v2.tauri.app/develop/plugins/develop-mobile/、v2.tauri.app/develop/plugins/、tauritutorials.com/blog/develop-a-tauri-plugin-for-android。

## 5. 现成社区插件

| 插件 | 状态 | API 概要 | 是否适配本需求 |
|---|---|---|---|
| aiueo13/**tauri-plugin-android-fs** | 最活跃：crates.io v29.0.0（2026-07-22），136 个版本、66k 下载 | SAF URI 体系：`pick_dir`、`persist_uri_permission`、MediaStore 公共目录、私有目录路径、`open_file_readable/writable` 返回 `std::fs::File` | ❌ 全程 URI-based，不返回真实路径，无法喂给 vault_set_path/std::fs 直读 |
| daniele-rolli/**tauri-plugin-scoped-storage** | v1.5.1（2026-08-15），2026-03 新建 | `pickFolder()`→FolderHandle（持久化），readDir/writeTextFile 等**相对路径** API；Android SAF tree + iOS 书签 | ❌ handle 式 IO 走插件自身，不暴露路径 |
| Afeather2017/**tauri-plugin-android-external-storage** | v0.1.0（2026-04-06），354 下载，约 800 行 | 纯路径式（`/storage/emulated/0/...`）+ MANAGE_EXTERNAL_STORAGE：`requestAllFilesAccess/checkAllFilesAccess/getPrimaryStorageRoot/listDirectory/readFile/writeFile/createDirectory` | ✅ 与 std::fs 路线同构；但很新、体量小，建议当参考实现或自查后使用 |
| 官方 tauri-plugin-dialog | Android **目录选择至今未实现**（plugins-workspace#933、tauri#14587，2025-11 仍 open） | 文件选择返回 `content://` URI（#2749） | ❌ |

- 不存在被广泛使用的 `tauri-plugin-saf` / `tauri-plugin-storage-access`。
- 来源: 各 GitHub 仓库 README、crates.io API（/api/v1/crates/<name>）、plugins-workspace issues #933/#2749、tauri#14587。

## 6. mDNS 广播（mdns-sd）与 MulticastLock

- **需要**。Android WiFi 栈默认丢弃未寻址到本机的多播包，接收必须持 `WifiManager.MulticastLock`；权限 `CHANGE_WIFI_MULTICAST_STATE`（normal，无需运行时申请）。发送/公告不受锁影响。
  来源: developer.android.com/reference/android/net/wifi/WifiManager.MulticastLock、RxDNSSD#54。
- 官方 NsdManager 文档：Android 13（T extension 7）之前**即使前台也必须手动持锁**；ext7 起前台由系统自动放行（稳妥做法：始终 acquire）。
- Rust 的 UDP socket 与 app 同进程，锁对整个进程生效。Tauri 里可在 `MainActivity.onCreate` acquire（app 退出自动释放），或插件 `@Command` 里 JNI 持 GlobalRef 管理（参考 ps5upload commit ea08fd5 的 `acquire_multicast_lock()`）。
- 附带坑：mdns-sd 曾对 Android `getaddrinfo` 的 legacy 单播查询（临时源端口）不回包，导致浏览器解析 `.local` 失败；PR #469（commit 933bdbe）已修复——Rust 侧需用含该修复的版本。

## 推荐方案（侧载个人 App）

**主线：保持 targetSdk 36，MANAGE_EXTERNAL_STORAGE + 现有 `vault_set_path` 路径接口不动。**

1. `gen/android/app/src/main/AndroidManifest.xml` 加：
   `<uses-permission android:name="android.permission.MANAGE_EXTERNAL_STORAGE" tools:ignore="ScopedStorage" />`
2. 小插件（或先直接改 MainActivity）提供 3 个命令：`hasAllFilesAccess` / `requestAllFilesAccess`（直达设置开关页）/ `pickFolder`。选目录 UI 复用 `ACTION_OPEN_DOCUMENT_TREE`（仅当选择器用），拿到 primary 树后映射回 `/storage/emulated/0/...` 字符串传给 Rust；MANAGE 已保证 std::fs 可直接读写（临时文件+rename、walk、SQLite 均不用改）。映射失败（非 externalstorage.documents 提供者/SD 卡）时提示改选内部存储。启动时校验 `isExternalStorageManager()`，未授权则引导。
3. mDNS：manifest 加 `CHANGE_WIFI_MULTICAST_STATE`，onCreate 里 acquire MulticastLock（非引用计数）；mdns-sd 升级到含 #469 修复的版本。

**备选（不推荐长期）**：targetSdk 29 + `requestLegacyExternalStorage` + WRITE_EXTERNAL_STORAGE——代码最少、立即可用，但 targetSdk 一升即失效。

**风险**：①MANAGE 是特殊访问，恢复出厂/清数据后需重授，UI 须有未授权态；②vault 勿放 `Android/data`（任何方案都受限）；③gen/android 手改在删除重建/改 identifier 时丢失——把自定义收敛进插件（+可选 postinit patch 脚本）；④SD 卡/OTG 卷路径映射不可靠，v1 只承诺 primary 卷。

## 主要来源

- https://developer.android.com/training/data-storage/manage-all-files
- https://developer.android.com/about/versions/11/privacy/storage
- https://developer.android.com/training/data-storage/shared/media
- https://source.android.com/docs/core/storage/scoped
- https://developer.android.com/reference/android/provider/Settings （ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION）
- https://android.googlesource.com/platform/frameworks/base/+/master/services/core/java/com/android/server/uri/UriGrantsManagerService.java （512 上限）
- https://commonsware.com/blog/2020/06/13/count-your-saf-uri-permission-grants.html
- https://bayton.org/android/android-minimum-targetsdk-matrix/ ；https://www.androidpolice.com/android-15-blocks-android-marshmallow-apps/ ；https://developer.android.com/about/versions/14/behavior-changes-14
- https://stackoverflow.com/questions/34927748/android-5-0-documentfile-from-tree-uri （tree URI→路径）
- https://github.com/tauri-apps/tauri/blob/5712549c/crates/tauri-cli/src/mobile/android/project.rs ；https://github.com/tauri-apps/tauri/issues/10065
- https://v2.tauri.app/develop/plugins/develop-mobile/ ；https://v2.tauri.app/develop/plugins/
- https://github.com/aiueo13/tauri-plugin-android-fs ；https://github.com/daniele-rolli/tauri-plugin-scoped-storage ；https://github.com/Afeather2017/tauri-plugin-android-external-storage （crates.io API 核实版本/日期）
- https://github.com/tauri-apps/plugins-workspace/issues/933 ；/issues/2749 ；https://github.com/tauri-apps/tauri/issues/14587
- https://developer.android.com/reference/kotlin/android/net/nsd/NsdManager ；https://developer.android.com/reference/android/net/wifi/WifiManager.MulticastLock
- https://github.com/keepsimple1/mdns-sd/pull/469 ；https://github.com/phantomptr/ps5upload/commit/ea08fd5509eba19504a1b22883666fa73b8a3216 ；https://github.com/andriydruk/RxDNSSD/issues/54
