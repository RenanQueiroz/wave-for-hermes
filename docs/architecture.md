# Wave architecture

Wave is a native iOS and Android conversation client for Hermes Agent. The mobile app and the
runtime-neutral Wave protocol schemas live in this repository and use one npm lockfile, but they
remain separate runtime boundaries.

## Production topology

```text
Wave mobile
  ├─ PanelUI screens and feature controllers
  ├─ GatewayClient (src/services/gateway)
  └─ rotating gateway session tokens (platform secure storage)
          │
          │ private HTTPS: gateway REST + JSON-RPC over WebSocket
          ▼
    Hermes gateway (API server, speech endpoints, auth)

Wave mobile ◀════ direct WebRTC audio + sideband (user-owned key) ════▶ OpenAI Realtime API
```

The app talks to the user's Hermes gateway directly. Sign-in uses the gateway's password provider
with the same credentials as the Hermes dashboard; the phone stores only the gateway's rotating
session tokens in platform secure storage. The Hermes API key never exists on the phone. The only
OpenAI credential the app can hold is the key the user deliberately enters in Settings for the
opt-in Realtime voice mode; it lives in platform secure storage and travels only to
`api.openai.com`.

Homelab owns the gateway deployment, private networks, routing, and secrets. This repository owns
the mobile client and its normalized contracts.

Wave has no server-side application component of its own. `npm run verify:boundaries` fails if a
Wave backend workspace, server-only credential plumbing, or forbidden backend import reappears.

## Workspace boundaries

| Path                  | Runtime                    | Responsibility                                                       |
| --------------------- | -------------------------- | -------------------------------------------------------------------- |
| `src/`                | Expo / React Native        | Native mobile routes, UI, features, and client-side service adapters |
| `packages/contracts/` | Runtime-neutral TypeScript | Strict Zod schemas and inferred types for normalized Wave data       |
| `tools/mobile-agent/` | Development tooling        | Repository-local native automation and observability                 |

The repository root remains both the Expo application and npm workspace root. Do not move it into
an `apps/mobile` directory.

Dependency direction is one-way:

```text
mobile UI/features ──> WaveChatClient / GatewayClient ──> @wave/contracts
```

The mobile app never imports Fastify, the OpenAI SDK, or Hermes protocol types. `@wave/contracts`
has only Zod as a runtime dependency and has no Node.js, mobile, server, or UI dependencies.

Run `npm run verify:boundaries` to check these rules against workspace manifests, source imports,
and an existing production mobile export.

## Current mobile data boundary

The mobile implementation lives under `src/features/connection`, `src/features/sessions`,
`src/features/chat`, `src/features/realtime`, `src/features/voice`, `src/services/gateway`,
`src/services/query`, `src/services/realtime`, `src/services/sessions`, and `src/services/wave`:

- `src/services/gateway` is the only production backend transport: REST for the session list,
  timeline, rename, delete, and history; one WebSocket per turn carrying JSON-RPC for streaming;
  and normalization of every gateway shape into Wave contracts before it reaches a screen. It
  synthesizes the monotonic sequence numbers and turn identity the chat reducer expects, holds
  session tokens as opaque device-only values, and persists the rotated pair the gateway returns
  on any refresh. A conversation the user just started is routed by a local placeholder id until
  its first turn creates the real session; the client maps the two so the route stays stable. It
  also carries the gateway's speech endpoints — `/api/audio/transcribe` and `/api/audio/speak` —
  on a longer timeout than a REST read, because both are model work rather than lookups, and
  full-text search, which covers message content only (the gateway does not index titles).
  A turn that is streaming keeps its RPC channel registered so mid-turn agent prompts can be
  answered on the socket bound to its live session, and a delete is refused while that channel
  or the gateway's own `session.active_list` reports `starting`, `working`, or `waiting` (with a
  defensive legacy running alias) — the gateway accepts a mid-turn delete and lets the
  conversation reappear, so Wave enforces the contract itself. The public gateway version is a
  bounded development diagnostic only; optional protocol behavior uses attempt-and-degrade rather
  than version gates.
- The base-URL scheme policy (`src/services/wave/base-url-policy.ts`) requires HTTPS by default,
  allows HTTP for localhost and Tailscale CGNAT addresses where the transport is already private,
  and accepts an explicitly typed `http://` URL to a private LAN host as a deliberate opt-in.
- `WaveConnectionProvider` owns bootstrap, sign-in, restore, verification, retry, and local
  token cleanup. Screens do not construct authorization headers or raw protocol messages.
  Conversation screens receive the backend-neutral `WaveChatClient` plus a connection `identity`
  (id, base URL, kind, label); gateway-specific capabilities (speech, prompts, Realtime
  execution) are asked for explicitly as `gatewayClient`.
- When a saved connection's launch recheck fails for connectivity-shaped reasons only (offline
  device, timeout, transiently unreachable gateway), the connection degrades to an `offline`
  phase instead of returning to the connect screen: cached conversations stay readable, but the
  chat send, attachment, and voice controls are disabled (drafting stays possible) while the
  connection is offline, and the voice route itself is connected-only because live speech has
  nothing to degrade to. The provider re-verifies silently when the app foregrounds, when any
  Wave read completes over the network, or on explicit retry; authorization failures never
  degrade and land on the connect screen. Disconnect deletes the stored tokens — the gateway's
  stateless tokens cannot be revoked individually, and the gateway invalidates all outstanding
  tokens when its token secret rotates.
- `src/features/voice` is the gateway speech layer. `gateway-voice-machine.ts` holds the pure
  decisions (adaptive silence detection, utterance caps, stop words, upload MIME mapping, phase
  copy) so they are testable without a microphone; `use-dictation.ts` records one utterance into
  the composer; `use-message-playback.ts` reads one finished assistant message aloud, one player
  at a time; and `use-gateway-voice.ts` drives the continuous loop — listen, transcribe, run the
  transcript as an ordinary turn, speak the reply — abandoning any cycle whose generation has
  been superseded by stop or unmount. Recordings are mono 16 kHz, uploaded as a data URL, and
  deleted from the device cache immediately afterwards. The affordances are gated on a cached
  probe of what the server actually has configured, and disable with honest copy when it has
  neither provider.
- The Realtime mode is keyed by the user-owned OpenAI key. `OpenAiKeyStore` keeps the key in
  platform secure storage (`WHEN_UNLOCKED_THIS_DEVICE_ONLY`); the Settings card validates a key
  against `GET /v1/models` before saving and exposes presence — never the value — through the
  query cache. The voice route selects Realtime iff a key is saved and the user has left
  **Prefer live voice** on; otherwise it selects gateway voice.
- `OpenAiRealtimeBackend` performs the SDP exchange directly against
  `POST /v1/realtime/calls`, attaches the authenticated WebSocket sideband, and wires
  `ask_hermes` dispatch through `AskHermesOrchestrator`: strict schema validation, trusted
  binding to the initiating conversation's session, serialization, at most eight
  active-or-waiting requests, a 128-request per-call cap, exact-instruction coalescing within
  one initiating user turn, and response-safe delivery that holds completed results while the
  user is speaking or a model response is active. Validated instructions execute as ordinary
  turns on the gateway connection, so their side effects land in canonical Hermes history.
- `ReactNativeRealtimeTransport` owns audio-only microphone acquisition, SDP negotiation, the
  native peer and data channel, remote audio tracks, and cleanup. `WaveRealtimeController` owns
  call lifecycle, cancellation/expiry, bounded reconnection (grace for ICE self-recovery, then
  up to three full re-offers with the shared jitter policy), and normalized activity state. The
  PanelUI voice route renders controller snapshots and never owns raw WebRTC resources or
  provider protocol messages. Realtime transcripts are ephemeral: they render during the call
  and are not persisted anywhere.
- `WaveQueryProvider` owns finite server state for session lists and unified timelines.
  Connection changes cancel and remove the connection-scoped `wave` cache so one account cannot
  reuse another's data.
- `ActiveSessionStore` persists only a versioned, non-secret connection/session identifier pair
  for current-flow coordination. Connected cold launch deliberately creates a new conversation;
  Hermes remains the durable source for every prior conversation shown in the drawer.
- `useWaveChat` and its reducer own the single active stream, 50 ms assistant-delta batching,
  cancellation races, safe error state, and post-stream timeline reconciliation. The reducer
  keeps the composer busy until stream cleanup and reconciliation have settled, so a newly
  enabled send cannot race the prior turn. React screens do not parse stream frames or construct
  protocol messages.
- The Expo Router drawer is the connected app shell around a single native stack: every app
  screen lives in that stack, so screens get native headers, push transitions, and swipe-back,
  while the drawer stays a conversation switcher rather than a sibling navigator. Cold launch
  and **New conversation** create a Hermes session immediately; sticky top actions provide new
  and title search; paginated account history fills the middle; Settings and Disconnect stay
  fixed at the bottom. Rename/delete use typed lifecycle mutations, and a deleted current
  session routes to a new conversation.
- The PanelUI chat route renders normalized conversation data only. Tool events become bounded
  `Task` parts with a name, status, and optional raw input/output. Disclosures start collapsed
  and lazily render details as inert `CodeBlock` text; upstream event shapes, call IDs, run IDs,
  and credentials never enter the mobile render model. Wave avatars align with the bottom of a
  grouped turn and only its last item keeps the avatar-facing pointer radius.
  `PanelUIProvider` mounts the keyboard controller's `KeyboardProvider` exactly once at the app
  root — mounting a second one breaks per-frame keyboard animation on Android — and PanelUI's
  `KeyboardAvoider` docks the rounded `InputGroup` composer above the native keyboard, keeping a
  small gap while the keyboard is open. Opening the attachment sheet dismisses the keyboard
  first, since the styled sheet draws under the keyboard's own window. The attachment control
  sits inside the leading edge. The trailing slot shows exactly one of Stop, Send, or the
  live-wave action; when idle, trimmed text selects Send and empty text selects live voice.
- Camera/Photos become bounded inline JPEG turn parts. Supported text-based Files are read from
  the document-picker cache and become bounded inert text-file parts. The mobile client rejects
  unsupported binary files before dispatch.

## Shared protocol

`@wave/contracts` currently defines:

- the literal Wave API version (`v1`) and strict response metadata;
- stable safe error codes and the normalized error shape;
- paginated session, history, cursor-paginated unified timeline, and cancellation responses;
- attachment-aware turn input parts with strict bounds (four attachments, 4 MB decoded per
  image, 128,000 characters per text file);
- a strict discriminated union of ordered normalized turn events, including mid-turn prompt
  request/resolved events;
- strict inert tool-detail fields with explicit truncation;
- the Realtime call result shapes (Wave-owned identifiers only) and the client-side Realtime
  voice ID list;
- the strict `ask_hermes({ instruction })` schema and small structured success/error result.

Schemas reject unknown fields unless a future contract explicitly defines forward-compatible
behavior. The gateway transport validates untrusted boundary data at runtime and normalizes it
into these shapes; screens consume normalized domain types through `WaveChatClient` and must not
construct HTTP, WebSocket, Hermes, or OpenAI protocol messages.

## State and UI direction

- Hermes remains the source of truth for its durable sessions, messages, and tool records.
  Realtime speech is ephemeral; only work delegated through `ask_hermes` lands in history, as
  ordinary turns.
- TanStack Query owns finite server state such as paginated account sessions, the unified
  timeline, and speech capability probes. Retryable finite reads retry at most twice with the
  shared 500 ms exponential-jitter policy capped at 8 seconds; mutations never retry
  automatically.
- The query cache is persisted to one sandboxed cache file so previously viewed sessions and
  timelines stay readable offline. Only successful session-list and timeline reads dehydrate,
  entries expire after seven days or a cache-buster bump, and sign-in and sign-out purge the
  file alongside the in-memory cache. Persist writes go through a sibling temp file renamed into
  place so an interrupted write can never truncate the document, and a document that fails to
  parse on restore is deleted rather than left permanently unreadable. A connectivity-shaped
  refetch failure over cached data renders a quiet offline notice; every other error keeps its
  explicit surface.
- Active stream and Realtime lifecycles belong in focused controllers/reducers, not query cache.
- The connection provider owns only sign-in bootstrap and verification state; it is not a
  general application-state container.
- PanelUI renders Wave-owned conversation types; it does not own transport types or state.
- Timeline normalization drops empty records and groups entries by stable turn IDs. Tool
  activity renders as collapsed named status rows with the Wave avatar aligned to the last item.
  Expanding a row lazily renders bounded raw input and output as copyable plain code, never
  Markdown.
- The only Realtime tool is the strict `ask_hermes({ instruction: string })` operation. A
  model-controlled session ID is forbidden by construction — the schema has no such field, and
  the executor is bound to the initiating conversation.
- Wave owns the spoken interaction. The user addresses Wave naturally, and Wave selects and
  phrases a Hermes handoff when backend work is needed; successful voice responses do not
  require the user to understand or manage that boundary.
- Wave does not add an extra approval dialog before that narrow tool. The orchestrator
  dispatches it automatically only after strict argument validation, trusted call-state
  authorization, and rate/concurrency checks; Hermes's own tool safety policy still applies.

## Verification

Run the complete workspace checks from the repository root:

```bash
npm run build:contracts
npm test
npm run lint
npm run typecheck
npm run verify:boundaries
npx expo install --check
npm run mobile:smoke:production
```

The root `npm run lint` command includes the workspace ESLint checks and Prettier verification.
Use `npm run format` to apply the repository's shared formatting configuration.

Runtime-affecting changes also require the relevant iOS and Android flows. Native dependency or
app configuration changes require clean prebuilds, affected native builds, and Expo Doctor as
described in `AGENTS.md`.
