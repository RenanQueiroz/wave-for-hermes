# Wave roadmap

Wave already supports authenticated gateway chat, account-wide conversation history, bounded
attachments, inline approval and clarify prompts, mid-turn correction, sealed interim narration,
bounded live progress, offline reading, half-duplex gateway speech, and opt-in OpenAI Realtime
voice with typed `ask_hermes` delegation and active-only `correct_hermes` steering. Current
behavior and completed work belong in the README and the focused architecture, connectivity,
security, and WebRTC documents; this roadmap tracks only work that remains.

## Now: improve voice latency

[Hermes Agent v0.20.1](https://github.com/NousResearch/hermes-agent/releases/tag/v2026.8.13) also adds
clause-streamed speech and conversation capabilities Wave can adopt without becoming a Hermes
administration console.

### Validate streamed gateway speech on device

Clause-streamed gateway speech is implemented: gateway voice mode feeds assistant narration to
`/api/audio/speak-stream` while the turn runs and plays clause-level PCM through the validated
native foundation, with buffered `/api/audio/speak` as the explicit fallback for older gateways,
unsupported providers, socket failure, or a server `fallback` control frame (see
[`hermes-connectivity.md`](./hermes-connectivity.md) and
[`pcm-playback-foundation.md`](./pcm-playback-foundation.md)). Automated coverage proves the
protocol, the six-second admission high-water under the player's hard bound, burst and runaway
bounds, the never-retry rule, and the never-replay fallback authority.

Still remaining for this flow:

- exercise live streamed speech on physical iOS and Android against the Homelab gateway: first
  clause latency, ordering, Skip, voice Stop, mid-turn tool pauses, and the buffered fallback on
  a gateway without a chunked provider;
- add subtle thinking-latency feedback only if user testing shows the remaining gap needs it —
  optional, local, stopped instantly by speech or recording.

The integration stays half-duplex: Wave closes the recorder before playback and keeps an explicit
interrupt control. Full-duplex gateway voice requires a separate native proof covering
simultaneous capture/playback, echo cancellation, pre-roll capture, phase-aware VAD, speaker and
Bluetooth routing, interruption, and cleanup. If that proof is not reliable, Realtime remains
Wave's full-duplex mode.

## Later: deliberate native and notification options

### Phone wake word

Hermes's gateway wake-word RPC listens to the microphone attached to the gateway process, not the
phone. A Wave wake word therefore requires a separate on-device native implementation. Evaluate it
foreground-only first with an explicit enabled state, visible microphone ownership, no-network
detection, no retained ambient audio, measured battery cost, and deterministic exclusion with
dictation, gateway voice, and Realtime. Background or lock-screen listening requires a separate
privacy, battery, OS-policy, and store-review decision.

### Completion notifications

Hermes outbound webhooks are useful for Homelab, CI, and automation, but a mobile app cannot receive
an HTTP webhook directly. Push notifications require a trusted APNs/FCM relay or upstream
gateway-native push support. Wave will not expose webhook configuration or recreate a server-side
Wave Companion solely for notifications.

### Measured storage and timeline options

- Move the persisted query cache to `expo-sqlite/kv-store` only if write jank, multi-megabyte cache
  growth, offline content search, or recurring corruption is measured.
- Recycle chat timeline rows by keying Task disclosure state per message only if very long
  conversations show fling gaps despite the current virtualization and draw-distance controls.

## Release gates

The following remain required before calling Realtime voice production-ready or shipping the first
store release:

- physical-iOS microphone, playback, barge-in, and teardown;
- speaker, receiver, Bluetooth, and wired-headset route selection and changes;
- calls and other audio interruptions, lock/background behavior, and reconnection;
- realistic Wi-Fi, cellular, and private-network transitions;
- signed release-build smoke tests on physical iOS and Android;
- the release-security and dependency checks in [`security.md`](./security.md) and
  [`dependency-security.md`](./dependency-security.md).

The detailed native evidence and acceptance criteria remain in
[`webrtc-foundation.md`](./webrtc-foundation.md).

## Explicitly out of scope

Wave does not adopt Desktop's artifact viewer, plugin SDK, shell panes, quick-entry window, Hermes
provider/model/skill administration, webhook settings, A2A peer management, or generic gateway RPC
surface. These features belong to a desktop workbench or server operator, not to Wave's focused
conversation and voice product.
