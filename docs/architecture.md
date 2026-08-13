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
  timeline, pin/unpin, rename, delete, and history; one WebSocket per turn carrying JSON-RPC for
  streaming;
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
  deleted from the device cache immediately afterwards. Both voice screens render one decorative
  Soundwave ambient glow behind the content, breathing on the instantaneous maximum of the user
  and assistant levels (recorder dBFS meter and ephemeral playback PCM for gateway voice; local
  and remote WebRTC stats for Realtime); missing levels degrade to the phase animation, neither
  samples nor level history are retained, and the phase title/description stay the accessible
  status. Around that glow, both screens render platform-native chrome: the status header,
  plain-text transcript blocks, notice cards, and controls are shared SwiftUI/Compose
  components under `src/features/voice/` (`voice-status`, `voice-transcript`, `voice-notice`,
  `voice-actions`, `voice-call-controls` behind `voice-screen-ui.types.ts`), while the chat
  `PromptCard` and the assistant reply's `Response` markdown block stay React Native. Call
  clusters follow each platform's system call UI — captioned circular glyph buttons, with the
  end control as iOS's red circle in the row and Android's wide destructive pill below it — and
  both screens hold an `expo-keep-awake` lock only while a call or loop is active so the device
  cannot auto-lock mid-conversation. The affordances
  are gated on a cached probe of what the server actually has configured, and disable with honest
  copy when it has neither provider.
- `src/native/pcm-player.ts` is the one Wave owner for `react-native-audio-api`'s native
  `AudioBufferQueueSourceNode`. It validates little-endian interleaved Int16 PCM, converts it to
  bounded planar audio buffers, coalesces transport chunks into 600 ms native batches, and admits
  one or two channels, 8–48 kHz, 512 KiB chunks, and at most 12 seconds queued. The device-rate
  context may remain warm for five seconds after a clean drain or normal Stop so consecutive
  clauses and input format changes avoid another hardware activation. Stop fades immediately; on
  Android its muted queue node is retained until that bounded close, and transient audio focus is
  requested once per context. Failure, interruption, and confirmed background close immediately.
  The adapter also reports the RMS of the buffer at the native playback head so a future production
  waveform tracks audible audio rather than incoming socket timing. It exposes only deterministic
  drain, Stop, and bounded accounting — not the package's general audio-engine surface. This
  boundary currently serves only the development proof in `src/dev`; no production screen or
  gateway transport writes into it yet. A future streaming speech client stays in
  `src/services/gateway` and may pass only validated audio bytes across this boundary after the
  physical-device gates in `docs/pcm-playback-foundation.md` pass.
- The Realtime mode is keyed by the user-owned OpenAI key. `OpenAiKeyStore` keeps the key in
  platform secure storage (`WHEN_UNLOCKED_THIS_DEVICE_ONLY`); the Settings card validates a key
  against `GET /v1/models` before saving and exposes presence — never the value — through the
  query cache. The voice route selects Realtime iff a key is saved and the user has left
  **Prefer live voice** on; otherwise it selects gateway voice. A separate strict versioned
  preference allows only `gpt-realtime-2.1-mini` or `gpt-realtime-2.1`, defaults invalid or retired
  values to mini, and is snapshotted into a newly constructed backend so it cannot mutate a live
  call. Voice choice remains a separate preference.
- `OpenAiRealtimeBackend` performs the SDP exchange directly against
  `POST /v1/realtime/calls`, attaches the authenticated WebSocket sideband, and wires
  dispatch through `AskHermesOrchestrator`: strict schemas, trusted binding to the initiating
  conversation, coalescing, the steer-by-default turn-owner model (no client-side ask queue;
  bounded, serialized redirect dispatches), and response-safe result delivery. Validated
  `ask_hermes` instructions execute as ordinary gateway turns, so their side effects land in
  canonical history; a further ask while the owner turn runs is delivered into that work through
  one `session.redirect` and acknowledged as `steered` or `queued`, with the combined outcome
  arriving on the owner's still-pending call. Once that turn's live redirect lane is registered, the sideband sends
  one complete `[ask_hermes, correct_hermes]` session snapshot and waits for a matching full
  `session.updated`; settlement restores the complete ask-only snapshot. Update failures never
  retry automatically or change trusted authority. The pure prompt/config builders take only
  app-owned state: no gateway version, tool, skill, MCP, A2A, Agent Card, or configuration metadata
  can enter the OpenAI session.
- `ReactNativeRealtimeTransport` owns audio-only microphone acquisition, SDP negotiation, the
  native peer and data channel, remote audio tracks, and cleanup. It samples WebRTC stats at a
  bounded rate and reduces only the local audio source and remote inbound audio to ephemeral 0–1
  levels; raw reports and track/provider identifiers never leave the transport. Missing metrics
  fall back to phase-driven animation without affecting the call. `WaveRealtimeController` owns
  call lifecycle, cancellation/expiry, bounded reconnection (grace for ICE self-recovery, then
  up to three full re-offers with the shared jitter policy), normalized activity state, and final
  exact stop-command teardown. The
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
  sealed interim assistant segments, in-place bounded tool progress, reviewed ephemeral activity,
  server-reported live state/freshness, cancellation and correction races, safe error state, and
  post-stream timeline reconciliation.
  A text-only correction is optimistically inserted before the active assistant reply, kept there
  when redirected, moved to the tail when queued, or removed and restored to the draft when
  rejected/ambiguous. An explicitly accepted correction is also recorded in a bounded,
  account-scoped TanStack journal. Timeline reads merge that app-trusted row after its initiating
  prompt when Hermes's tool-boundary steering did not persist a distinct HTTP user row, while
  deduplicating the ordinary user row Hermes does persist for model-time redirects. The reducer
  keeps new turn submission blocked until stream cleanup and reconciliation have settled, so a
  newly enabled send cannot race the prior turn. React screens do not parse stream frames or
  construct protocol messages. Unknown status frames and reasoning stay at the transport boundary;
  the UI receives only a small Wave-owned lifecycle vocabulary. A stale-working hint is
  presentation only and cannot settle a turn, resend work, or authorize deletion.
- The Expo Router drawer is the connected app shell around a single native stack: every app
  screen lives in that stack, so screens get native headers, push transitions, and swipe-back,
  while the drawer stays a conversation switcher rather than a sibling navigator. Cold launch
  and **New conversation** create a Hermes session immediately; sticky top actions provide new
  and title/message search, and the conversation filter stays pinned with them while only the
  list scrolls. Paginated account history fills the middle with a server-owned Pinned
  section followed by Today / Yesterday / Previous 7 days / Older groups. Chats is the quiet
  default; Other sources holds everything else — normalized automation, messaging/A2A, and
  unknown future sources. The two filters partition every source exactly, so together they keep
  every user-facing top-level row with messages reachable. Hermes excludes internal child
  sessions, and Wave requests `min_messages=1` like Hermes Desktop so messageless session
  shells (abandoned API creates, test leftovers) stay out of both filters. A conversation reached
  another way (search id match, restored active session) still opens and renders an explicit
  no-messages state distinct from the new-chat screen.
  Pin/unpin, rename, and delete use typed non-retrying lifecycle mutations; pinning updates every
  paginated cache occurrence optimistically, rolls back an error, and reconciles with the server.
  A deleted current session routes to a new conversation.
- The chat route renders normalized conversation data only. Its transcript remains PanelUI/RN:
  user messages keep bubbles;
  agent output is full width — assistant text through `Response` markdown (streaming tail via
  `isStreaming`, sealed and completed text parsed once), tool and handoff records as `Marker`
  action rows with bounded one-line derived labels, a per-turn `Reasoning` disclosure over the
  bounded reasoning trace rendered with the same `Response` markdown pipeline (streaming live,
  folded for history), and waiting states as `Shimmer` text. The
  Wave-owned `ConversationScroller` wraps Legend List with the transcript scroll contract
  (at-end pinning, jump-to-newest, stable prepends, anchored opening). Raw tool input/output is
  not displayed; upstream event shapes, call IDs, run IDs, and credentials never enter the
  mobile render model.
  `PanelUIProvider` mounts the keyboard controller's `KeyboardProvider` exactly once at the app
  root — mounting a second one breaks per-frame keyboard animation on Android. The extracted
  `ChatComposer` is a direct Expo UI native island: one intrinsic-height `Host` contains the
  SwiftUI/Compose field, controls, accessory states, and platform icons. Attachment selection is
  an anchored native menu on the + button (SwiftUI `Menu` / Compose `DropdownMenu`) whose items
  launch their pickers directly, while the model picker is a platform-native sheet (SwiftUI
  `BottomSheet` with an inset-grouped `List` / Compose `ModalBottomSheet` with grouped rows on a
  plain scrollable `Column` — `LazyColumn` inside the sheet swallows pointer events) in its own
  sibling presentation `Host`. Native observable state owns
  the immediate draft, so typing re-renders only the composer controller and not the transcript.
  The non-visual React Native `ChatComposerDock` alone translates the host with the keyboard;
  SwiftUI and Compose keyboard insets are disabled to prevent the prior iOS double lift. Opening
  the model sheet first dismisses the keyboard; the attachment menu floats above it. The model trigger is text-only and resolves the current or
  pending chat default as `model · effort`; capability metadata gates separate Thinking, Effort,
  and Fast controls instead of appearing as model subtitles. The trailing slot shows exactly one
  action: when idle, trimmed text selects Send and empty text selects live voice; during a turn,
  eligible text selects Correct and empty or ineligible content keeps Stop. Corrections are
  text-only, so attachment, prompt-response, cancellation, and correction-in-flight states cannot
  race the mutation.
- Camera/Photos become bounded inline JPEG turn parts. Supported text-based Files are read from
  the document-picker cache and become bounded inert text-file parts. The mobile client rejects
  unsupported binary files before dispatch.

## Shared protocol

`WaveRedirectTurnRequestSchema` accepts only one bounded text field and has no identifier fields.
`GatewayClient.redirectTurn` resolves the stored conversation through trusted state, requires the
already-registered turn channel, sends `session.redirect` once with its live sid, and exposes only
the normalized `redirected | queued | rejected` result. It never opens a generic RPC surface or
automatically retries an ambiguous mutation.

`@wave/contracts` currently defines:

- the literal Wave API version (`v1`) and strict response metadata;
- stable safe error codes and the normalized error shape;
- paginated session, history, cursor-paginated unified timeline, and cancellation responses;
  session summaries contain only Wave-owned `chat | automation | external | other` source
  categories plus normalized pin and live-status fields;
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

- Hermes remains the source of truth for its durable sessions, messages, and tool records. The
  one presentation overlay is an app-trusted accepted chat correction when Hermes delivered it
  through a tool-result boundary without a distinct HTTP user row; Wave never infers that row
  from untrusted tool content. Realtime speech is ephemeral; only work delegated through
  `ask_hermes` lands in history, as ordinary turns.
- TanStack Query owns finite server state such as paginated account sessions, the unified
  timeline, and speech capability probes. Retryable finite reads retry at most twice with the
  shared 500 ms exponential-jitter policy capped at 8 seconds; mutations never retry
  automatically.
- The query cache is persisted to one sandboxed cache file so previously viewed sessions and
  timelines stay readable offline. Successful session-list and timeline reads plus at most 32
  accepted correction-journal rows per session dehydrate; entries expire after seven days or a
  cache-buster bump, and sign-in and sign-out purge the file alongside the in-memory cache. The
  session-organization contract bumped the cache generation so legacy rows without normalized
  pin/source/live-status fields cannot hydrate into the new UI.
  Persist writes go through a sibling temp file renamed into place so an interrupted write can
  never truncate the document, and a document that fails to parse on restore is deleted rather
  than left permanently unreadable. A connectivity-shaped refetch failure over cached data
  renders a quiet offline notice; every other error keeps its explicit surface.
- Active stream and Realtime lifecycles belong in focused controllers/reducers, not query cache.
- Device-local preferences (Realtime model/voice/captions, theme appearance, OpenAI-key
  presence) live in small vanilla Zustand stores under `src/state/`, hydrated once from secure
  storage with strict versioned records that degrade to defaults, written optimistically, and
  bound to React only at the edge (`use-device-state.ts`). They never hold server data or
  secrets — key material stays in `openAiKeyStore` with presence projected.
- The connection provider owns only sign-in bootstrap and verification state; it is not a
  general application-state container.
- PanelUI renders Wave-owned conversation types; it does not own transport types or state.
- Timeline normalization drops empty records and groups consecutive assistant-family rows into
  turns by role. Tool activity renders as `Marker` rows whose labels are bounded one-line
  actions derived from validated tool names and defensively parsed input — inert plain text,
  never Markdown, with raw payloads never displayed.
- Realtime begins with the strict `ask_hermes({ instruction: string })` operation. While exactly
  one ask execution has a registered live gateway lane, a complete acknowledged session snapshot
  also advertises strict `correct_hermes({ instruction: string })`. Neither schema contains a
  session, turn, call, run, mode, attachment, or arbitrary-options field. The trusted orchestrator
  rechecks the same execution immediately before and after the one non-retrying redirect, so a
  stale advertised tool or completion race returns `nothing_active` and can never retarget a
  later owner execution or a steered ask. Its fixed descriptions never mirror Hermes
  capabilities. An execution preference is
  retained only when the user explicitly states it; Hermes otherwise chooses its own tools,
  skills, and plan.
- Wave owns the spoken interaction. The user addresses Wave naturally, and Wave selects and
  phrases a Hermes handoff when backend work is needed; successful voice responses do not
  require the user to understand or manage that boundary.
- Wave does not add an extra approval dialog before these narrow tools. The orchestrator dispatches
  only after strict argument validation, trusted call/execution authorization, and rate/concurrency
  checks; Hermes's own tool safety policy still applies.

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
