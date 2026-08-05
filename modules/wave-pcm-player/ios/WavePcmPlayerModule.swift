import AVFoundation
import ExpoModulesCore

private let maxChunkBytes = 512 * 1024
private let maxQueuedSeconds = 12.0

private final class PcmPlaybackEngine {
  private let queue = DispatchQueue(label: "com.renanqueiroz.wave.pcm-playback")
  private let emit: ([String: Any]) -> Void

  private var audioEngine: AVAudioEngine?
  private var audioPlayer: AVAudioPlayerNode?
  private var channels = 0
  private var finishPromise: Promise?
  private var finishing = false
  private var generation: UInt64 = 0
  private var interruptionObserver: NSObjectProtocol?
  private var playedFrames: Int64 = 0
  private var queuedFrames: Int64 = 0
  private var sampleRate = 0
  private var state = "idle"
  private var writtenFrames: Int64 = 0

  init(emit: @escaping ([String: Any]) -> Void) {
    self.emit = emit
  }

  func start(sampleRate requestedSampleRate: Int, channels requestedChannels: Int, promise: Promise) {
    queue.async { [weak self] in
      guard let self else {
        promise.reject("E_PCM_UNAVAILABLE", "The PCM playback engine is unavailable.")
        return
      }
      guard self.audioEngine == nil else {
        promise.reject("E_PCM_ACTIVE", "A PCM playback session is already active.")
        return
      }
      guard (8_000...48_000).contains(requestedSampleRate) else {
        promise.reject("E_PCM_FORMAT", "PCM sample rate must be between 8000 and 48000 Hz.")
        return
      }
      guard requestedChannels == 1 || requestedChannels == 2 else {
        promise.reject("E_PCM_FORMAT", "PCM playback supports one or two interleaved channels.")
        return
      }
      guard let format = AVAudioFormat(
        commonFormat: .pcmFormatInt16,
        sampleRate: Double(requestedSampleRate),
        channels: AVAudioChannelCount(requestedChannels),
        interleaved: true
      ) else {
        promise.reject("E_PCM_FORMAT", "The requested PCM format is not supported by this device.")
        return
      }

      let engine = AVAudioEngine()
      let player = AVAudioPlayerNode()
      let session = AVAudioSession.sharedInstance()

      do {
        try session.setCategory(.playback, mode: .spokenAudio)
        try session.setActive(true)
        engine.attach(player)
        engine.connect(player, to: engine.mainMixerNode, format: format)
        engine.prepare()
        try engine.start()
        player.play()
      } catch {
        player.stop()
        engine.stop()
        try? session.setActive(false, options: .notifyOthersOnDeactivation)
        promise.reject("E_PCM_START", "Wave could not start PCM playback: \(error.localizedDescription)")
        return
      }

      self.generation &+= 1
      self.audioEngine = engine
      self.audioPlayer = player
      self.sampleRate = requestedSampleRate
      self.channels = requestedChannels
      self.queuedFrames = 0
      self.playedFrames = 0
      self.writtenFrames = 0
      self.finishing = false
      self.finishPromise = nil
      self.state = "buffering"
      self.observeInterruptions(session: session, generation: self.generation)
      self.emitStatus()
      promise.resolve()
    }
  }

  func write(data: Data, promise: Promise) {
    queue.async { [weak self] in
      guard let self, let player = self.audioPlayer, let engine = self.audioEngine else {
        promise.reject("E_PCM_INACTIVE", "No PCM playback session is active.")
        return
      }
      guard !self.finishing else {
        promise.reject("E_PCM_FINISHING", "The PCM playback session is already draining.")
        return
      }
      guard !data.isEmpty, data.count <= maxChunkBytes else {
        promise.reject("E_PCM_CHUNK", "PCM chunks must contain between 1 and \(maxChunkBytes) bytes.")
        return
      }

      let bytesPerFrame = self.channels * MemoryLayout<Int16>.size
      guard data.count.isMultiple(of: bytesPerFrame) else {
        promise.reject("E_PCM_CHUNK", "PCM chunks must contain complete interleaved Int16 frames.")
        return
      }
      let frameCount = data.count / bytesPerFrame
      let maxQueuedFrames = Int64(Double(self.sampleRate) * maxQueuedSeconds)
      guard self.queuedFrames + Int64(frameCount) <= maxQueuedFrames else {
        promise.reject("E_PCM_OVERFLOW", "The PCM playback queue exceeded its bounded capacity.")
        return
      }
      guard engine.isRunning else {
        self.complete(reason: "failed", outcome: "failed")
        promise.reject("E_PCM_STOPPED", "The native audio engine stopped before the chunk could play.")
        return
      }
      guard let format = AVAudioFormat(
        commonFormat: .pcmFormatInt16,
        sampleRate: Double(self.sampleRate),
        channels: AVAudioChannelCount(self.channels),
        interleaved: true
      ), let buffer = AVAudioPCMBuffer(
        pcmFormat: format,
        frameCapacity: AVAudioFrameCount(frameCount)
      ) else {
        promise.reject("E_PCM_BUFFER", "Wave could not allocate a PCM playback buffer.")
        return
      }

      buffer.frameLength = AVAudioFrameCount(frameCount)
      let audioBuffers = UnsafeMutableAudioBufferListPointer(buffer.mutableAudioBufferList)
      guard let destination = audioBuffers.first?.mData else {
        promise.reject("E_PCM_BUFFER", "Wave could not access the PCM playback buffer.")
        return
      }
      data.copyBytes(to: destination.assumingMemoryBound(to: UInt8.self), count: data.count)

      let scheduledGeneration = self.generation
      let scheduledFrames = Int64(frameCount)
      self.queuedFrames += scheduledFrames
      self.writtenFrames += scheduledFrames
      player.scheduleBuffer(buffer, completionCallbackType: .dataPlayedBack) { [weak self] _ in
        self?.queue.async { [weak self] in
          self?.didPlay(frames: scheduledFrames, generation: scheduledGeneration)
        }
      }

      if self.state == "buffering" {
        self.state = "playing"
        self.emitStatus()
      }
      promise.resolve()
    }
  }

  func finish(promise: Promise) {
    queue.async { [weak self] in
      guard let self, self.audioEngine != nil else {
        promise.reject("E_PCM_INACTIVE", "No PCM playback session is active.")
        return
      }
      guard !self.finishing else {
        promise.reject("E_PCM_FINISHING", "The PCM playback session is already draining.")
        return
      }

      self.finishing = true
      self.finishPromise = promise
      self.state = "draining"
      self.emitStatus()

      if self.queuedFrames == 0 {
        self.complete(reason: "drained", outcome: "drained")
        return
      }

      let expectedGeneration = self.generation
      let remainingSeconds = Double(self.queuedFrames) / Double(self.sampleRate)
      self.queue.asyncAfter(deadline: .now() + remainingSeconds + 3) { [weak self] in
        guard let self,
              self.generation == expectedGeneration,
              self.finishing,
              self.queuedFrames > 0 else {
          return
        }
        self.complete(reason: "failed", outcome: "failed")
      }
    }
  }

  func stop(reason: String = "stopped", promise: Promise? = nil) {
    // Retain the engine only until this block runs so OnDestroy cannot release
    // the final owner before native audio cleanup completes.
    queue.async { [self] in
      if self.audioEngine != nil {
        promise?.resolve(self.complete(reason: reason, outcome: reason))
      } else {
        promise?.resolve([
          "outcome": reason,
          "playedFrames": 0,
          "writtenFrames": 0
        ])
      }
    }
  }

  func status(promise: Promise) {
    queue.async { [weak self] in
      guard let self else {
        promise.reject("E_PCM_UNAVAILABLE", "The PCM playback engine is unavailable.")
        return
      }
      promise.resolve(self.statusPayload())
    }
  }

  func shutdown() {
    stop(reason: "destroyed")
  }

  private func didPlay(frames: Int64, generation expectedGeneration: UInt64) {
    guard generation == expectedGeneration, audioEngine != nil else {
      return
    }
    queuedFrames = max(0, queuedFrames - frames)
    playedFrames += frames
    if finishing && queuedFrames == 0 {
      complete(reason: "drained", outcome: "drained")
    }
  }

  @discardableResult
  private func complete(reason: String, outcome: String) -> [String: Any] {
    let pendingFinish = finishPromise
    let completion: [String: Any] = [
      "outcome": outcome,
      "playedFrames": playedFrames,
      "writtenFrames": writtenFrames
    ]
    finishPromise = nil
    finishing = false
    generation &+= 1

    audioPlayer?.stop()
    audioEngine?.stop()
    audioEngine?.reset()
    audioPlayer = nil
    audioEngine = nil
    removeInterruptionObserver()
    try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)

    state = "idle"
    queuedFrames = 0
    emitStatus(reason: reason)
    sampleRate = 0
    channels = 0
    writtenFrames = 0
    playedFrames = 0
    pendingFinish?.resolve(completion)
    return completion
  }

  private func observeInterruptions(session: AVAudioSession, generation expectedGeneration: UInt64) {
    removeInterruptionObserver()
    interruptionObserver = NotificationCenter.default.addObserver(
      forName: AVAudioSession.interruptionNotification,
      object: session,
      queue: nil
    ) { [weak self] notification in
      guard let typeValue = notification.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
            let type = AVAudioSession.InterruptionType(rawValue: typeValue),
            type == .began else {
        return
      }
      self?.queue.async { [weak self] in
        guard let self, self.generation == expectedGeneration else {
          return
        }
        self.complete(reason: "interrupted", outcome: "interrupted")
      }
    }
  }

  private func removeInterruptionObserver() {
    if let interruptionObserver {
      NotificationCenter.default.removeObserver(interruptionObserver)
      self.interruptionObserver = nil
    }
  }

  private func emitStatus(reason: String? = nil) {
    emit(statusPayload(reason: reason))
  }

  private func statusPayload(reason: String? = nil) -> [String: Any] {
    var payload: [String: Any] = [
      "channels": channels,
      "playedFrames": playedFrames,
      "queuedDurationMs": sampleRate > 0 ? Double(queuedFrames) / Double(sampleRate) * 1_000 : 0,
      "sampleRate": sampleRate,
      "state": state,
      "writtenFrames": writtenFrames
    ]
    if let reason {
      payload["reason"] = reason
    }
    return payload
  }
}

public class WavePcmPlayerModule: Module {
  private lazy var playback = PcmPlaybackEngine { [weak self] payload in
    self?.sendEvent("onPlaybackStateChanged", payload)
  }

  public func definition() -> ModuleDefinition {
    Name("WavePcmPlayer")

    Events("onPlaybackStateChanged")

    AsyncFunction("startAsync") { (sampleRate: Int, channels: Int, promise: Promise) in
      self.playback.start(sampleRate: sampleRate, channels: channels, promise: promise)
    }

    AsyncFunction("writeAsync") { (data: Data, promise: Promise) in
      self.playback.write(data: data, promise: promise)
    }

    AsyncFunction("finishAsync") { (promise: Promise) in
      self.playback.finish(promise: promise)
    }

    AsyncFunction("stopAsync") { (promise: Promise) in
      self.playback.stop(promise: promise)
    }

    AsyncFunction("getStatusAsync") { (promise: Promise) in
      self.playback.status(promise: promise)
    }

    OnAppEntersBackground {
      self.playback.stop(reason: "backgrounded")
    }

    OnDestroy {
      self.playback.shutdown()
    }
  }
}
