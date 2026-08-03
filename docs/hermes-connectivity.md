# Hermes connectivity

Wave talks directly to the user's Hermes gateway — the same server that backs the Hermes
dashboard and desktop client. The mobile transport lives in `src/services/gateway`; gateway
protocol shapes never leave it, and screens consume only normalized Wave contracts from
`packages/contracts`.

## Current compatibility baseline

The shipping transport was validated live against gateway version `0.19.0` (2026-08-02), both a
local instance and the private Homelab deployment. Hermes v0.20 support is tracked in
[`roadmap.md`](./roadmap.md); source inspection is not treated as live compatibility proof, so the
baseline below remains authoritative until the v0.20 probe and regression pass land.

- **Sign-in**: `POST /auth/password-login` with `{provider: 'basic', username, password}`. The
  response carries an access/refresh token pair (12-hour and 30-day lifetimes). Tokens rotate:
  responses can carry a refreshed pair, and the client persists whichever pair it saw last.
  Native PKCE does not exist at this version, so no browser flow or redirect URI is involved.
- **Tokens are stateless and signed.** Logout cannot revoke them server-side; they die at
  expiry or when the gateway's signing secret rotates (for example on restart), which signs out
  every client at once. Wave's Disconnect is therefore local token deletion and says so.
- **Chat transport**: JSON-RPC over WebSocket. Each connect first redeems a single-use
  30-second ticket, then the socket carries `prompt.submit`, streamed turn frames, mid-turn
  prompt requests, and cancellation. The client normalizes frames into the strict Wave
  turn-event union and synthesizes the monotonic sequence numbers the chat reducer expects.
- **Resilience**: an in-flight turn runs to completion through a disconnect and can be
  reattached by session with full history; only idle sessions are reaped (about 20 seconds).
  Reattaching is a read of the same execution — the prompt itself is never re-sent.
- **Cancellation** must go through the live transport sid; a stored id fails silently with a 4001. A user Stop is reported as a cancellation, not a connection loss.
- **REST**: paginated session list, `/messages` history, rename, delete, and full-text search.
  Search covers message content only — the gateway does not index titles, so Wave layers title
  matching client-side. `/messages?limit=` keeps the _oldest_ rows, so the timeline pages from
  the newest end with bounded probes when the count is unknown.
- **Deletes are not guarded upstream**: the gateway accepts deleting a session with a running
  turn and lets the conversation reappear. Wave refuses the delete client-side while the turn's
  RPC channel is registered or `session.active_list` reports a running turn.
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
reattachment, cancellation, and error mapping against recorded protocol shapes. A gateway
compatibility change is incomplete until the fixtures, live behavior, and this document agree.
