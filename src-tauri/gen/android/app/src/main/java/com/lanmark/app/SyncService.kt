package com.lanmark.app

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.wifi.WifiManager
import android.os.Build
import android.os.IBinder
import androidx.core.app.ServiceCompat

/**
 * M2 同步中心节点保活：前台服务（specialUse）+ 常驻通知「Lanmark 同步中」。
 * Rust 侧 axum 服务器（0.0.0.0:4180，见 src-tauri/src/sync_server.rs）运行在
 * 同一进程内；本服务只负责把进程提到前台重要性、熄屏后退后台仍存活。
 * START_STICKY：进程被 LMK 杀掉后系统尽力重建服务（Rust 侧随 App 下次打开恢复）。
 */
class SyncService : Service() {

  private var multicastLock: WifiManager.MulticastLock? = null

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onCreate() {
    super.onCreate()
    createChannel()
    // mDNS 收包需要多播锁（WiFi 栈默认丢弃多播帧）；随服务生命周期持有
    val wifi = applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager
    multicastLock = wifi.createMulticastLock("lanmark-mdns").apply {
      setReferenceCounted(false)
      acquire()
    }
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val notification = notification()
    // Android 14 (API 34)+ 必须显式传 FGS 类型；未在 manifest 声明会抛 IllegalArgumentException
    if (Build.VERSION.SDK_INT >= 34) {
      ServiceCompat.startForeground(
        this,
        NOTIFICATION_ID,
        notification,
        ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE,
      )
    } else {
      startForeground(NOTIFICATION_ID, notification)
    }
    return START_STICKY
  }

  override fun onDestroy() {
    multicastLock?.takeIf { it.isHeld }?.release()
    multicastLock = null
    super.onDestroy()
  }

  private fun createChannel() {
    val manager = getSystemService(NOTIFICATION_SERVICE) as NotificationManager
    manager.createNotificationChannel(
      NotificationChannel(CHANNEL_ID, "Lanmark 同步", NotificationManager.IMPORTANCE_LOW).apply {
        description = "局域网同步服务器运行中"
        setShowBadge(false)
      }
    )
  }

  private fun notification(): Notification {
    val builder = if (Build.VERSION.SDK_INT >= 26) {
      Notification.Builder(this, CHANNEL_ID)
    } else {
      @Suppress("DEPRECATION")
      Notification.Builder(this)
    }
    return builder
      .setContentTitle("Lanmark 同步中")
      .setContentText("本机作为局域网同步中心，供桌面端连接")
      .setSmallIcon(android.R.drawable.stat_notify_sync)
      .setOngoing(true)
      .build()
  }

  companion object {
    private const val CHANNEL_ID = "lanmark_sync"
    private const val NOTIFICATION_ID = 4180

    /** 从 MainActivity（前台上下文）启动，避开 Android 12+ 后台启动限制 */
    fun start(context: Context) {
      context.startForegroundService(Intent(context, SyncService::class.java))
    }
  }
}
