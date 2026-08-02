# WebRTC foundation

Status: native Realtime path validated on simulators and physical Android; the companion-free
direct path validated on the iOS simulator (2026-08-02); remaining production gates are tracked
below

Validated: 2026-08-02

Wave uses `react-native-webrtc` as the native media foundation for the OpenAI Realtime
voice transport. The dependency is installed through `npx expo install`; the validated lockfile
currently resolves `react-native-webrtc` `124.0.8`.

The library is autolinked, configured, built, and exercised with Expo SDK 57 and React Native 0.86.
The production mobile transport, lifecycle controller, and PanelUI voice route establish and
explicitly terminate real Realtime calls on Radon-managed iOS and Android simulators, and — since
stage 4 of the direct-to-gateway migration — perform the SDP exchange and sideband directly
against OpenAI with the user-owned key (validated live on 2026-08-02).

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

Paired development builds expose a temporary proof card under **Development tools**. It:

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
  peer/data-channel state, remote audio tracks, reconnect bounds, timers, and native cleanup;
- `src/features/realtime/realtime-controller.ts` for call ownership, cancellation, expiry,
  bounded reconnection, safe UI state, transcript bounds, and explicit backend call termination;
- `src/services/realtime/openai-realtime-backend.ts` for the direct SDP exchange, the
  authenticated sideband, and `ask_hermes` orchestration on the user-owned key;
- `src/features/realtime/voice-screen.tsx` for the PanelUI state renderer and accessible controls.

React components never own raw WebRTC resources. Leaving the focused route, backgrounding an
established call, ending explicitly, setup failure, connection failure, or call expiry closes local
media and hangs up the provider call. A failed cleanup remains visible and retryable; Wave does
not silently start a second call. A transient peer disconnect gets a grace window for ICE
self-recovery, then up to three full re-offers with the shared jitter policy before the call
fails explicitly.

Microphone denial produces a retryable, content-free permission error and an accessible system
settings action. Android requests `RECORD_AUDIO` explicitly before native media acquisition; iOS
uses the configured microphone purpose string and native prompt. The selected Wave voice is loaded
from secure device storage before setup and included only in the Realtime session configuration
sent to OpenAI.

The live transcript shown during a call is transient controller state and is not persisted
anywhere — Realtime speech is ephemeral, and the call screen says so. Work Wave hands to Hermes
through `ask_hermes` lands as ordinary turns in the bound session. Successful route exit
refreshes the active unified timeline query before text chat is shown again, so completed
voice-triggered Hermes work appears without closing and reopening the conversation.

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
- generated iOS and Android permission output with microphone access and no Android camera
  permission.

The production simulator path additionally passed on 2026-07-30 (via the since-retired
companion backend):

- native mobile SDP exchange;
- a real OpenAI Realtime WebRTC connection reaching the `Listening` state;
- microphone mute/unmute state changes;
- explicit peer, media, data-channel, timer, and backend-call teardown;
- return to the existing chat on both the Radon-managed iOS and Android devices.

On 2026-08-02, the owner validated the direct user-keyed path end to end on the physical
Pixel 8 Pro: a real spoken Realtime conversation, including Wave delegating work to Hermes
mid-call through `ask_hermes`, with no companion involved.

On 2026-07-31, both Radon-managed platforms additionally passed denial and later recovery of
microphone permission, the system-settings recovery action, a successful subsequent call reaching
`Listening`, established-call background teardown, and another clean idle state ready to reconnect.

The production path also passed on a physical Google Pixel 8 Pro on 2026-07-30 (via the
since-retired companion backend; the `ask_hermes` rules it validated are now enforced
client-side by the same contract):

- microphone capture reached the Realtime session and produced a user turn;
- the assistant response was clearly audible through the device;
- the connection exposed one remote audio track;
- a strict `ask_hermes` call completed and persisted the expected Hermes user/assistant turn;
- speaking while the assistant voiced that Hermes result interrupted the response, preserved the
  Realtime conversation, and produced a correct direct follow-up answer;
- in a separate overlapping-work call, the first Hermes request remained active through the full
  configured 120-second execution window while Wave answered a direct spoken math question;
- a second `ask_hermes` request made during that window was accepted, waited for the first queue
  slot to release, and then appeared with its response after the first request in canonical Hermes
  history instead of failing with an in-flight conflict;
- hangup immediately refreshed canonical Hermes history, including the real bounded Terminal input
  and output behind a collapsed expandable task row;
- microphone mute/unmute changed the live media state; and
- explicit hangup returned to chat and removed the development state provider after cleanup.

Together, these physical Android proofs establish audible bidirectional audio, conversational
barge-in, preservation of active Hermes work through that barge-in, bounded ordered follow-up
`ask_hermes` dispatch, and immediate post-call history refresh. They do not establish alternate
audio routes, physical iOS behavior, or release readiness.

## Remaining production voice gates

Before declaring voice production-ready, validate:

- physical iOS microphone capture and assistant playback;
- full-duplex barge-in and assistant-audio interruption on physical iOS;
- speaker, receiver, Bluetooth, and wired-headset routing;
- interruptions, phone calls, route changes, lock/background behavior, and reconnection;
- release builds and realistic network transitions.

The local proof should remain a small development-only native diagnostic even though the
production controller now exists.

## References

- [Expo SDK 57 app configuration](https://docs.expo.dev/versions/v57.0.0/config/app/)
- [Expo `with-webrtc` example](https://github.com/expo/examples/tree/master/with-webrtc)
- [React Native WebRTC](https://github.com/react-native-webrtc/react-native-webrtc)
- [`@config-plugins/react-native-webrtc`](https://github.com/expo/config-plugins/tree/master/packages/react-native-webrtc)
