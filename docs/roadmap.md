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
3. Validate phone/audio interruptions, device lock, route changes, and bounded reconnect behavior
   on physical devices. Simulator validation now covers permission denial and recovery, direct
   access to system settings, established-call background teardown, and a clean subsequent call on
   both iOS and Android.
4. Validate release builds and realistic Wi-Fi, cellular, and private-network transitions.

The detailed evidence and acceptance gates live in
[`webrtc-foundation.md`](./webrtc-foundation.md).

## Completed: voice personalization

Wave now exposes a strict Gateway-owned voice catalog, stores the selected voice in device secure
storage, and applies it only when creating the next Realtime call. Settings presents the Gateway
default plus the supported OpenAI Realtime voices with accessible descriptions. The Companion
validates the selection against the shared allowlist and retains `OPENAI_REALTIME_VOICE` as its
default.

This preserves the required boundaries:

- mobile cannot submit an arbitrary provider voice;
- the standard OpenAI key and provider session remain server-side;
- selecting a voice is user-facing personalization, not model/provider administration; and
- an active call is never mutated after audio has started.

## Completed: deterministic continuity validation

The Companion interaction ledger and unified timeline now persist finalized live-voice speech,
merge it with canonical Hermes history, nest correlated handoffs, paginate with stable cursors, and
cascade records when a session is deleted. Deterministic coverage includes:

- account-wide cross-device history visibility and post-call refresh;
- idempotent persisted Realtime events and duplicate tool-call coalescing;
- multiple ordered queued handoffs without cancelling active Hermes work;
- explicit handling when Hermes history is cleared externally; and
- a 226-entry mixed timeline paginated across seven cursor pages without gaps or duplicates.

## Completed: device self-revocation

Disconnect now revokes the calling device at the Gateway before Wave clears its secure local
credential. The Companion cancels that device's active text turn and Realtime call, closes a
Realtime setup that finishes after concurrent revocation, and leaves every other paired device
active. If the Gateway cannot be reached, Wave exposes a clearly labeled local-only forget action
instead of implying that server access was revoked.

## Next: release hardening and focused operations

- Expand the drawer's operational area only with reviewed read-only resources that Hermes exposes
  through stable contracts. Each surface needs its own normalized Wave schema; do not introduce a
  generic Hermes API browser or operational mutations.
- Use the authenticated Settings diagnostics report for user support. It includes only app/platform
  details, Companion version/uptime and feature availability, and normalized Hermes compatibility;
  it excludes credentials, server addresses, device identifiers, and conversation content.
- Use [`security.md`](./security.md) as the release-security checklist. Deterministic
  self-revocation, lifecycle-race, schema, resource-bound, production-bundle, exact-edge, and
  private-deployment validation now pass. The exact-edge work also aligned Nginx with Wave's
  6,000,000-byte request ceiling so supported image attachments are no longer truncated by a
  stricter production-only limit. The dependency/container review also passes with Expo-compatible
  remediation decisions and a package-manager-free Alpine Companion runtime. Physical-device and
  signed-release gates remain before the first store release.
