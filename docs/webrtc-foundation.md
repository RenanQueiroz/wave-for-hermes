# WebRTC foundation

Status: native Realtime path validated on simulators and physical Android; remaining production gates are tracked below

Validated: 2026-07-30

Wave uses `react-native-webrtc` as the native media foundation for the OpenAI Realtime
voice transport. The dependency is installed through `npx expo install`; the validated lockfile
currently resolves `react-native-webrtc` `124.0.8`.

The library is autolinked, configured, built, and exercised with Expo SDK 57 and React Native 0.86.
The Companion's unified Realtime SDP setup and authenticated sideband `ask_hermes` dispatch pass a
live OpenAI/Hermes browser-WebRTC integration probe. The production mobile transport, lifecycle
controller, and PanelUI voice route also establish and explicitly terminate real Realtime calls on
Radon-managed iOS and Android simulators.

## Native configuration

`app.json` is the durable source of truth:

- iOS declares a product-specific `NSMicrophoneUsageDescription`.
- Android declares the network, audio-routing, and microphone permissions required by the native
  WebRTC library.
- Android explicitly blocks `android.permission.CAMERA`; Wave's live mode is audio-only.

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
- `src/features/realtime/realtime-controller.ts` for Wave call ownership, cancellation, expiry,
  safe UI state, transcript bounds, and explicit Companion call termination;
- `src/features/realtime/voice-screen.tsx` for the PanelUI state renderer and accessible controls.

React components never own raw WebRTC resources. Leaving the focused route, backgrounding an
established call, ending explicitly, setup failure, connection failure, or call expiry closes local
media and attempts authenticated Companion cleanup. A failed server-side cleanup remains visible
and retryable; Wave does not silently start a second call. A transient peer disconnect may recover
inside a bounded window, while a closed event channel is terminal.

The initial voice transcript is an ephemeral in-call overlay. Hermes remains the durable chat
history source.

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

1. Pair the development build with a Wave Companion.
2. Open **Development tools** from the connected screen.
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

The production simulator path additionally passed on 2026-07-30:

- native mobile SDP exchange through the private Homelab Companion;
- a real OpenAI Realtime WebRTC connection reaching the `Listening` state;
- microphone mute/unmute state changes;
- explicit peer, media, data-channel, timer, and Companion-call teardown;
- return to the existing chat on both the Radon-managed iOS and Android devices.

The production path also passed on a physical Google Pixel 8 Pro on 2026-07-30:

- microphone capture reached the Realtime session and produced a user turn;
- the assistant response was clearly audible through the device;
- the connection exposed one remote audio track;
- a strict `ask_hermes` call completed and persisted the expected Hermes user/assistant turn;
- microphone mute/unmute changed the live media state; and
- explicit hangup returned to chat and removed the development state provider after cleanup.

This physical Android proof demonstrates audible bidirectional audio for a normal turn. It does
**not** establish simultaneous full-duplex behavior, barge-in, alternate audio routes, physical
iOS behavior, or release readiness.

## Remaining production voice gates

Before declaring voice production-ready, validate:

- physical iOS microphone capture and assistant playback;
- full-duplex barge-in and assistant-audio interruption on physical Android and iOS;
- speaker, receiver, Bluetooth, and wired-headset routing;
- interruptions, phone calls, route changes, lock/background behavior, and reconnection;
- permission denial and later recovery;
- release builds and realistic network transitions.

The local proof should remain a small development-only native diagnostic even though the
production controller now exists.

## References

- [Expo SDK 57 app configuration](https://docs.expo.dev/versions/v57.0.0/config/app/)
- [Expo `with-webrtc` example](https://github.com/expo/examples/tree/master/with-webrtc)
- [React Native WebRTC](https://github.com/react-native-webrtc/react-native-webrtc)
- [`@config-plugins/react-native-webrtc`](https://github.com/expo/config-plugins/tree/master/packages/react-native-webrtc)
