# Wave roadmap

This roadmap records product work that remains after the authenticated text-chat and live-voice
vertical slices, ordered by user impact and production risk. Feature-level detail for completed
work lives in the README, [`architecture.md`](./architecture.md), and [`security.md`](./security.md).

## Now: production voice behavior

1. Repeat the Realtime microphone, playback, tool-call, mute, and teardown proof on physical iOS
   when hardware is available.
2. Validate speaker, receiver, Bluetooth, and wired-headset selection and route changes on
   physical devices.
3. Validate phone/audio interruptions, device lock, route changes, and reconnect behavior on
   physical devices. Simulator validation covers permission denial and recovery, direct access to
   system settings, established-call background teardown, and a clean subsequent call on both
   platforms.
4. Implement bounded Realtime reconnection. The controller reports a `reconnecting` phase on ICE
   disconnection but never restarts ICE or re-offers; attempts should be bounded with the shared
   exponential-jitter policy before the call fails explicitly.
5. Validate release builds and realistic Wi-Fi, cellular, and private-network transitions.

The detailed evidence and acceptance gates live in
[`webrtc-foundation.md`](./webrtc-foundation.md).

## Now: connectivity resilience follow-through

- Validated on the iOS simulator against the extended mobile fixture (2026-08-01): timeline
  pagination under scroll across a seeded 130-entry conversation (older page loaded via
  `onStartReached`, no gaps or jumps), and turn survival across a hard app kill mid-stream — the
  slow fixture turn ran to completion detached twice and its full response was recovered on
  return. Cached chats also stayed readable with the companion process down.
- Offline cold start now degrades to cached reading instead of gating on a reachable companion,
  validated end to end on the iOS simulator (2026-08-01): a cold start against a dead companion
  (connection refused) and against a hung companion (timeout) both landed on the offline screen
  with the drawer's cached chats, offline notices, and a fully readable cached conversation;
  re-verification against a companion that no longer recognized the device hard-gated back to the
  connect screen; and after the hung companion resumed, the app promoted itself to connected
  without user action and started a fresh conversation.
- Remaining: repeat on physical devices over real radio (background/lock mid-turn, airplane-mode
  transitions), observe the live mid-stream reattach UI (the fixture's 30-second stream ended
  before slow automation could reopen the screen), and verify purge-on-disconnect.

## Next: release hardening and focused operations

- Add reviewed iOS App Transport Security and Android cleartext-network exceptions before a
  store-style release build ships the Tailscale plain-HTTP carve-out; development clients already
  permit it.
- Bound the Companion interaction ledger. Deletion cascades with the parent session, but a
  long-lived session's finalized voice transcripts and handoff records currently grow without an
  age or size limit; define retention before that storage becomes operationally meaningful.
- Expand the drawer's operational area only with reviewed read-only resources that Hermes exposes
  through stable contracts. Each surface needs its own normalized Wave schema; do not introduce a
  generic Hermes API browser or operational mutations.
- Use [`security.md`](./security.md) as the release-security checklist. Physical-device and
  signed-release gates remain before the first store release.

## Later: deliberate options

- Publish the Companion container image to a registry so future users can deploy without cloning
  the repository; the in-app setup prompt covers the source-build path today.
- Move the persisted query cache to `expo-sqlite/kv-store` with TanStack's per-query persister
  only if persist-write jank is measured, the cache file grows past a few megabytes in real use,
  or offline search over conversation content becomes a product goal. The storage seam in
  `src/services/query/wave-query-cache.ts` keeps that swap contained.
- Recycle chat-timeline rows by keying Task disclosure state per message if very long
  conversations show fling gaps despite the draw-distance buffer.

## Completed milestones

- Physical Android background-work barge-in gate on a Pixel 8 Pro (2026-07-30).
- Voice personalization through the strict Gateway-owned voice catalog.
- Deterministic continuity validation of the interaction ledger and unified timeline, including
  cross-device visibility and multi-page cursor pagination.
- Device self-revocation with an explicit local-only forget fallback.
- Correlation-safe request observability and the bounded finite-read retry policy.
- Release-security checklist runs: schema, resource-bound, lifecycle-race, production-bundle,
  exact-edge, private-deployment, and dependency/container reviews.
- Hermex-inspired connectivity work (2026-08-01): the in-app companion setup prompt,
  Tailscale-first URL policy, resumable turn streams, and the offline read cache.
