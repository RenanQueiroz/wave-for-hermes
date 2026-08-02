# Wave roadmap

This roadmap records product work that remains after the authenticated text-chat and live-voice
vertical slices, ordered by user impact and production risk. Feature-level detail for completed
work lives in the README, [`architecture.md`](./architecture.md), and [`security.md`](./security.md).

## Now: direct-to-gateway migration (decided 2026-08-01)

Wave will retire the companion and connect directly to the Hermes gateway so a new user only
downloads the app and signs in to their existing Hermes deployment. The findings and accepted
trade-offs are recorded in [`architecture.md`](./architecture.md); the staged plan:

1. **Spike the gateway transport and auth — complete (2026-08-02).** Verified live against a
   local gateway at the homelab's exact version (0.19.0) with the homelab's public surface
   cross-checked: password sign-in with rotating 12h/30d tokens (no browser flow needed —
   native PKCE does not exist at this version, mooting the redirect-URI question), single-use
   30-second tickets per WebSocket connect, full JSON-RPC turn streaming, and REST
   list/messages/rename/delete/search. Resilience measured: in-flight turns run to completion
   through disconnects and reattach with full history; only idle sessions are reaped (20
   seconds). Audio verified with zero client keys. Notable: logout cannot revoke the stateless
   tokens (expiry or server secret rotation only), and the agent can raise mid-turn approval
   prompts the app must render. Confirmed gaps have documented client-side workarounds; Wave
   does not submit issues or changes upstream.
2. **Migrate text chat and session lifecycle — landed (2026-08-02).** `src/services/gateway`
   speaks the gateway's REST and JSON-RPC protocols and normalizes them into the existing Wave
   contracts; the connect screen leads with username/password sign-in; conversation screens
   depend on a backend-neutral client and connection identity; both backends reach the same
   offline degradation. Verified on the iOS simulator against a live gateway: sign in, start a
   conversation, stream a reply, and see it listed with its title and preview. Companion pairing
   still works for devices that have not switched. Also verified on a physical Pixel 8 Pro
   (2026-08-02): sign-in, a streamed turn, the drawer listing conversations created on the other
   device (cross-device visibility through the shared Hermes store), and offline cold start
   degrading to cached reading. A stages 1-3 review (2026-08-02) then live-verified the
   protocol assumptions that had only been inferred, fixing three real defects: turn cancel
   now interrupts through the live transport sid (the stored id silently fails with a 4001),
   the timeline pages from the NEWEST end (`/messages?limit=` keeps the oldest rows, so long
   conversations hid their newest messages), and a user Stop is reported as a cancellation
   rather than "Wave lost the connection". Mid-turn agent prompts now render inline and are
   answerable — Hermes can pause a turn to ask for tool approval or a clarifying answer, and
   Wave previously rendered nothing, so the turn hung until the idle timeout. Conversation
   search now covers message content (the gateway does not index titles), and deleting a
   conversation while its turn is running is refused explicitly, which the gateway itself
   does not enforce. Attachments were live-verified the same way
   (2026-08-02): `image.attach_bytes` queues on the live sid before `prompt.submit` consumes
   it — the exact order the client already used — and attachment rejections now surface the
   gateway's own reason (cap, unsupported type) as non-retryable input errors instead of a
   generic failure. Two review findings were then fixed and re-verified on both the iOS
   simulator and the Pixel 9 emulator (2026-08-02): the chat timeline no longer snaps to the
   newest message while the user reads far-back history (the maintain-at-end pin is now gated
   on fresh scroll geometry, so a focus refetch or an older-page load cannot move the list —
   this also fixed the companion path), and a first page whose session-detail count probe
   fails now locates the newest window with bounded single-row offset probes instead of
   transferring the entire history. The composer attachment device pass closed the stage's
   last open verification (2026-08-02): on both platforms the system pickers fed the strict
   Wave parts end to end against the live gateway — photo attachments stored byte-identical
   server-side and answered with a streamed reply (including on a brand-new chat, where the
   attachment queues on the session created at first send), a Markdown file's bounded
   contents delivered verbatim, and an unsupported binary refused in the composer with the
   exact contract copy. The pass surfaced one cosmetic defect, fixed the same day: after
   the post-turn reconcile, user bubbles rendered the gateway's own image annotations —
   including the server-side upload path — verbatim; gateway normalization now folds the
   exactly-matching annotation pairs into bounded Wave-owned `[Attached image: …]` markers
   after the typed text, leaving anything unrecognized untouched. An owner-reported gap
   was fixed the same day: on a gateway
   connection the drawer's Settings and Scheduled jobs entries silently bounced to a new
   chat because both screens redirect when companion capabilities are absent — Settings now
   renders its gateway-relevant sections (connection identity, appearance), and the
   Scheduled jobs entry is shown only on companion connections until a gateway jobs
   contract exists. Owner-reported sign-in friction on the physical Pixel exposed two more
   fixes (2026-08-02): connection errors from gateway paths had been rewritten with the
   companion's "pair again" copy (a wrong password looked like a revoked device — gateway
   errors now surface their own messages, verified live against the homelab gateway), and
   the connect screen's URL/username/pairing-code fields now use input classes Android
   keyboards actually leave uncorrected. Keyboard avoidance followed (2026-08-02): the
   connect form scrolls its focused field clear of the keyboard through a keyboard-aware
   scroll container, the prompt card's free-text answer lifts with its Send button, and
   the rename dialog's input lifts itself — verified on the physical Pixel and the iOS
   simulator.
3. **Adopt gateway voice — landed (2026-08-02).** On a gateway connection the voice route now
   runs Hermes's own voice mode (record → `/api/audio/transcribe` → normal turn →
   `/api/audio/speak`), and the composer gained a dictation microphone while finished assistant
   messages gained a Play control. All three are gated on a cached probe of the server's
   configured providers and disable with copy naming what is missing. Verified against a live
   0.19.0 gateway: real recorded speech transcribed accurately, ran as a turn, and came back as
   synthesized audio; dictation, playback, and the listen/transcribe/idle loop exercised on both
   the iOS simulator and a physical Pixel 8 Pro. Two deliberate deviations from the plan: the
   reply is spoken after the turn completes rather than streamed sentence-by-sentence, and the
   interrupt is an explicit Skip control rather than acoustic barge-in, because `expo-audio` has
   no speaker-routing override and an open recorder would force iOS playback to the earpiece.
   The providerless degradation run closed (2026-08-02): against a gateway reporting no
   STT/TTS, the dictation mic and every Play control disappear and the voice screen shows
   the named-provider copy with Start disabled — no path to the microphone exists. The
   owner's first spoken round trip on the physical Pixel against the homelab gateway also
   ran the same day: transcription, turn, and spoken reply all worked, surfacing defects
   that were fixed the same day — silence auto-send never fired on Android (its metering
   reports peak amplitude where iOS reports average power, so the fixed iOS-calibrated
   threshold heard everything as speech; detection now tracks a rolling noise floor plus
   a margin, holds through isolated stray peaks, and only counts silence after speech),
   the voice screen had no exit without starting (idle now shows Close beside Start), and
   a failed capability probe cached itself as "no providers" for five minutes (it now
   throws so the bounded retry policy owns recovery). The stage closed 2026-08-02 with
   the owner confirming on the physical Pixel that auto-send fires reliably on a pause
   and that Skip and the bare-"stop" stop-word both work. With stages 2 and 3 complete,
   the owner's Pixel now runs fully against the homelab gateway — the first real device
   migrated off the companion.
4. **Realtime as opt-in with a user-owned key — landed (2026-08-02), verification gates
   open.** Settings gained a Live voice card: the OpenAI key is validated with one
   authenticated call, stored in platform secure storage (device-only, excluded from
   backups), removable, with a "Prefer live voice" toggle and a client-side voice picker
   (the companion catalog and previews are no longer involved). The app now does the
   Realtime SDP exchange and sideband directly against OpenAI with that key, and the
   companion's ask_hermes safety rules were ported as contract clauses enforced
   client-side — strict schema (a model-supplied session id is invalid by construction),
   trusted session binding, exact-instruction coalescing, serialization, bounded
   concurrency, response-safe result delivery — with one named test per rule; ask_hermes
   executes as ordinary turns on the gateway connection. Realtime transcripts are
   ephemeral and the call screen says so. Connection loss now re-offers with bounded
   jittered attempts (after a grace window for ICE self-recovery) before failing
   explicitly. Mode selection: Realtime iff a key is saved and enabled, else gateway
   voice. Verified live on the iOS simulator: the owner's real key validated and saved
   through the UI, and a full Realtime call connected and ended cleanly on that key with
   no companion involved. The key-hygiene surface extended to the production scanner
   (key-shaped literals refused) and `security.md` (user-owned-key model + revocation
   story). The toggle-off fallback to gateway voice was verified live both ways, and a
   log sweep spanning two live Realtime calls confirmed the key appears nowhere in device
   logs. Remaining are the human gates:
   a spoken ask_hermes round trip (an automated host-audio attempt registered microphone
   level but no model response, so this needs a real voice) and the physical-device audio
   gates in `webrtc-foundation.md` — these gate calling Realtime production-ready, listed
   under production voice behavior below.
5. **Retire the companion — landed (2026-08-02).** The `companion/` workspace, its Dockerfile
   and admin/fixture tooling, the mobile companion transport (`WaveBackendClient`, the Wave SSE
   parser, the paired-device credential store), the pairing flow, the operations/scheduled-jobs
   surface, the companion voice-preview plumbing, and the companion-only contracts (status,
   diagnostics, pairing, scheduled jobs, voice catalog, and route request envelopes) are
   removed. The connection provider, connection screen, settings, drawer, and voice route are
   gateway-only; `WaveChatClient` remains as the reviewed conversation-surface contract with
   `GatewayClient` as its one implementation. `verify:boundaries` now fails if a companion
   workspace reappears, and the docs describe the gateway-only architecture. Gateway sign-out
   is local token deletion and says so.

Contract and dependency-policy amendments in `AGENTS.md` land stage by stage with the code, not
in advance, so the guide always describes the repository as it is.

## Now: production voice behavior

These gates apply to the user-keyed Realtime mode (stage 4 of the direct-to-gateway
migration) and remain open before Realtime is called production-ready.

1. Repeat the Realtime microphone, playback, tool-call, mute, and teardown proof on physical iOS
   when hardware is available.
2. Validate speaker, receiver, Bluetooth, and wired-headset selection and route changes on
   physical devices.
3. Validate phone/audio interruptions, device lock, route changes, and reconnect behavior on
   physical devices. Simulator validation covers permission denial and recovery, direct access to
   system settings, established-call background teardown, and a clean subsequent call on both
   platforms.
4. Validate release builds and realistic Wi-Fi, cellular, and private-network transitions.

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
- Offline-cache durability, both causes found and fixed. First (2026-08-01): the persister
  rewrote its JSON document in place, so an interrupted write left a truncated file that restore
  treated as "no cache"; writes now go through a temp file renamed into place and a corrupt
  document is deleted on restore. Second, and the real cause of the anomaly (2026-08-02, found
  on a physical Pixel): failed reads are excluded from the dehydrated state, so **an offline
  start persisted an empty document over the good cache** — the cache was erased exactly when it
  was needed. Persisting an empty client state is now a no-op. Verified on the Pixel: before the
  fix an offline cold start left a 102-byte empty cache and an empty drawer; after it, the cache
  survived at 771 bytes and all four conversations stayed readable offline.

## Next: release hardening and focused operations

- Review release-build cleartext policy before a store-style build ships the Tailscale and
  private-LAN plain-HTTP carve-outs; development clients already permit them. iOS App Transport
  Security exempts IP literals and `.local` hosts, so the review may conclude no Info.plist
  exception is needed; Android release builds still need an explicit cleartext-network policy for
  the allowed private ranges.
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
