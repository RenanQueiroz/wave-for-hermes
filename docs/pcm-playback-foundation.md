# Streaming PCM playback foundation

Wave contains a focused native playback foundation for Hermes v0.20's clause-streamed gateway
speech. It is a feasibility proof, not yet the production `/api/audio/speak-stream` client. The
current gateway voice path continues to buffer a finished reply through `/api/audio/speak` until
the physical-device gates below pass.

## Why a local module is necessary

The exact Expo SDK 57 [`expo-audio`](https://docs.expo.dev/versions/v57.0.0/sdk/audio/)
documentation supports URL, local-file, and asset playback sources. Its audio-sample and stream
APIs expose captured or playing samples to JavaScript, but it does not expose an API that queues
caller-supplied raw PCM for output. Browser Web Audio APIs are not available to Wave's native-only
runtime.

The smallest supported solution is therefore a local
[Expo module](https://docs.expo.dev/versions/v57.0.0/modules/overview/) in
`modules/wave-pcm-player`. It autolinks during Prebuild and owns only foreground PCM output:

- signed 16-bit little-endian, interleaved PCM;
- one or two channels at an integer sample rate from 8,000 through 48,000 Hz;
- at most 512 KiB per chunk and 12 seconds of queued audio;
- exactly one playback owner, explicit finish/drain, and deterministic stop;
- an atomic finish acknowledgement with exact written/played frame counts and a deterministic Stop
  outcome;
- teardown on app background, native destruction, or audio interruption;
- no microphone, network, file, persistence, background service, or general audio-engine API.

The JavaScript owner in `src/native/pcm-player.ts` repeats the format and chunk checks before the
native boundary. iOS schedules `AVAudioPCMBuffer` instances through `AVAudioEngine` and
`AVAudioPlayerNode`; Android writes into a streaming `AudioTrack` with transient audio focus. Both
platforms publish only bounded state and frame counts. PCM contents are neither logged nor stored.

## Development proof

Development builds expose **Settings → Development → Streaming PCM playback proof**. The same
screen can be opened directly with `wave://development`; the route and proof remain unavailable in
production builds.

One run:

1. feeds 20 ms mono chunks twice as fast as playback at 24 kHz;
2. schedules contiguous 440 Hz, 660 Hz, and 880 Hz tones and verifies an exact 28,800-frame drain;
3. tears down and restarts at 48 kHz;
4. schedules a two-second 330 Hz tone, cancels it after 150 ms, and verifies native idle state.

The card reports the first native `playing` event latency, exact drained frames, format restart,
and cancellation outcome. The repository-local mobile agent can inspect the bounded
`pcm-playback-proof` development state without accessing arbitrary JavaScript.

## Validation status

Validated on 2026-08-05:

| Gate                                                              | Result                                                                    |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Expo SDK 57 API review                                            | No supported raw-PCM enqueue output API; local module required            |
| Pure format/chunk/tone tests                                      | Passed                                                                    |
| Clean Expo Prebuild                                               | Passed; module autolinked on iOS and Android                              |
| Android debug native build                                        | Passed                                                                    |
| iOS debug native build                                            | Passed                                                                    |
| iOS 26.5 simulator proof                                          | Passed: 12 ms first event, 28,800/28,800 frames, restart and cancellation |
| iOS simulator background teardown                                 | Passed: returned to idle                                                  |
| Android emulator runtime                                          | Pending; no emulator was ADB-visible at the validation point              |
| Physical iOS and Android audio quality, routing, and interruption | Pending user validation                                                   |

Simulator state proves ordering and lifecycle accounting, but cannot prove speaker quality,
click-free boundaries, hardware routing, or real interruption behavior. Before Stage 4b may use
this module in gateway voice, run the proof on physical iOS and Android and verify:

- the three rising tones are clean, contiguous, and free of gaps or boundary clicks;
- the short restart tone begins and stops without lingering audio;
- speaker, receiver, Bluetooth, and wired routes behave deliberately;
- backgrounding, lock, calls, alarms, route changes, and manual Stop release audio immediately;
- repeated runs and a release build leave no retained audio owner or degraded later playback.

If either platform is unreliable, keep buffered gateway speech as the supported path. The module
must not be expanded into the streaming WebSocket client to work around a failed native gate.

## Product-integration boundary

Stage 4b will separately own the authenticated `/api/audio/speak-stream` WebSocket, its JSON
control frames, binary-frame bounds, text-clause feed, timeouts, `done`, `stop`, and fallback to
buffered `/api/audio/speak`. Network data and gateway protocol types remain in
`src/services/gateway`; the PCM player accepts only validated audio bytes and never sees a URL,
token, provider identifier, transcript, or conversation identifier.

Gateway voice remains half-duplex. Wave closes the `expo-audio` recorder before this player can
own output, and Realtime WebRTC remains mutually exclusive with both.
