# Streaming PCM playback foundation

Wave contains a focused playback foundation for Hermes v0.20's clause-streamed gateway speech.
The production `/api/audio/speak-stream` client
(`src/services/gateway/gateway-speech-stream.ts`) now feeds this foundation during gateway voice
mode, with buffered `/api/audio/speak` as the explicit fallback; the development proof below
remains the isolated native harness.

## Playback boundary

The exact Expo SDK 57 [`expo-audio`](https://docs.expo.dev/versions/v57.0.0/sdk/audio/)
documentation supports URL, local-file, and asset playback sources. Its sample APIs expose audio
that is already being captured or played, but do not accept caller-supplied raw PCM for output.
Browser Web Audio is also unavailable to Wave's native-only runtime.

Wave therefore adapts Software Mansion's maintained
[`AudioBufferQueueSourceNode`](https://docs.swmansion.com/react-native-audio-api/docs/sources/audio-buffer-queue-source-node/)
behind the singleton `src/native/pcm-player.ts` owner. The package queue is specifically intended
for players made from many short buffers; Android renders through its native Oboe path rather than
a JavaScript-paced `AudioTrack` writer. Wave does not expose the package's general audio engine.

The Wave-owned surface accepts only:

- signed 16-bit little-endian, interleaved PCM;
- one or two channels at an integer sample rate from 8,000 through 48,000 Hz;
- at most 512 KiB per chunk and 12 seconds of queued audio;
- exactly one playback owner, explicit finish/drain, and deterministic Stop;
- bounded written, queued, played, and feed-underrun accounting;
- a bounded 0–1 RMS level for the native buffer at the playback head;
- teardown on app background or audio interruption;
- no microphone, URL, file, network, persistence, transcript, or provider data.

Each synchronous `write` validates and copies the network-sized chunk into a bounded pending queue.
Wave coalesces 20 ms transport chunks into 600 ms native batches, converts Int16 samples into planar
`Float32Array` channels, resamples continuously to the device output rate, creates a native
[`AudioBuffer`](https://docs.swmansion.com/react-native-audio-api/docs/sources/audio-buffer/), and
enqueues it through JSI. Coalescing keeps the JS/JSI handoff comfortably ahead of Android playback;
the earlier 100–200 ms native batches could spend enough time converting and crossing JSI in a
development build to starve an otherwise fully supplied queue. A `write` acknowledges bounded Wave
queue admission, not that the speaker has rendered the samples. Native buffer-ended events advance
exact source-frame accounting.

Playback begins after 600 ms is queued, or immediately when `finish` seals a shorter utterance.
Once started, the native queue renders independently of JavaScript timing and emits silence if the
producer actually lets it empty. Wave counts that transition as a feed underrun, then accepts later
buffers without restarting the audio context. This counter measures Wave queue starvation; it is
not a device-driver xrun metric.

The adapter calculates one RMS envelope per native buffer after resampling. It publishes the first
buffer's level only when playback starts and advances the meter on native buffer-ended events, so a
waveform follows audible queue position rather than a faster network producer. The level is
ephemeral, contains no audio samples, and returns to zero on teardown.

The adapter selects an iOS playback/spoken-audio session, allows AirPlay, requests transient
Android audio focus, and observes system interruptions. Drain keeps its device-rate `AudioContext`
for up to five idle seconds so a following clause or format change does not reactivate the Pixel
audio path. A new source can use a different input sample rate because Wave's stateful resampler
targets that unchanged device context.

Normal Stop anchors a 15 ms gain ramp at the current audio time, holds silence for another mixer
period, and publishes `stopped`. On Android the silenced queue node and the context's one transient
focus request remain retained until the same five-second idle close; Wave does not abandon and
re-request focus for an immediate format restart. That lifecycle avoids mutating an active Pixel
output graph at the cancellation boundary. Failure, interruption, or confirmed background still
closes immediately. Context close cleans any retired nodes, then relinquishes focus/session
ownership. A transient iOS `inactive` state alone does not destroy active playback; a confirmed
background transition does, while calls and alarms use the native interruption path. Gateway voice
remains half-duplex: its `expo-audio` recorder must close before this player can own output.

## Native configuration

`app.json` is deliberately stricter than the package defaults. The config plugin is committed
with:

- iOS background audio disabled;
- Android foreground service support disabled;
- no package-added Android permissions or foreground-service types;
- FFmpeg disabled;
- bundled Opus/Vorbis codec libraries disabled.

Raw buffers need none of those codec or background features. The package's Android Oboe output and
iOS native render path remain enabled. Any future package upgrade must preserve these restrictions
and rerun clean Prebuild plus both native builds.

Wave pins `react-native-audio-api` to the device-validated 0.13.2 release and uses its stock Android
exclusive/low-latency output settings. After the final batching, ramping, silence hold, and bounded
context/focus lifecycle were in place, a controlled A/B rebuilt that exact player without Wave's
former shared/non-low-latency source patch. All six Pixel 8 Pro runs were clean while native traces
confirmed an MMAP low-latency stream with 96-frame bursts, balanced start/stop/close calls, and one
balanced transient-focus lifecycle per proof. The source patch and `patch-package` were therefore
removed. Keep the dependency exact until an upgrade reassesses the upstream implementation and
repeats clean native builds plus the physical Android proof.

## Why the focused local module was retired

Wave first proved the contract with a repository-owned Swift/Kotlin Expo module. Its iOS
`AVAudioEngine` path sounded clean, while Android used a primed streaming `AudioTrack`. Android
could drain every accepted frame and report zero application underruns while still producing
intermittent crackling near the end of playback on the Pixel 8 Pro. Increasing its buffering made
some runs worse, so the exact accounting did not establish audio quality.

The local module was removed rather than retaining two native playback implementations. The
app-owned contract and proof remain stable while `react-native-audio-api` supplies the native render
engine. Version 0.13.2 declares React and React Native peer compatibility broadly; its published
compatibility table has not yet added React Native 0.86, so Wave treats clean SDK 57 builds and
device proofs—not that table—as the compatibility gate.

Wave also reviewed Speechmatics's
[`expo-two-way-audio`](https://github.com/speechmatics/expo-two-way-audio). Its public surface is
fixed to 16 kHz mono and combines microphone/audio-session ownership with playback, which does not
fit this bounded half-duplex output boundary. It remains useful reference material for a future
full-duplex/AEC proof, but is not a Wave dependency.

## Development proof

Development builds expose **Settings → Development → Streaming PCM playback proof**. The same
screen can be opened directly with `wave-dev://development`; the route and proof remain unavailable in
production builds.

One run:

1. feeds 20 ms mono chunks twice as fast as playback at 24 kHz;
2. queues smoothly windowed 440 Hz, 660 Hz, and 880 Hz tones separated by short silence and verifies
   an exact 40,080-frame drain;
3. reuses the device audio context with a new 48 kHz input format;
4. queues 800 ms of 330 Hz audio in 20 ms chunks, waits until playback starts, cancels it after
   another 150 ms, and verifies idle state.

The card reports the first `playing` event latency, exact drained frames, feed underruns, format
restart, and cancellation outcome. A completed proof can run again without an intermediate Stop.
The repository-local mobile agent can inspect only this bounded proof state; it cannot access audio
or arbitrary JavaScript.

## Validation status

Replacement validation reconciled on 2026-08-06:

| Gate                                      | Result                                                                   |
| ----------------------------------------- | ------------------------------------------------------------------------ |
| Expo SDK 57 API review                    | `expo-audio` has no caller-supplied raw-PCM output API                   |
| Package source/config review              | Queue fits short buffers; unused background/codec features disabled      |
| Pure format/chunk/conversion/tone tests   | Passed                                                                   |
| Clean Expo Prebuild                       | Passed with the restricted `react-native-audio-api` plugin configuration |
| Android debug native build                | Passed                                                                   |
| iOS debug native build                    | Passed                                                                   |
| iOS simulator proof                       | Exact proof passed; all four sounds were clean                           |
| Pixel 8 Pro built-in-speaker proof        | Passed: stock RNAA, six clean runs; 40,080 frames, zero underruns        |
| Android emulator runtime                  | Pending; Radon's emulator is not ADB-visible outside its private runtime |
| Physical iOS and remaining hardware gates | Closed by the owner's 2026-08-07 physical voice-mode acceptance          |

The retained Pixel series used RNAA's stock exclusive/low-latency request and a cold application
process. All six consecutive runs played three ordered rising tones plus the short cancellation
tone with no startup pop, crackle, gap, or cancellation pop. Every run reported 40,080/40,080
drained source frames, zero feed underruns, a passed 48 kHz format restart, and a stopped
cancellation. Native traces showed an MMAP low-latency stream with 96-frame bursts and balanced
transient-focus ownership; stream close and focus release occurred only after the five-second idle
window.

Remaining device confidence — alternate speaker/receiver/Bluetooth/wired routes, OS
interruptions, lock behavior, and signed release builds — is tracked with the store-release gates
in [`roadmap.md`](./roadmap.md). If a platform proves unreliable there, return gateway voice to
buffered speech rather than expanding the player to work around a failed native gate.

## Product-integration boundary

Stage 4b landed the authenticated `/api/audio/speak-stream` client in
`src/services/gateway/gateway-speech-stream.ts`. One session per reply owns the JSON control
frames (`text`, `done`, `stop` out; `start`, `end`, `fallback` in), binary-frame bounds and
odd-byte alignment carry, connect/finish/drain timeouts, and the fallback decision. Network data
and gateway protocol types stay in `src/services/gateway`; the PCM player is injected as a
narrow playback interface and receives only validated audio bytes — never a URL, token, provider
identifier, transcript, or conversation identifier.

The session's transport-owned ledger admits at most six seconds of admitted-but-unplayed audio
(under the player's hard 12-second capacity), using the player's own played-frame reports to
resume admission as playback drains; automated tests cover instantaneous and sustained
faster-than-real-time bursts. A producer that outruns playback beyond a 60-second pending bound,
or a session beyond 15 minutes of audio, fails deterministically. The session never retries or
replays an ambiguously failed socket. Full buffered fallback runs only when no streamed audio
ever became audible; after first sound the reply stays text-only, because no spoken clause
boundary can be proven from the wire protocol.

Gateway voice remains half-duplex. Wave closes the `expo-audio` recorder before this player can
own output, and Realtime WebRTC remains mutually exclusive with both.
