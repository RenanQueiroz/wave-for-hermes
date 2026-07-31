# Wave roadmap

This roadmap records product work that remains after the first authenticated text-chat and
live-voice vertical slice. It is ordered by user impact and production risk, not by implementation
convenience.

## Completed: physical Android background work

The physical Android background-work barge-in gate passed on a Google Pixel 8 Pro on 2026-07-30.
While the first Hermes request occupied the full configured 120-second execution window, Wave
answered a direct spoken follow-up, admitted a second `ask_hermes` request, and kept it waiting
instead of cancelling the active request or reporting an in-flight conflict. Hermes history then
recorded the second request and response after the first slot released, and hangup refreshed that
ordered canonical history immediately in the text UI.

## Now: production voice behavior

1. Repeat the Realtime microphone, playback, tool-call, mute, and teardown proof on physical iOS
   when hardware is available.
2. Validate speaker, receiver, Bluetooth, and wired-headset selection and route changes on physical
   devices.
3. Validate phone/audio interruptions, app backgrounding, device lock, permission denial and
   recovery, and bounded reconnect behavior.
4. Validate release builds and realistic Wi-Fi, cellular, and private-network transitions.

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

- Add a Companion-owned interaction ledger for finalized live-voice user/Wave transcript items and
  Hermes handoff metadata. Store no raw audio, keep Hermes as the canonical source for its own
  durable turns, and correlate records with stable IDs rather than text matching.
- Merge that ledger with canonical Hermes history into one chronological mobile timeline. Render
  each Hermes delegation as a collapsed nested task inside the surrounding Wave turn, with a
  concise outcome visible by default and bounded raw handoff input/output available through
  progressive disclosure.
- Define retention, pagination, cross-device sync, and deletion-cascade behavior for the interaction
  ledger before making Realtime-only speech durable.
- Expand the drawer's operational area only with reviewed read-only resources that Hermes exposes
  through stable contracts. Each surface needs its own normalized Wave schema; do not introduce a
  generic Hermes API browser or operational mutations.
- Add redacted diagnostics suitable for user support without collecting conversation content.
- Complete security, lifecycle-race, production-bundle, and private-deployment validation before
  the first store release.
