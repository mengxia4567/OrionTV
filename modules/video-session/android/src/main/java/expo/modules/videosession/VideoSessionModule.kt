package expo.modules.videosession

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.support.v4.media.MediaMetadataCompat
import android.support.v4.media.session.MediaSessionCompat
import android.support.v4.media.session.PlaybackStateCompat
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import androidx.media.app.NotificationCompat.MediaStyle
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.net.HttpURLConnection
import java.net.URL

/**
 * 视频（点播 / 直播）的系统媒体会话 + 通知栏卡片。
 *
 * 画面仍由 expo-av 播放；这里只负责「通知栏 / 锁屏 / 耳机线控」这一层：
 *   JS → start(标题, 副标题, 封面, 能否换集/换台, 是否直播) 创建会话并显示通知
 *   JS → update(是否播放, 进度, 时长, 倍速) 同步状态（通知卡片的进度条由系统按此绘制）
 *   通知按钮 / 系统媒体键 → 经 onAction 事件回给 JS（play / pause / next / prev / seek）
 * 点通知只是把 App 带回前台（不带任何链接，保持用户停留的页面不变）。
 */
class VideoSessionModule : Module() {
  companion object {
    private const val CHANNEL_ID = "video_playback"
    const val NOTIF_ID = 7301

    /** 交给前台服务挂载的通知；仅在播放中有值 */
    @Volatile var currentNotification: android.app.Notification? = null
    @Volatile private var instance: VideoSessionModule? = null

    /** 用户划掉最近任务时由服务回调：清掉通知与会话 */
    fun releaseFromService() {
      instance?.let { m -> m.main.post { m.release() } }
    }
    private const val ACT_PLAY = "com.oriontv.video.PLAY"
    private const val ACT_PAUSE = "com.oriontv.video.PAUSE"
    private const val ACT_NEXT = "com.oriontv.video.NEXT"
    private const val ACT_PREV = "com.oriontv.video.PREV"
    private const val ACT_DISMISS = "com.oriontv.video.DISMISS"
  }

  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()
  private val main = Handler(Looper.getMainLooper())

  private var foregroundActive = false
  private var session: MediaSessionCompat? = null
  private var receiver: BroadcastReceiver? = null

  private var title = ""
  private var subtitle = ""
  private var artwork: Bitmap? = null
  private var artworkUrl: String? = null
  private var canSkip = false
  private var isLive = false
  private var playing = false
  private var positionMs = 0L
  private var durationMs = 0L
  private var rate = 1f

  override fun definition() = ModuleDefinition {
    Name("VideoSession")
    OnCreate { instance = this@VideoSessionModule }
    Events("onAction")

    Function("start") { t: String, sub: String?, art: String?, skip: Boolean, live: Boolean ->
      main.post { start(t, sub ?: "", art, skip, live) }
    }
    Function("update") { isPlaying: Boolean, pos: Double, dur: Double, r: Double ->
      main.post { update(isPlaying, pos.toLong(), dur.toLong(), r.toFloat()) }
    }
    Function("stop") { main.post { release() } }

    OnDestroy { main.post { release() } }
  }

  private fun emit(action: String, pos: Long = -1) {
    sendEvent("onAction", mapOf("action" to action, "positionMs" to pos))
  }

  private fun ensureSession() {
    if (session != null) return
    val s = MediaSessionCompat(context, "VideoSession")
    s.setCallback(object : MediaSessionCompat.Callback() {
      override fun onPlay() = emit("play")
      override fun onPause() = emit("pause")
      override fun onSkipToNext() = emit("next")
      override fun onSkipToPrevious() = emit("prev")
      override fun onSeekTo(pos: Long) = emit("seek", pos)
      override fun onStop() = emit("pause")
    })
    s.isActive = true
    session = s

    val filter = IntentFilter().apply {
      addAction(ACT_PLAY); addAction(ACT_PAUSE); addAction(ACT_NEXT); addAction(ACT_PREV); addAction(ACT_DISMISS)
    }
    val r = object : BroadcastReceiver() {
      override fun onReceive(c: Context?, intent: Intent?) {
        when (intent?.action) {
          ACT_PLAY -> emit("play")
          ACT_PAUSE -> emit("pause")
          ACT_NEXT -> emit("next")
          ACT_PREV -> emit("prev")
          ACT_DISMISS -> main.post { release() }
        }
      }
    }
    ContextCompat.registerReceiver(context, r, filter, ContextCompat.RECEIVER_NOT_EXPORTED)
    receiver = r

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val ch = NotificationChannel(CHANNEL_ID, "视频播放", NotificationManager.IMPORTANCE_LOW)
      ch.setShowBadge(false)
      ch.lockscreenVisibility = android.app.Notification.VISIBILITY_PUBLIC
      (context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).createNotificationChannel(ch)
    }
  }

  private fun start(t: String, sub: String, art: String?, skip: Boolean, live: Boolean) {
    ensureSession()
    val changed = t != title || art != artworkUrl
    title = t; subtitle = sub; canSkip = skip; isLive = live
    if (changed) {
      positionMs = 0; durationMs = 0
      artwork = null; artworkUrl = art
      if (!art.isNullOrEmpty()) loadArtwork(art)
    }
    pushMetadata()
    pushState()
    pushNotification()
  }

  private fun update(isPlaying: Boolean, pos: Long, dur: Long, r: Float) {
    if (session == null) return
    val flipped = isPlaying != playing
    val durChanged = dur != durationMs && dur > 0
    playing = isPlaying; positionMs = pos; rate = if (r > 0) r else 1f
    if (durChanged) { durationMs = dur; pushMetadata() }
    pushState()
    if (flipped) pushNotification()
  }

  private fun pushMetadata() {
    val b = MediaMetadataCompat.Builder()
      .putString(MediaMetadataCompat.METADATA_KEY_TITLE, title)
      .putString(MediaMetadataCompat.METADATA_KEY_ARTIST, subtitle)
      .putLong(MediaMetadataCompat.METADATA_KEY_DURATION, if (isLive || durationMs <= 0) -1 else durationMs)
    artwork?.let { b.putBitmap(MediaMetadataCompat.METADATA_KEY_ALBUM_ART, it) }
    session?.setMetadata(b.build())
  }

  private fun pushState() {
    var actions = PlaybackStateCompat.ACTION_PLAY or PlaybackStateCompat.ACTION_PAUSE or
      PlaybackStateCompat.ACTION_PLAY_PAUSE or PlaybackStateCompat.ACTION_STOP
    if (!isLive) actions = actions or PlaybackStateCompat.ACTION_SEEK_TO
    if (canSkip) actions = actions or PlaybackStateCompat.ACTION_SKIP_TO_NEXT or PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS
    val state = if (playing) PlaybackStateCompat.STATE_PLAYING else PlaybackStateCompat.STATE_PAUSED
    val pos = if (isLive) PlaybackStateCompat.PLAYBACK_POSITION_UNKNOWN else positionMs
    session?.setPlaybackState(
      PlaybackStateCompat.Builder().setActions(actions).setState(state, pos, if (playing) rate else 0f).build()
    )
  }

  private fun pi(action: String, code: Int): PendingIntent =
    PendingIntent.getBroadcast(
      context, code, Intent(action).setPackage(context.packageName),
      PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
    )

  private fun pushNotification() {
    val s = session ?: return
    val launch = context.packageManager.getLaunchIntentForPackage(context.packageName)?.apply {
      flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP
    }
    val content = launch?.let {
      PendingIntent.getActivity(context, 0, it, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    }
    val b = NotificationCompat.Builder(context, CHANNEL_ID)
      .setSmallIcon(if (playing) android.R.drawable.ic_media_play else android.R.drawable.ic_media_pause)
      .setContentTitle(title)
      .setContentText(subtitle)
      .setLargeIcon(artwork)
      .setContentIntent(content)
      .setDeleteIntent(pi(ACT_DISMISS, 5))
      .setOnlyAlertOnce(true)
      .setShowWhen(false)
      .setOngoing(playing)
      .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
      .setCategory(NotificationCompat.CATEGORY_TRANSPORT)
      .setPriority(NotificationCompat.PRIORITY_LOW)

    val compact = ArrayList<Int>()
    if (canSkip) { b.addAction(android.R.drawable.ic_media_previous, "上一个", pi(ACT_PREV, 1)); compact.add(0) }
    if (playing) b.addAction(android.R.drawable.ic_media_pause, "暂停", pi(ACT_PAUSE, 2))
    else b.addAction(android.R.drawable.ic_media_play, "播放", pi(ACT_PLAY, 3))
    compact.add(if (canSkip) 1 else 0)
    if (canSkip) { b.addAction(android.R.drawable.ic_media_next, "下一个", pi(ACT_NEXT, 4)); compact.add(2) }

    b.setStyle(MediaStyle().setMediaSession(s.sessionToken).setShowActionsInCompactView(*compact.toIntArray()))

    val n = b.build()
    try {
      val nm = NotificationManagerCompat.from(context)
      if (nm.areNotificationsEnabled()) nm.notify(NOTIF_ID, n)
    } catch (_: SecurityException) {
      // 没有通知权限：静默忽略，播放不受影响
    }
    syncForegroundService(n)
  }

  /** 播放中挂前台服务（保活 + 划掉清理）；暂停时放开（通知保留）。后台启动被系统拒绝时静默降级为普通通知 */
  private fun syncForegroundService(n: android.app.Notification) {
    val intent = Intent(context, VideoSessionService::class.java)
    try {
      if (playing) {
        currentNotification = n
        ContextCompat.startForegroundService(context, intent)
        foregroundActive = true
      } else if (foregroundActive) {
        currentNotification = null
        foregroundActive = false
        context.startService(intent.setAction(VideoSessionService.ACTION_DETACH))
      }
    } catch (_: Exception) {
      // ForegroundServiceStartNotAllowed 等：不影响通知与播放
    }
  }

  private fun loadArtwork(url: String) {
    Thread {
      try {
        val conn = URL(url).openConnection() as HttpURLConnection
        conn.connectTimeout = 8000
        conn.readTimeout = 8000
        val bytes = conn.inputStream.use { it.readBytes() }
        val opts = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size, opts)
        var sample = 1
        while (opts.outWidth / sample > 600) sample *= 2
        val bmp = BitmapFactory.decodeByteArray(bytes, 0, bytes.size, BitmapFactory.Options().apply { inSampleSize = sample })
        main.post {
          if (bmp != null && url == artworkUrl && session != null) {
            artwork = bmp
            pushMetadata()
            pushNotification()
          }
        }
      } catch (_: Exception) {
        // 封面拿不到就不显示，不影响通知本身
      }
    }.start()
  }

  private fun release() {
    currentNotification = null
    foregroundActive = false
    try { context.stopService(Intent(context, VideoSessionService::class.java)) } catch (_: Exception) {}
    try { NotificationManagerCompat.from(context).cancel(NOTIF_ID) } catch (_: Exception) {}
    receiver?.let { try { context.unregisterReceiver(it) } catch (_: Exception) {} }
    receiver = null
    session?.isActive = false
    session?.release()
    session = null
    artwork = null; artworkUrl = null; title = ""; playing = false
  }
}
