package com.lanmark.app

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import androidx.activity.enableEdgeToEdge
import androidx.core.content.ContextCompat

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
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
