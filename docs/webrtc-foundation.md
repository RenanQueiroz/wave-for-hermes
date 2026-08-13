# WebRTC foundation

Status: direct Realtime path validated on simulators and physical Android; remaining production
gates are tracked below

Validated: 2026-08-06

Wave uses `react-native-webrtc` as the native media foundation for the OpenAI Realtime
voice transport. The dependency is installed through `npx expo install`; the validated lockfile
currently resolves `react-native-webrtc` `124.0.8`.

The library is autolinked, configured, built, and exercised with Expo SDK 57 and React Native 0.86.
The production mobile transport, lifecycle controller, and PanelUI voice route establish and
explicitly terminate real Realtime calls on Radon-managed iOS and Android simulators, performing
the SDP exchange and sideband directly against OpenAI with the user-owned key.

## Native configuration

`app.json` is the durable source of truth:

- iOS declares a product-specific `NSMicrophoneUsageDescription`.
- Android declares the network, audio-routing, and microphone permissions required by the native
  WebRTC library.
- Wave's live mode is audio-only and never requests video. Android camera permission is enabled
  separately for the user-invoked chat attachment Camera action.

The generated `ios/` and `android/` directories remain ignored and require no manual edits.
`react-native-webrtc` autolinks its native module. Wave does not install
`@config-plugins/react-native-webrtc` because its published compatibility currently stops before
Expo SDK 57 and its default mutations include video-related permissions Wave does not need. A
repository-owned config plugin is also unnecessary while all required durable configuration is
expressible in `app.json`.

React Native Directory currently labels the package as untested on the New Architecture. Wave
excludes only `react-native-webrtc` from Expo Doctor's directory-metadata check after validating
the New Architecture native builds and live proof on both platforms. All other Expo Doctor
directory checks remain enabled.

## Development proof

Development builds expose a temporary proof card under **Development tools**. It:

1. requests an audio-only microphone stream;
2. creates two local `RTCPeerConnection` instances with no external ICE servers;
3. negotiates a local SDP offer and answer;
4. sends the microphone track to the receiving peer;
5. waits for a remote audio receiver track;
6. verifies a round-trip data-channel echo;
7. closes data channels, peer connections, and media tracks when stopped, unmounted, or
   backgrounded after permission setup.

The controller lives in `src/dev/webrtc-audio-loopback.ts` and the PanelUI harness lives in
`src/dev/webrtc-proof-card.tsx`. They are development diagnostics, not the production
`RealtimeTransport`. Product screens must not manipulate `RTCPeerConnection` directly.

The card also registers the read-only `webrtc-proof` development state provider for the
repository-local mobile agent. Meaningful controls have stable test IDs and accessibility labels.

## Production mobile transport

The production boundary is split across:

- `src/services/realtime/realtime-transport.ts` for normalized, bounded transport events and the
  provider-independent interface;
- `src/services/realtime/react-native-realtime-transport.ts` for microphone acquisition, SDP,
  peer/data-channel state, remote audio tracks, bounded audio-level polling, reconnect bounds,
  timers, and native cleanup;
- `src/features/realtime/realtime-controller.ts` for call ownership, cancellation, expiry,
  bounded reconnection, safe UI state, transcript bounds, and explicit backend call termination;
- `src/services/realtime/openai-realtime-backend.ts` for the direct SDP exchange, the
  authenticated sideband, `ask_hermes` orchestration, and active-only `correct_hermes` steering on
  the user-owned key;
- `src/features/realtime/voice-screen.tsx` for the state renderer and accessible controls: the
  status header, transcripts, notices, and action buttons are the platform-native voice UI
  components shared with gateway voice (`src/features/voice/voice-*.{ios,android}.tsx`), while the
  ambient Soundwave glow stays PanelUI.

React components never own raw WebRTC resources. Leaving the focused route, backgrounding an
established call, ending explicitly, setup failure, connection failure, or call expiry closes local
media and hangs up the provider call. A failed cleanup remains visible and retryable; Wave does
not silently start a second call. A transient peer disconnect gets a grace window for ICE
self-recovery, then up to three full re-offers with the shared jitter policy before the call
fails explicitly.

The transport samples one native stats report at 5 Hz and reduces only standardized local audio
source/outbound-audio and remote inbound-audio entries to current bounded 0–1 levels. A direct
`audioLevel` is preferred; cumulative `totalAudioEnergy` and `totalSamplesDuration` use the
standards-defined interval RMS fallback. Raw reports, track/provider identifiers, samples, and
level history never leave the transport. Missing or failed stats degrade to PanelUI's phase
animation and never affect call health or reconnection.

Microphone denial produces a retryable, content-free permission error and an accessible system
settings action. Android requests `RECORD_AUDIO` explicitly before native media acquisition; iOS
uses the configured microphone purpose string and native prompt. The selected Wave voice is loaded
from secure device storage before setup. A separate strict model preference accepts only
`gpt-realtime-2.1-mini` or `gpt-realtime-2.1`; Wave snapshots model and voice into the initial
Realtime session configuration because OpenAI does not allow `model` to change through
`session.update`. A rejected selected model does not retry or silently fall back and links back to
Settings without exposing the response body.

The live transcript shown during a call is transient controller state and is not persisted
anywhere — Realtime speech is ephemeral, and the call screen says so. Work Wave hands to Hermes
through `ask_hermes` lands as ordinary turns in the bound session. Only while one such turn has a
registered live redirect lane does the sideband advertise `correct_hermes`; it restores ask-only
tools on settlement, and the trusted execution gate remains authoritative if an OpenAI
`session.update` is delayed, rejected, or lost. Successful route exit refreshes the active unified
timeline query before text chat is shown again, so completed voice-triggered Hermes work appears
without closing and reopening the conversation. A final exact whole-utterance stop command closes
locally before the phrase enters transcript state; speech that merely contains a stop word remains
conversation.

### Run the proof

A JavaScript reload is not enough after first installing the native dependency or changing native
permissions. Regenerate and rebuild the development client:

```bash
nvm use
npm install
npx expo prebuild --clean
npx expo run:ios
# or
npx expo run:android
```

Radon IDE can perform the native build and manage Metro instead. After the rebuilt app opens:

1. Sign the development build in to a Hermes gateway.
2. Open **Development tools** from Settings.
3. Select **Start proof**.
4. Allow microphone access when prompted.
5. Confirm the card reaches:
   - phase `passed`;
   - at least one microphone track;
   - at least one remote audio track;
   - data echo `received`;
   - peers `connected / connected`.
6. Select **Stop** and confirm the card returns to `idle`.

The Android permission dialog may temporarily background the activity. The harness allows an
in-flight permission request to finish, but established media is still cleaned up when the app
backgrounds.

## Validation record

The foundation proof passed with:

- a clean Expo prebuild;
- an iOS simulator debug build and CocoaPods integration;
- an Android arm64 debug build;
- an iPhone 17 Pro Radon simulator on iOS 26.5;
- a Radon-managed arm64 emulator on Android 16 / API 36;
- one local microphone track, one remote receiver track, connected peers, a received data echo,
  and explicit cleanup on both platforms;
- generated iOS and Android permission output with microphone access; Android camera permission is
  separately attributable to the user-invoked chat attachment flow, not voice setup.

The direct user-keyed path passed on the iOS simulator and, on 2026-08-02, end to end on a physical
Pixel 8 Pro: a real spoken Realtime conversation with audible bidirectional audio, barge-in,
microphone mute/unmute, explicit teardown, return to chat, and Wave delegating work to Hermes
mid-call through `ask_hermes`.

On 2026-08-06, another physical Pixel 8 Pro call validated measured waveform telemetry end to end:
the local meter rose with speech, the remote meter rose with assistant playback, phases advanced
through user and assistant speech, both returned to zero at rest, and explicit teardown produced no
new warning or error logs. This confirms the built-in speaker/microphone path, not the alternate
route or release gates below.

On 2026-07-31, both Radon-managed platforms additionally passed denial and later recovery of
microphone permission, the system-settings recovery action, a successful subsequent call reaching
`Listening`, established-call background teardown, and another clean idle state ready to reconnect.

On 2026-08-03, the Stage 5a iOS simulator loaded both accessible model choices, persisted a change,
and established then explicitly ended one real WebRTC call with each supported model; both reached
`Listening` with one remote audio track. The mini default was restored afterward. Android loaded
the updated bundle and Settings route without a Realtime key on that emulator, so model-specific
Android and all physical-device acceptance remain release gates.

The Stage 5b bundle then reloaded on both Radon platforms, and iOS established and explicitly ended
another real call using the new ask-only initial session snapshot; it reached `Listening` with one
remote audio track, proving OpenAI accepted the updated initial prompt/tool configuration. No
ordinary conversation or delegated work was generated during that smoke. Spoken correction and
dynamic live update behavior remain covered deterministically until the physical-device gate.

Deterministic tests separately cover strict `ask_hermes` validation, trusted session binding,
coalescing, bounded ordered dispatch, response-safe delivery, dynamic acknowledged tool snapshots,
strict active-execution correction, completion/queued-work races, update failures/timeouts,
teardown, and reconnection. Simulator bundle/runtime checks cover the code path, but natural spoken
correction remains a physical-device acceptance gate. The existing physical and simulator evidence
does not establish alternate audio routes, physical iOS behavior, or release readiness.

## Remaining production voice gates

Before declaring voice production-ready, validate:

- physical iOS microphone capture and assistant playback;
- full-duplex barge-in and assistant-audio interruption on physical iOS;
- speaker, receiver, Bluetooth, and wired-headset routing;
- interruptions, phone calls, route changes, lock/background behavior, and reconnection;
- release builds and realistic network transitions;
- a real call and `ask_hermes` delegation with each supported model on physical iOS and Android;
- spoken `correct_hermes` steering during model generation and a Hermes tool, a distinct
  overlapping request, speech-only barge-in, and exact stop on physical iOS and Android.

The local proof should remain a small development-only native diagnostic even though the
production controller now exists.

## References

- [Expo SDK 57 app configuration](https://docs.expo.dev/versions/v57.0.0/config/app/)
- [Expo `with-webrtc` example](https://github.com/expo/examples/tree/master/with-webrtc)
- [React Native WebRTC](https://github.com/react-native-webrtc/react-native-webrtc)
- [W3C WebRTC Stats](https://www.w3.org/TR/webrtc-stats/)
- [`@config-plugins/react-native-webrtc`](https://github.com/expo/config-plugins/tree/master/packages/react-native-webrtc)
