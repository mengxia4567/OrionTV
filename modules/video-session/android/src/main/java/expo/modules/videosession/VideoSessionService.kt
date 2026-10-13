package expo.modules.videosession

import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder

/**
 * 视频播放期间的前台服务：让进程在后台（回桌面 / 息屏）仍然存活，通知栏按钮才有效；
 * 用户把 App 从最近任务划掉时清理通知，避免留下点了没反应的「僵尸」通知。
 * 通知内容由 [VideoSessionModule] 构建，这里只负责把它挂成前台通知。
 */
class VideoSessionService : Service() {
  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (intent?.action == ACTION_DETACH) {
      // 暂停：放开前台服务但保留通知（仍可点播放继续、也可左滑清除）
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
        stopForeground(STOP_FOREGROUND_DETACH)
      } else {
        @Suppress("DEPRECATION") stopForeground(false)
      }
      stopSelf()
      return START_NOT_STICKY
    }
    val n = VideoSessionModule.currentNotification
    if (n == null) {
      stopSelf()
      return START_NOT_STICKY
    }
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      startForeground(VideoSessionModule.NOTIF_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK)
    } else {
      startForeground(VideoSessionModule.NOTIF_ID, n)
    }
    return START_NOT_STICKY
  }

  override fun onTaskRemoved(rootIntent: Intent?) {
    VideoSessionModule.releaseFromService()
    stopSelf()
  }

  companion object {
    const val ACTION_DETACH = "com.oriontv.video.DETACH"
  }
}
