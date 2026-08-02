# Wave roadmap

This roadmap records product work that remains after the authenticated text-chat and live-voice
vertical slices, ordered by user impact and production risk. Feature-level detail for completed
work lives in the README, [`architecture.md`](./architecture.md), and [`security.md`](./security.md).

## Now: direct-to-gateway migration (decided 2026-08-01)

Wave will retire the companion and connect directly to the Hermes gateway so a new user only
downloads the app and signs in to their existing Hermes deployment. The findings and accepted
trade-offs are recorded in [`architecture.md`](./architecture.md); the staged plan:

1. **Spike the gateway transport and auth.** Speak `tui_gateway` JSON-RPC over
   `/api/ws` from React Native against a real gateway; sign in through the bundled password
   provider or native PKCE. Resolve the open questions: a mobile redirect URI for the native
   flow (custom scheme needs upstream support; the embedded-webview cookie flow is the
   fallback), `session.resume` grace semantics, and RPC parity for session rename, delete,
   search, and attachments. File upstream issues where gaps are confirmed.
2. **Migrate text chat and session lifecycle.** Replace the companion transport in
   `WaveBackendClient` with the gateway client behind the same normalized contracts; replace
   pairing with gateway sign-in; rely on resume-plus-history-refetch for turn continuity.
3. **Adopt gateway voice.** Hermes native voice mode (record → `/api/audio/transcribe` →
   normal turn → `/api/audio/speak-stream`) becomes the default voice mode, plus standalone
   dictation into the composer (STT) and per-message playback (TTS). Degrade clearly when the
   server has no STT/TTS provider configured.
4. **Realtime as opt-in with a user-owned key.** The user may supply their own OpenAI API key in
   settings (platform secure storage, never logged, excluded from backups; recommend a dedicated
   project-scoped key). Voice mode uses Realtime only when a key is present and the user has not
   disabled it; otherwise gateway voice. This amends the product contract's server-side-key rule
   for the user-owned-key case — the decision record is in `architecture.md`.
5. **Retire the companion.** Remove the workspace, contracts that exist only for it, the pairing
   flow, and the deployment documentation once the app runs fully against the gateway.

Contract and dependency-policy amendments in `AGENTS.md` land stage by stage with the code, not
in advance, so the guide always describes the repository as it is.

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
  without user action and started a fresh conversation. Repeated on a physical Pixel 8 Pro
  (Android 17, 2026-08-01): cold starts against the real tailnet companion with Tailscale down
  and against a dead LAN fixture both degraded to the offline screen with the cached 130-entry
  conversation fully readable, and a connected Disconnect against the unreachable Gateway failed
  closed to the saved-connection screen instead of pretending to revoke.
- Direct-LAN connectivity validated on the physical Pixel over Wi-Fi (2026-08-01): pairing, the
  compatibility check, and a streamed chat turn all ran through an explicitly typed
  `http://<mac>.local:8798` mDNS URL resolved by Android itself.
- Remaining: repeat on physical devices over real radio (background/lock mid-turn, airplane-mode
  transitions), observe the live mid-stream reattach UI (the fixture's 30-second stream ended
  before slow automation could reopen the screen), verify purge-on-disconnect, and repeat the
  LAN validation on physical iOS — including the local-network permission prompt from a client
  built after the `app.json` usage-description addition.
- Offline-cache durability anomaly resolved (2026-08-01): the persister rewrote its JSON
  document in place on a one-second throttle, so a reload or process death mid-write left a
  truncated file, and restore silently treated the corrupt document as "no cache" before the
  next persist overwrote it with an empty one — one interruption lost everything. Writes now go
  through a sibling temp file renamed into place and a corrupt document is deleted on restore;
  validated with repeated kill cycles across the persist window on the iOS simulator. If cache
  loss recurs after this fix, treat it as evidence for the `expo-sqlite/kv-store` move below.

## Next: release hardening and focused operations

- Review release-build cleartext policy before a store-style build ships the Tailscale and
  private-LAN plain-HTTP carve-outs; development clients already permit them. iOS App Transport
  Security exempts IP literals and `.local` hosts, so the review may conclude no Info.plist
  exception is needed; Android release builds still need an explicit cleartext-network policy for
  the allowed private ranges.
- Bound the Companion interaction ledger only if the direct-to-gateway migration stalls: the
  ledger retires with the companion. Deletion cascades with the parent session today, but a
  long-lived session's finalized voice transcripts and handoff records grow without an age or
  size limit.
- Expand the drawer's operational area only with reviewed read-only resources that Hermes exposes
  through stable contracts. Each surface needs its own normalized Wave schema; do not introduce a
  generic Hermes API browser or operational mutations.
- Use [`security.md`](./security.md) as the release-security checklist. Physical-device and
  signed-release gates remain before the first store release.

## Later: deliberate options

- Move the persisted query cache to `expo-sqlite/kv-store` with TanStack's per-query persister
  only if persist-write jank is measured, the cache file grows past a few megabytes in real use,
  offline search over conversation content becomes a product goal, or cache corruption recurs
  despite the atomic-replace write path. The storage seam in
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
