# Wave roadmap

This roadmap records product work that remains after the first authenticated text-chat and
live-voice vertical slice. It is ordered by user impact and production risk, not by implementation
convenience.

## Now: production voice behavior

1. Validate barge-in on physical Android: speaking while the assistant is responding must stop
   assistant audio promptly, preserve a coherent conversation, and allow the user to continue.
2. Repeat the Realtime microphone, playback, tool-call, mute, and teardown proof on physical iOS
   when hardware is available.
3. Validate speaker, receiver, Bluetooth, and wired-headset selection and route changes on physical
   devices.
4. Validate phone/audio interruptions, app backgrounding, device lock, permission denial and
   recovery, and bounded reconnect behavior.
5. Validate release builds and realistic Wi-Fi, cellular, and private-network transitions.

The detailed evidence and acceptance gates live in
[`webrtc-foundation.md`](./webrtc-foundation.md).

## Next: voice personalization

Add a mobile voice picker so the user can choose the Realtime assistant voice before starting a
call.

The implementation must:

- expose a Wave-owned allowlist of supported voices rather than accepting arbitrary provider
  values from mobile;
- validate the selected voice in the Companion and apply it when creating the Realtime session;
- keep the server-selected `OPENAI_REALTIME_VOICE` value as the safe default;
- present accessible previews or descriptions without adding model/provider administration to the
  product; and
- apply a changed selection to the next call, because OpenAI does not allow changing the voice
  after a session has already produced audio.

## Later: conversation continuity and release hardening

- Deliberately decide whether ended voice transcripts disappear or produce a bounded Hermes
  summary; Hermes remains the durable source of truth.
- Add redacted diagnostics suitable for user support without collecting conversation content.
- Complete security, lifecycle-race, production-bundle, and private-deployment validation before
  the first store release.
