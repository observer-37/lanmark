package com.lanmark.app

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import androidx.core.content.ContextCompat

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    // Android 15+（targetSdk 35+）系统强制 edge-to-edge：WebView 铺满到状态栏底下，
    // 固定定位的 UI（抽屉按钮）与状态栏重叠且点不到（真机验收发现，删
    // enableEdgeToEdge 无效——强制行为来自 targetSdk）。这里强制内容避开系统栏：
    window.decorView.fitsSystemWindows = true
    window.decorView.setOnApplyWindowInsetsListener { v, insets ->
      val bars = insets.getInsets(android.view.WindowInsets.Type.systemBars())
      v.setPadding(v.paddingLeft, bars.top, v.paddingRight, bars.bottom)
      insets
    }
    // M2：通知运行时权限（Android 13+；不授予只影响常驻通知显示，不影响前台服务本身）
    if (Build.VERSION.SDK_INT >= 33 &&
      ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
      != PackageManager.PERMISSION_GRANTED
    ) {
      requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), REQUEST_NOTIFICATIONS)
    }
    // 同步服务器前台服务保活（Rust 侧 axum 在 vault 打开后启动，见 commands.rs）
    SyncService.start(this)
  }

  companion object {
    private const val REQUEST_NOTIFICATIONS = 4180
  }
}
