package expo.modules.wavepcmplayer

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioTrack
import android.os.Build
import android.os.SystemClock
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledExecutorService
import java.util.concurrent.TimeUnit
import kotlin.math.max

private const val MAX_CHUNK_BYTES = 512 * 1024
private const val MAX_QUEUED_SECONDS = 12

private data class PlaybackSession(
  val audioManager: AudioManager,
  val audioTrack: AudioTrack,
  val channels: Int,
  val focusListener: AudioManager.OnAudioFocusChangeListener,
  val focusRequest: AudioFocusRequest?,
  val generation: Long,
  val sampleRate: Int,
  var finishing: Boolean = false,
  var finishPromise: Promise? = null,
  var pendingBytes: Int = 0,
  var playedFrames: Long = 0,
  var state: String = "buffering",
  var writtenFrames: Long = 0,
)

class WavePcmPlayerModule : Module() {
  private val executor: ScheduledExecutorService = Executors.newSingleThreadScheduledExecutor()
  private val lock = Any()
  private var generation = 0L
  private var session: PlaybackSession? = null

  override fun definition() = ModuleDefinition {
    Name("WavePcmPlayer")

    Events("onPlaybackStateChanged")

    AsyncFunction("startAsync") { sampleRate: Int, channels: Int, promise: Promise ->
      val requestedGeneration = synchronized(lock) { generation }
      executor.execute {
        startOnExecutor(sampleRate, channels, requestedGeneration, promise)
      }
    }

    AsyncFunction("writeAsync") { data: ByteArray, promise: Promise ->
      val target = synchronized(lock) {
        val active = session
        if (active == null) {
          promise.reject("E_PCM_INACTIVE", "No PCM playback session is active.", null)
          return@AsyncFunction
        }
        if (active.finishing) {
          promise.reject("E_PCM_FINISHING", "The PCM playback session is already draining.", null)
          return@AsyncFunction
        }
        val bytesPerFrame = active.channels * Short.SIZE_BYTES
        if (data.isEmpty() || data.size > MAX_CHUNK_BYTES || data.size % bytesPerFrame != 0) {
          promise.reject(
            "E_PCM_CHUNK",
            "PCM chunks must contain complete interleaved Int16 frames within the bounded chunk size.",
            null,
          )
          return@AsyncFunction
        }
        val queuedBytesLimit = active.sampleRate * bytesPerFrame * MAX_QUEUED_SECONDS
        if (active.pendingBytes + data.size > queuedBytesLimit) {
          promise.reject("E_PCM_OVERFLOW", "The PCM playback queue exceeded its bounded capacity.", null)
          return@AsyncFunction
        }
        active.pendingBytes += data.size
        active
      }
      executor.execute { writeOnExecutor(target, data, promise) }
    }

    AsyncFunction("finishAsync") { promise: Promise ->
      val target = synchronized(lock) {
        val active = session
        if (active == null) {
          promise.reject("E_PCM_INACTIVE", "No PCM playback session is active.", null)
          return@AsyncFunction
        }
        if (active.finishing) {
          promise.reject("E_PCM_FINISHING", "The PCM playback session is already draining.", null)
          return@AsyncFunction
        }
        active.finishing = true
        active.finishPromise = promise
        active.state = "draining"
        active
      }
      emitStatus(target)
      executor.execute { checkDrained(target, deadlineFor(target)) }
    }

    AsyncFunction("stopAsync") { promise: Promise ->
      promise.resolve(
        stopNow("stopped") ?: mapOf(
          "outcome" to "stopped",
          "playedFrames" to 0.0,
          "writtenFrames" to 0.0,
        ),
      )
    }

    AsyncFunction("getStatusAsync") { promise: Promise ->
      val payload = synchronized(lock) {
        session?.let(::statusPayload) ?: idlePayload()
      }
      promise.resolve(payload)
    }

    OnActivityEntersBackground {
      stopNow("backgrounded")
    }

    OnActivityDestroys {
      stopNow("destroyed")
    }

    OnDestroy {
      stopNow("destroyed")
      executor.shutdownNow()
    }
  }

  private fun startOnExecutor(
    sampleRate: Int,
    channels: Int,
    requestedGeneration: Long,
    promise: Promise,
  ) {
    if (sampleRate !in 8_000..48_000 || channels !in 1..2) {
      promise.reject(
        "E_PCM_FORMAT",
        "PCM playback requires an 8000-48000 Hz sample rate and one or two channels.",
        null,
      )
      return
    }
    synchronized(lock) {
      if (generation != requestedGeneration) {
        promise.reject("E_PCM_STOPPED", "PCM playback was stopped before it could start.", null)
        return
      }
      if (session != null) {
        promise.reject("E_PCM_ACTIVE", "A PCM playback session is already active.", null)
        return
      }
    }

    val context = appContext.reactContext
    if (context == null) {
      promise.reject("E_PCM_UNAVAILABLE", "The Android application context is unavailable.", null)
      return
    }
    val audioManager = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
    val channelMask = if (channels == 1) {
      AudioFormat.CHANNEL_OUT_MONO
    } else {
      AudioFormat.CHANNEL_OUT_STEREO
    }
    val minBufferBytes = AudioTrack.getMinBufferSize(
      sampleRate,
      channelMask,
      AudioFormat.ENCODING_PCM_16BIT,
    )
    if (minBufferBytes <= 0) {
      promise.reject("E_PCM_FORMAT", "Android rejected the requested PCM output format.", null)
      return
    }

    val attributes = AudioAttributes.Builder()
      .setUsage(AudioAttributes.USAGE_MEDIA)
      .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
      .build()
    val format = AudioFormat.Builder()
      .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
      .setSampleRate(sampleRate)
      .setChannelMask(channelMask)
      .build()
    val targetBufferBytes = max(minBufferBytes, sampleRate * channels * Short.SIZE_BYTES / 5)

    val track = try {
      AudioTrack.Builder()
        .setAudioAttributes(attributes)
        .setAudioFormat(format)
        .setBufferSizeInBytes(targetBufferBytes)
        .setTransferMode(AudioTrack.MODE_STREAM)
        .build()
    } catch (error: Exception) {
      promise.reject("E_PCM_START", "Wave could not create the Android PCM player.", error)
      return
    }
    if (track.state != AudioTrack.STATE_INITIALIZED) {
      track.release()
      promise.reject("E_PCM_START", "Android could not initialize PCM playback.", null)
      return
    }

    lateinit var focusListener: AudioManager.OnAudioFocusChangeListener
    focusListener = AudioManager.OnAudioFocusChangeListener { focusChange ->
      if (
        focusChange == AudioManager.AUDIOFOCUS_LOSS ||
        focusChange == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT
      ) {
        stopNow("interrupted")
      }
    }
    val focusRequest = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT)
        .setAudioAttributes(attributes)
        .setOnAudioFocusChangeListener(focusListener)
        .build()
    } else {
      null
    }
    val focusResult = if (focusRequest != null) {
      audioManager.requestAudioFocus(focusRequest)
    } else {
      @Suppress("DEPRECATION")
      audioManager.requestAudioFocus(
        focusListener,
        AudioManager.STREAM_MUSIC,
        AudioManager.AUDIOFOCUS_GAIN_TRANSIENT,
      )
    }
    if (focusResult != AudioManager.AUDIOFOCUS_REQUEST_GRANTED) {
      track.release()
      promise.reject("E_PCM_FOCUS", "Android did not grant audio focus for PCM playback.", null)
      return
    }

    val created = PlaybackSession(
      audioManager = audioManager,
      audioTrack = track,
      channels = channels,
      focusListener = focusListener,
      focusRequest = focusRequest,
      generation = requestedGeneration,
      sampleRate = sampleRate,
    )
    synchronized(lock) {
      if (generation != requestedGeneration || session != null) {
        abandonFocus(created)
        track.release()
        promise.reject("E_PCM_STOPPED", "PCM playback was stopped before it could start.", null)
        return
      }
      session = created
    }

    try {
      track.play()
    } catch (error: Exception) {
      synchronized(lock) {
        if (session === created) session = null
      }
      abandonFocus(created)
      track.release()
      promise.reject("E_PCM_START", "Wave could not start Android PCM playback.", error)
      return
    }
    emitStatus(created)
    promise.resolve()
  }

  private fun writeOnExecutor(target: PlaybackSession, data: ByteArray, promise: Promise) {
    try {
      if (!isCurrent(target)) {
        promise.reject("E_PCM_STOPPED", "PCM playback stopped before the chunk could play.", null)
        return
      }
      var offset = 0
      while (offset < data.size) {
        val written = target.audioTrack.write(
          data,
          offset,
          data.size - offset,
          AudioTrack.WRITE_BLOCKING,
        )
        if (written <= 0) {
          throw IllegalStateException("AudioTrack write failed with code $written")
        }
        offset += written
      }

      var firstChunk = false
      synchronized(lock) {
        if (session === target) {
          target.writtenFrames += data.size / (target.channels * Short.SIZE_BYTES)
          if (target.state == "buffering") {
            target.state = "playing"
            firstChunk = true
          }
        }
      }
      if (!isCurrent(target)) {
        promise.reject("E_PCM_STOPPED", "PCM playback stopped before the chunk could play.", null)
        return
      }
      if (firstChunk) emitStatus(target)
      promise.resolve()
    } catch (error: Exception) {
      if (isCurrent(target)) {
        stopNow("failed")
        promise.reject("E_PCM_WRITE", "Android could not accept a PCM audio chunk.", error)
      } else {
        promise.reject("E_PCM_STOPPED", "PCM playback stopped before the chunk could play.", null)
      }
    } finally {
      synchronized(lock) {
        target.pendingBytes = max(0, target.pendingBytes - data.size)
      }
    }
  }

  private fun checkDrained(target: PlaybackSession, deadline: Long) {
    if (!isCurrent(target)) return

    val playedFrames = target.audioTrack.playbackHeadPosition.toLong() and 0xffffffffL
    synchronized(lock) {
      if (session === target) target.playedFrames = playedFrames
    }
    if (playedFrames >= target.writtenFrames && target.pendingBytes == 0) {
      complete(target, "drained")
      return
    }
    if (SystemClock.elapsedRealtime() >= deadline) {
      complete(target, "failed")
      return
    }
    executor.schedule({ checkDrained(target, deadline) }, 10, TimeUnit.MILLISECONDS)
  }

  private fun deadlineFor(target: PlaybackSession): Long {
    val queuedFrames = max(0, target.writtenFrames - target.playedFrames)
    val remainingMs = queuedFrames * 1_000 / target.sampleRate
    return SystemClock.elapsedRealtime() + remainingMs + 3_000
  }

  private fun complete(target: PlaybackSession, reason: String) {
    val finish = synchronized(lock) {
      if (session !== target) return
      session = null
      generation += 1
      val promise = target.finishPromise
      target.finishPromise = null
      promise
    }
    release(target)
    sendEvent("onPlaybackStateChanged", idlePayload(reason, target))
    finish?.resolve(completionPayload(reason, target))
  }

  private fun stopNow(reason: String): Map<String, Any>? {
    val target = synchronized(lock) {
      generation += 1
      val active = session
      session = null
      active
    } ?: return null
    val finish = target.finishPromise
    target.finishPromise = null
    release(target)
    sendEvent("onPlaybackStateChanged", idlePayload(reason, target))
    val completion = completionPayload(reason, target)
    finish?.resolve(completion)
    return completion
  }

  private fun release(target: PlaybackSession) {
    try {
      target.audioTrack.pause()
      target.audioTrack.flush()
      target.audioTrack.stop()
    } catch (_: Exception) {
      // The track can already be stopped by an OS interruption.
    }
    target.audioTrack.release()
    abandonFocus(target)
  }

  private fun abandonFocus(target: PlaybackSession) {
    if (target.focusRequest != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      target.audioManager.abandonAudioFocusRequest(target.focusRequest)
    } else {
      @Suppress("DEPRECATION")
      target.audioManager.abandonAudioFocus(target.focusListener)
    }
  }

  private fun isCurrent(target: PlaybackSession): Boolean = synchronized(lock) {
    session === target && generation == target.generation
  }

  private fun emitStatus(target: PlaybackSession) {
    sendEvent("onPlaybackStateChanged", synchronized(lock) { statusPayload(target) })
  }

  private fun statusPayload(target: PlaybackSession): Map<String, Any> {
    val played = if (session === target) {
      target.audioTrack.playbackHeadPosition.toLong() and 0xffffffffL
    } else {
      target.playedFrames
    }
    val queuedFrames = max(0, target.writtenFrames - played)
    return mapOf(
      "channels" to target.channels,
      "playedFrames" to played.toDouble(),
      "queuedDurationMs" to queuedFrames.toDouble() / target.sampleRate * 1_000,
      "sampleRate" to target.sampleRate,
      "state" to target.state,
      "writtenFrames" to target.writtenFrames.toDouble(),
    )
  }

  private fun idlePayload(
    reason: String? = null,
    previous: PlaybackSession? = null,
  ): Map<String, Any> = buildMap {
    put("channels", previous?.channels ?: 0)
    put("playedFrames", previous?.playedFrames?.toDouble() ?: 0.0)
    put("queuedDurationMs", 0.0)
    put("sampleRate", previous?.sampleRate ?: 0)
    put("state", "idle")
    put("writtenFrames", previous?.writtenFrames?.toDouble() ?: 0.0)
    if (reason != null) put("reason", reason)
  }

  private fun completionPayload(
    outcome: String,
    target: PlaybackSession,
  ): Map<String, Any> = mapOf(
    "outcome" to outcome,
    "playedFrames" to target.playedFrames.toDouble(),
    "writtenFrames" to target.writtenFrames.toDouble(),
  )
}
