# WebRTC foundation

Status: native foundation adopted and validated; production voice validation remains incomplete

Validated: 2026-07-29

Wave uses `react-native-webrtc` as the native media foundation for the OpenAI Realtime
voice transport. The dependency is installed through `npx expo install`; the validated lockfile
currently resolves `react-native-webrtc` `124.0.8`.

This decision establishes that the library can be autolinked, configured, built, and exercised
with Expo SDK 57 and React Native 0.86. The Companion now implements unified Realtime SDP setup and
sideband `ask_hermes` dispatch, but the mobile production transport/controller and complete voice
experience have not been implemented.

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

The simulator proof demonstrates native-module loading, microphone acquisition, peer negotiation,
remote track delivery, data channels, and cleanup. It does **not** prove audible full-duplex audio
or production Realtime behavior.

## Remaining production voice gates

Before declaring voice production-ready, validate:

- the implemented Companion unified-call route against a real OpenAI Realtime project, including a
  native SDP exchange and explicit call cleanup;
- audible full-duplex capture and playback on physical iOS and Android devices;
- speaker, receiver, Bluetooth, and wired-headset routing;
- interruptions, phone calls, route changes, lock/background behavior, and reconnection;
- barge-in and assistant-audio interruption;
- permission denial and later recovery;
- release builds and realistic network transitions.

These checks belong to the mobile Realtime phase. The local proof should stay small and
development-only until the production controller supersedes it.

## References

- [Expo SDK 57 app configuration](https://docs.expo.dev/versions/v57.0.0/config/app/)
- [Expo `with-webrtc` example](https://github.com/expo/examples/tree/master/with-webrtc)
- [React Native WebRTC](https://github.com/react-native-webrtc/react-native-webrtc)
- [`@config-plugins/react-native-webrtc`](https://github.com/expo/config-plugins/tree/master/packages/react-native-webrtc)
