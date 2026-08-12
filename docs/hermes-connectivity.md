# Hermes connectivity

Wave talks directly to the user's Hermes gateway — the same server that backs the Hermes
dashboard and desktop client. The mobile transport lives in `src/services/gateway`; gateway
protocol shapes never leave it, and screens consume only normalized Wave contracts from
`packages/contracts`.

## Current compatibility baseline

The shipping transport was validated live against the private Homelab gateway running `0.20.0`
on 2026-08-03 from the existing Radon-managed iOS and Android development runtimes. The
compatibility floor remains the sanitized `0.19.0` protocol fixture and the behavior Wave already
shipped against that release. Wave does not branch product behavior on a version string: optional
methods and fields are attempted only by features that need them and must degrade safely when
absent or malformed.

- **Sign-in**: `POST /auth/password-login` with `{provider: 'basic', username, password}`. The
  response carries an access/refresh token pair. Tokens rotate: responses can carry a refreshed
  pair, and the client persists whichever pair it saw last. Neither measured release exposes a
  native PKCE flow, so no browser flow or redirect URI is involved.
- **Tokens are stateless and signed.** Logout cannot revoke them server-side; they die at
  expiry or when the gateway's signing secret rotates (for example on restart), which signs out
  every client at once. Wave's Disconnect is therefore local token deletion and says so.
- **Compatibility diagnostics**: `/api/status` currently reports `0.20.0`. Development builds
  project only that bounded public version into the repository-local mobile state bridge. It is
  evidence for live validation, not a feature flag, and no other status/configuration metadata is
  normalized.
- **Chat transport**: JSON-RPC over WebSocket. Each connect first redeems a single-use
  30-second ticket, then the socket carries `prompt.submit`, streamed turn frames, mid-turn
  prompt requests, and cancellation. The v0.20 `gateway.ready` frame may include
  `change_events: true`; Wave treats that field as optional. The client normalizes only reviewed
  frames into the strict Wave turn-event union and synthesizes the monotonic sequence numbers the
  chat reducer expects.
- **Resilience**: an in-flight turn runs to completion through a disconnect and can be
  reattached by session with full history; only idle sessions are reaped (about 20 seconds).
  Reattaching is a read of the same execution — the prompt itself is never re-sent.
- **Live state**: `session.active_list` can report `starting`, `working`, `waiting`, or `idle`.
  Wave treats all but `idle` as active for conflict checks; a legacy `running: true` or `running`
  status remains a defensive alias. The normalized response also carries bounded `lastActiveAt`
  when present so a resumed screen can show an eight-minute stale-working presentation hint.
  Missing and unknown states do not claim that a turn is active, and freshness never settles work
  or weakens conflict checks.
- **Cancellation** must go through the live transport sid. A user Stop is reported as a
  cancellation, not a connection loss.
- **REST**: paginated session list, `/messages` history, pin/unpin, rename, delete, and full-text
  search.
  Search covers message content only — the gateway does not index titles, so Wave layers title
  matching client-side. `/messages?limit=` keeps the _oldest_ rows, so the timeline pages from
  the newest end with bounded probes when the count is unknown. v0.20 caps session pages at 100
  rows and message pages at 500; Wave uses the shared 100-row session limit and keeps its
  200-row timeline window bounded across both releases.
- **Deletes are not guarded upstream**: the gateway accepts deleting a session with a running
  turn and lets the conversation reappear. Wave refuses the delete client-side while the turn's
  RPC channel is registered or `session.active_list` reports any known active phase.
- **v0.20 correction**: a non-empty, text-only busy composer uses `session.redirect` on the
  already-registered live turn channel. `redirected` keeps the correction before the active reply,
  `queued` moves it after that reply, and `rejected` restores the draft. The request cannot carry
  a session id or attachment and is never retried automatically. Hermes model-time redirects
  persist an ordinary user row; tool-time redirects use safe tool-result steering and may omit a
  distinct HTTP row, so Wave keeps only gateway-accepted text in its bounded account-scoped cache
  and restores that row after reload. It never recognizes correction text from untrusted tool
  output.
- **v0.20 organization**: `pinned` is durable server metadata changed with one non-retrying
  `PATCH /api/sessions/{id}` and reconciled after an optimistic mobile projection. Wave requests
  recent top-level rows, advances pagination by the server page limit so pin backfills cannot skip
  ordinary rows, and leaves upstream-internal child sessions excluded. List requests pass
  `min_messages=1` (the same filter Hermes Desktop's sidebar uses, honored by the shared `total`
  count) so messageless session shells never reach the drawer; a brand-new Wave chat is a local
  pending id until its first turn persists, so the filter does not hide it. The open-ended `source`
  value becomes only `chat`, `automation`, `external`, or `other`; missing v0.19 metadata defaults
  to an unpinned idle chat, and unknown future values remain reachable in the Other sources
  filter (everything the Chats filter excludes). The legacy
  list `is_active` heuristic means "recent and not ended", so Wave does not misreport it as a
  running turn; only an exact reviewed phase becomes list liveness.
- **Reasoning**: live turns may carry `reasoning.delta` frames (emission gated by the server's
  `show_reasoning` setting), and stored assistant rows may carry plain-text `reasoning`,
  `reasoning_content`, or a string `reasoning_details` — normalized with Hermes Desktop's
  precedence into one bounded, truncated Wave trace per assistant message (rendered through the
  same markdown pipeline as assistant text). Opaque provider
  reasoning structures never cross. Codex providers additionally narrate progress on a commentary
  channel (`show_commentary`, default on): completed commentary arrives as ordinary
  `message.interim` segments, so the reasoning trace holds only private reasoning.
- **v0.20 activity frames**: `message.interim` seals the current assistant segment; a previewed
  final can replace that segment once without duplicating it. `tool.progress` updates the existing
  named tool row with one bounded preview. Only reviewed compaction, goal, process, and ready
  states cross from `status.update` into ephemeral Wave-owned labels. Unknown fields and statuses
  remain ignored. These projections update only the active chat tail and are never persisted as
  assistant speech. Sanitized fixtures contain synthetic shapes only.
- **Per-chat model (v0.20)**: the picker reads RPC `model.options
{explicit_only: true, session_id?}` after a `session.resume`, so the answer reflects the
  session's own scoped override; Wave normalizes it into a bounded catalog (auth internals, key
  env names, and API URLs are dropped; unauthenticated provider rows are excluded). A switch is
  one non-retrying `config.set {session_id: <live sid>, key: 'model', value:
'<model> --provider <slug> --session', confirm_expensive_model?}`; the value is built only
  from catalog-validated ids so `--global`/`--once` are impossible. A busy session answers
  `deferred: true` and applies the pick at its next turn start; `confirm_required` is re-sent
  only after explicit user confirmation. A conversation with no gateway session yet keeps the
  pick client-side and sends it as `model`/`provider` on its eventual `session.create`.
- **Slash commands (v0.20)**: the composer catalog comes from RPC `commands.catalog`
  (`pairs`/`canon`/`skills` normalized into a bounded Wave catalog; suggestions filter locally —
  Wave deliberately skips per-keystroke `complete.slash`, which would mint a ticket per call on
  Wave's one-socket-per-RPC transport). Execution resumes the session and runs one
  `slash.exec {session_id, command}`; a refusal falls back to one
  `command.dispatch {name, arg, session_id}` exactly like Desktop, and a quick-command `alias`
  re-dispatches once. Results normalize into bounded directives: inert `output` text, a
  `prefill` draft, or a `send` expansion submitted through the normal `prompt.submit` path with
  its bounded `display` shown as the user row. `/compress` uses the dedicated
  `session.compress` RPC (Desktop avoids `slash.exec` there — it times out on large sessions)
  and `/title` uses the existing rename endpoint. `/status` deliberately routes through generic
  `slash.exec`: the deployed gateway exposes no dedicated status RPC. A gateway without
  `commands.catalog` degrades honestly — Wave's own registry commands still run, and an
  unrecognized leading-slash submit gets a bounded "commands aren't available on this server"
  notice instead of silently becoming a chat turn.
- **Branch and regenerate (v0.20)**: `session.branch {session_id: <live sid>, count?}` copies
  the live session's history (all of it when `count` is omitted — Wave's exact newest-turn
  case) into a new stored session and returns `stored_session_id` + `title`. Regenerate is
  `prompt.submit` with `truncate_before_user_ordinal` (plus `confirm_empty_truncate` at ordinal
  0): the gateway validates the ordinal against user rows without `display_kind` (Wave
  normalizes that flag as `ordinalExempt` and excludes such rows plus its own journal rows from
  ordinal math), persists the truncation before running, and re-expands stored skill
  invocations for replay. Both are one-shot, never retried, and refused client-side while a
  turn runs.
- **Mid-turn prompts**: the agent can pause a running turn to ask for tool approval or a
  clarifying answer. Wave renders these inline in the turn, answers them on the socket bound to
  that turn's live session, and clears them when anything proves them settled (an answer from
  another client, or server-side expiry). `secret`/`sudo` prompts are declined with copy that
  says why; Wave never collects credentials on the phone.
- **Attachments**: `image.attach_bytes` (`content_base64`, `filename`) queues an image on the
  live sid before `prompt.submit` consumes it. The gateway prepends its own annotation block to
  the stored user message for each image; Wave folds the exactly-matching annotation pairs into
  bounded Wave-owned `[Attached image: …]` markers during normalization and leaves anything
  unrecognized untouched. Attachment rejections surface the gateway's own reason (cap,
  unsupported type) as non-retryable input errors.
- **Speech**: `POST /api/audio/transcribe` and `POST /api/audio/speak`, with STT/TTS providers
  and their keys held in server configuration. Wave probes capability once and caches it; the
  probe throws on request failure so the bounded retry policy owns recovery rather than caching
  a false "no providers". Speech calls run on a longer timeout than REST reads because both are
  model work.
- **Streamed speech (v0.20)**: gateway voice mode opens one per-reply
  `/api/audio/speak-stream?ticket=<single-use>` WebSocket (the same ticket flow as `/api/ws`).
  Wave sends `{"text": …}` frames as assistant narration streams, `{"done": true}` when the
  reply completes, and `{"stop": true}` or a disconnect as barge-in; the server answers
  `{"type": "start", "sample_rate", "channels"}`, unaligned binary Int16 PCM frames (Wave
  carries the odd tail bytes), and `{"type": "end"}` — or `{"type": "fallback"}` when no chunked
  TTS provider is configured. The session in `src/services/gateway/gateway-speech-stream.ts`
  owns the bounds, timeouts, and the admission ledger feeding the native PCM player, never
  retries, and resolves a fallback authority: `unspoken` (no audio ever audible — the complete
  reply is safe to synthesize buffered), or `incomplete` (audible audio; the reply stays
  text-only). A `fallback` answer is cached briefly so unsupported gateways are not re-dialed
  per reply; older gateways without the route fail the upgrade and take the same buffered path.

## Attachments

Wave supports two explicit attachment mappings, capped at four attachments per turn with
non-empty message text:

- Camera and Photos become validated inline JPEG data, capped at 4,000,000 decoded bytes per
  image.
- Supported text/code documents become one labeled inert text part, capped at 128,000
  characters.

Unsupported binary documents are rejected in the mobile client before dispatch. Wave does not
expose Hermes file upload, path, or filesystem access.

## Realtime `ask_hermes` dispatch

A Realtime call is bound at setup to the conversation it was opened from; the model cannot
provide or replace that session. When the Realtime session requests `ask_hermes`, the app:

1. accepts only the strict bounded `{ instruction }` schema (unknown tools and fields fail
   closed; the schema has no session field at all);
2. verifies the call is still tracked by trusted call state;
3. queues distinct requests in a bounded per-call lane (eight active-or-waiting, 128 per call)
   and executes them serially;
4. runs the instruction as an ordinary turn on the gateway connection, so its side effects land
   in canonical Hermes history;
5. returns only a bounded structured answer or safe error through the originating tool call,
   deferred while the user is speaking or a model response is active;
6. aborts the turn stream when the call ends.

Distinct tool-call IDs carrying the same normalized instruction in one initiating user turn are
coalesced onto one execution and each receive the shared result; the same request in a later
user turn executes again. Wave adds no extra confirmation dialog for this narrow tool; Hermes's
own tool safety behavior remains authoritative.

## Private production deployment

The Homelab deployment runs the pinned Hermes gateway behind private Tailscale HTTPS. The
gateway's provider keys stay in Homelab's ignored mode-`0600` environment; a mobile device
holds only its own rotating session tokens. The Homelab repository owns deployment validation.

The validated mobile origin is:

```text
https://hermes.<tailnet>.ts.net
```

## Validation

Run the deterministic transport and normalization tests:

```bash
npm test
```

`test/mobile/gateway-protocol.test.ts` covers sign-in, token rotation, framing, normalization,
reattachment, cancellation, active-state handling, and error mapping against sanitized v0.19 and
v0.20 protocol shapes. A gateway compatibility change is incomplete until the fixtures, live
behavior, and this document agree.

For the two Radon runtimes, bind the mobile doctor to each platform's own Metro server rather than
letting target discovery choose between them:

```bash
MOBILE_AGENT_METRO_URL=http://127.0.0.1:<ios-metro-port> npm run mobile:doctor
MOBILE_AGENT_METRO_URL=http://127.0.0.1:<android-metro-port> npm run mobile:doctor
```

The 2026-08-03 live probe used only uniquely titled scratch conversations, recorded booleans and
frame names rather than request payloads or identifiers, and removed each scratch row after
verifying its exact title. It did not read ordinary conversation history, secrets, gateway
configuration, tool/skill metadata, MCP state, or A2A data.

The Stage 3 organization probe used one uniquely marked scratch conversation: iOS pinned it,
Android observed the server-owned pin and unpinned it, and iOS reconciled that change after
refocus. An exact account search then confirmed that the scratch conversation had been deleted.
