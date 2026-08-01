# Wave architecture

Wave is a native iOS and Android conversation client for Hermes Agent. The mobile app, the trusted
Wave Companion, and their shared protocol live in this repository and use one npm lockfile, but
they remain separate runtime boundaries.

## Production topology

```text
Wave mobile
  ├─ PanelUI screens and feature controllers
  ├─ WaveBackendClient
  └─ device-scoped companion credential
          │
          │ private HTTPS: versioned Wave REST/SSE
          ▼
Wave Companion
  ├─ device authentication and account access
  ├─ Wave contract validation
  ├─ server-only Hermes adapter
  └─ OpenAI Realtime call registry, setup, and sideband tools
          │                         │
          ▼                         ▼
    Hermes API Server        OpenAI Realtime API
      private HTTP/SSE       call setup + sideband WebSocket

Wave mobile ◀════════ direct WebRTC audio ════════▶ OpenAI Realtime API
```

The companion is the mobile application's only production backend. Standard OpenAI and Hermes API
keys remain server-side. The phone stores only a revocable device credential and its small
connection profile in platform secure storage. The SDP and Wave-owned call state used to establish
a Realtime connection remain transient; neither the OpenAI API key nor OpenAI's call identifier
crosses the Wave API boundary.

Homelab owns deployment manifests, private networks, pinned production images, Nginx/Tailscale
routing, and secrets. This repository owns companion behavior, its container artifact, and the Wave
API contract.

The production artifact is defined by `companion/Dockerfile`. Its multi-stage build installs only
the Companion/contracts workspaces and copies only compiled server-side output plus production
dependencies into a non-root, digest-pinned Node 24 Alpine runtime. npm, corepack, mobile/build
dependencies, and their dependency trees are absent from that runtime. Homelab pins the resulting
source revision and owns the read-only runtime policy, private writable authorization database,
health check, and ingress. The validated deployment keeps Hermes API Server port `8642` and
Companion port `8787` unpublished, then exposes the Wave API only below `/wave/` on the existing
private `svc:hermes` Tailscale HTTPS origin. The LAN Nginx listener has no Wave route.

## Workspace boundaries

| Path                  | Runtime                    | Responsibility                                                                 |
| --------------------- | -------------------------- | ------------------------------------------------------------------------------ |
| `src/`                | Expo / React Native        | Native mobile routes, UI, features, and client-side service adapters           |
| `packages/contracts/` | Runtime-neutral TypeScript | Strict Zod schemas and inferred types for the Wave protocol                    |
| `companion/`          | Node.js 24                 | Fastify API, authentication, Hermes transport, and OpenAI Realtime integration |
| `tools/mobile-agent/` | Development tooling        | Repository-local native automation and observability                           |

The repository root remains both the Expo application and npm workspace root. Do not move it into
an `apps/mobile` directory.

Dependency direction is one-way:

```text
mobile UI/features ──> WaveBackendClient ──> @wave/contracts
Wave Companion ────────────────────────────> @wave/contracts
Wave Companion ──> server-only Hermes/OpenAI adapters
```

The mobile app never imports `@wave/companion`, Fastify, the OpenAI SDK, or Hermes protocol types.
The companion never imports React, React Native, Expo, PanelUI, or other mobile/UI packages.
`@wave/contracts` has only Zod as a runtime dependency and has no Node.js, mobile, server, or UI
dependencies.

Run `npm run verify:boundaries` to check these rules against workspace manifests, source imports,
the companion production dependency tree, and an existing production mobile export.

## Current mobile data boundary

The mobile implementation lives under `src/features/connection`, `src/features/sessions`,
`src/features/chat`, `src/features/realtime`, `src/services/credentials`, `src/services/query`,
`src/services/realtime`, `src/services/sessions`, and `src/services/wave`:

- `WaveBackendClient` is the only mobile production HTTP boundary. It validates request inputs and
  every JSON response with `@wave/contracts`, preserves an intentional companion path prefix,
  rejects credentials/query/fragment components in configured URLs, rejects HTTP outside an
  explicit development exception, refuses redirects, bounds response size, and applies
  cancellation-aware request timeouts. Its streaming path uses Expo SDK 57's native `expo/fetch`,
  validates every SSE event, enforces session/turn identity and sequence order, and bounds connect,
  idle, total, frame, and error-response sizes. Its Realtime start/end methods exchange SDP and
  Wave-owned call state without exposing provider credentials or provider identifiers.
- `SecureWaveCredentialStore` persists one versioned connection record through Expo SecureStore's
  asynchronous APIs with `WHEN_UNLOCKED_THIS_DEVICE_ONLY`. The record contains the normalized
  companion URL, public device metadata, and the revocable device credential. UI and
  development-state summaries omit the credential.
- `WaveConnectionProvider` owns bootstrap, pairing, restore, compatibility verification, retry,
  authenticated self-revocation, and local credential cleanup. Screens do not construct
  authorization headers or raw protocol messages.
- The PanelUI connection route performs the public status check and one-time redemption before
  saving the credential, then requires an authenticated live compatibility check. A saved
  credential is rechecked at launch. Connected disconnect first revokes the current server-side
  device and aborts its active text and Realtime work before deleting the secure record. When the
  Gateway is unreachable, local-only forgetting is a separate explicit recovery action.
- `WaveQueryProvider` owns finite server state for session lists and unified timelines. Connection changes
  cancel and remove the connection-scoped `wave` cache so one companion/device cannot reuse
  another's data.
- `ActiveSessionStore` persists only a versioned, non-secret connection/session identifier pair for
  current-flow coordination. Connected cold launch deliberately creates a new conversation;
  Hermes remains the durable source for every prior conversation shown in the drawer.
- `useWaveChat` and its reducer own the single active stream, 50 ms assistant-delta batching,
  cancellation races, safe error state, and post-stream timeline reconciliation. The reducer keeps
  the composer busy until stream cleanup and reconciliation have settled, so a newly enabled send
  cannot race the prior turn. React screens do not parse SSE or construct protocol messages.
- `ReactNativeRealtimeTransport` owns audio-only microphone acquisition, SDP negotiation, the
  native peer and data channel, remote audio tracks, bounded reconnect timing, and cleanup.
  `WaveRealtimeController` owns the authenticated Companion call, cancellation/expiry, normalized
  activity and transcript state, and retryable server-cleanup failures. The PanelUI voice route
  renders controller snapshots and never owns raw WebRTC resources or provider protocol messages.
- The Expo Router drawer is the connected app shell. Cold launch and **New conversation** create a
  Hermes session immediately; sticky top actions provide new, title search, and read-only scheduled
  jobs; paginated account history fills the middle; Settings and Disconnect stay fixed at the
  bottom. Rename/delete use typed lifecycle mutations, and a deleted current session routes to a
  new conversation.
- The PanelUI chat route renders normalized conversation data only. Tool events become
  bounded `Task` parts with a name, status, and optional raw input/output. Disclosures start
  collapsed and lazily render details as inert `CodeBlock` text; upstream event shapes, call IDs,
  run IDs, and credentials never enter the mobile render model. Wave avatars align with the
  bottom of a grouped turn and only its last item keeps the avatar-facing pointer radius. A
  Realtime Hermes handoff is a nested task between Wave's acknowledgement and final response,
  rather than a second assistant identity or a duplicate canonical Hermes message.
  `PanelUIProvider` mounts the keyboard controller's `KeyboardProvider` exactly once at the app
  root — mounting a second one breaks per-frame keyboard animation on Android — and PanelUI's
  `KeyboardAvoider` docks the rounded `InputGroup` composer above the native keyboard, keeping a
  small gap while the keyboard is open. Opening the attachment sheet dismisses the keyboard first,
  since the styled sheet draws under the keyboard's own window. The attachment control sits inside the
  leading edge. The trailing slot shows exactly one of Stop, Send, or the live-wave action; when
  idle, trimmed text selects Send and empty text selects live voice.
- Camera/Photos become bounded inline JPEG turn parts. Supported text-based Files are read from the
  document-picker cache and become bounded inert text-file parts. The mobile client rejects
  unsupported binary files, and the Companion validates the same strict contract before converting
  it to Hermes text and `image_url` content.

## Current companion API

The companion lives in `companion/` and provides:

- a separately buildable Node.js 24 TypeScript entrypoint;
- Fastify with authorization, metadata-only correlated request logging, and credential/cookie
  redaction;
- strict server-only configuration validation;
- graceful `SIGINT` and `SIGTERM` shutdown;
- a public, non-sensitive `GET /v1/status`;
- one-time operator-generated pairing codes and revocable device credentials;
- account-scoped device authorization;
- live compatibility, paginated session lifecycle, history, attachment-aware streamed-turn,
  cancellation, normalized read-only scheduled-job, content-free diagnostics, Realtime
  voice-catalog, and rate-limited bounded voice-sample routes;
- request-size, rate, active-turn, first-event, idle, and total-time bounds;
- authenticated, rate-limited Realtime call setup and device-owned call termination;
- a process-local Realtime registry that enforces one call per device/session, a bounded global
  maximum, trusted session binding, expiry, and shutdown cleanup;
- the official server-only OpenAI SDK adapter for unified WebRTC setup and lifecycle requests,
  with the documented bearer-authenticated `ws` connection for sideband control;
- strict `ask_hermes` validation, per-call tool serialization, timeout/cancellation, and structured
  results through the existing Hermes adapter; Hermes execution remains background work relative
  to live speech, with at most eight active-or-waiting requests per call and exact normalized
  instructions coalesced onto one Hermes execution;
- sideband response coordination that holds completed Hermes outputs while the user is speaking or
  a default-conversation response is active, then appends the results and creates one safe model
  response;
- normalized versioned error envelopes for unknown routes and internal failures;
- the tested Hermes HTTP/SSE adapter under `companion/src/hermes`.

`GET /v1/status` always reports `pairing: true` and `chat: true`; `realtime` is true only when the
server started with `OPENAI_API_KEY`.
`hermes.configured: true` means the companion accepted Hermes configuration at startup. An
authenticated `GET /v1/compatibility` performs the live capability probe. Authenticated
`GET /v1/diagnostics` is support-oriented and contains only Companion version/uptime, feature
availability, and normalized Hermes compatibility; it excludes credentials, server addresses,
device identifiers, and conversation content.

Start the built companion with server-only environment variables:

```bash
export HERMES_API_URL=https://<private-hermes-api>
read -s HERMES_API_KEY
export HERMES_API_KEY
# Optional: enables Realtime call setup and sideband tools.
read -s OPENAI_API_KEY
export OPENAI_API_KEY
npm run companion:build
npm run companion:start
```

Optional variables:

| Variable                                    | Default                        | Meaning                                               |
| ------------------------------------------- | ------------------------------ | ----------------------------------------------------- |
| `WAVE_HOST`                                 | `127.0.0.1`                    | Listener address                                      |
| `WAVE_PORT`                                 | `8787`                         | Listener port                                         |
| `WAVE_LOG_LEVEL`                            | `info`                         | Fastify/Pino log level                                |
| `WAVE_DATABASE_PATH`                        | `./data/wave-companion.sqlite` | Persistent device authorization database              |
| `WAVE_PAIRING_CODE_TTL_SECONDS`             | `600`                          | One-time pairing-code lifetime                        |
| `WAVE_MAX_ACTIVE_TURNS`                     | `4`                            | Process-wide active turn limit                        |
| `WAVE_MAX_ACTIVE_REALTIME_CALLS`            | `2`                            | Process-wide active Realtime-call limit               |
| `WAVE_HERMES_FIRST_EVENT_TIMEOUT_MS`        | `30000`                        | Time allowed to receive the first Hermes event        |
| `WAVE_HERMES_IDLE_TIMEOUT_MS`               | `60000`                        | Time allowed between Hermes events                    |
| `WAVE_HERMES_TOTAL_TIMEOUT_MS`              | `600000`                       | Maximum total turn duration                           |
| `OPENAI_API_KEY`                            | unset                          | Server-only credential; enables Realtime when present |
| `OPENAI_REALTIME_MODEL`                     | `gpt-realtime-2.1-mini`        | Server-selected cost-efficient Realtime model         |
| `OPENAI_REALTIME_VOICE`                     | `marin`                        | Server-selected Realtime voice                        |
| `WAVE_OPENAI_REALTIME_REQUEST_TIMEOUT_MS`   | `15000`                        | Unified setup and hangup request timeout              |
| `WAVE_REALTIME_SIDEBAND_CONNECT_TIMEOUT_MS` | `10000`                        | Sideband WebSocket connection timeout                 |
| `WAVE_REALTIME_CALL_TTL_MS`                 | `1800000`                      | Maximum process-local call lifetime                   |
| `WAVE_REALTIME_TOOL_TIMEOUT_MS`             | `120000`                       | Maximum duration of one `ask_hermes` dispatch         |
| `HERMES_ALLOW_INSECURE_HTTP`                | `false`                        | Allows an explicit private/local HTTP Hermes URL      |

`HERMES_API_URL` must not contain credentials, a query, or a fragment. HTTP is rejected unless
`HERMES_ALLOW_INSECURE_HTTP=1` is explicitly set for a trusted private/local path. The externally
reachable companion remains private-HTTPS-only in production.

For source-watch development, use `npm run companion:dev`. This still requires valid Hermes
configuration and does not load secrets from mobile `EXPO_PUBLIC_*` variables.

### Device authorization

An operator runs `npm run companion:pair` against the companion's persistent
`WAVE_DATABASE_PATH`. The command emits a random 80-bit code that expires after ten minutes by
default. Redeeming the code exactly once creates a random 256-bit device credential. Only SHA-256
verifiers are stored in SQLite; plaintext credentials are never recoverable from the database.

The storage implementation is behind the `DeviceStore` interface. The current single-process
implementation uses Node.js 24's built-in `node:sqlite`, strict tables, foreign keys, WAL,
synchronous durability, and an atomic transaction for code redemption. A newly created database
directory is owner-only and the database file is mode `0600`. Deployment must mount the database
on persistent private storage and preserve equivalent permissions for the directory and SQLite
sidecar files.

`npm run companion:devices` lists device lifecycle metadata, and
`npm run companion:revoke -- <device-id>` revokes subsequent access. Revocation does not terminate
an already-running request from a separate operator process; the total turn timeout bounds that
window.

A valid device credential represents access to the paired Wave Gateway account. Every active
paired device can page through, read, continue, rename, and delete the same top-level sessions
returned by Hermes; the Companion does not keep per-device session bindings or copies. Hermes
remains authoritative for session existence and history. Revoking the device credential removes
that account access. `DELETE /v1/device` lets an authenticated mobile client revoke only its own
credential; the in-process Companion also cancels that device's admitted text and Realtime work.

### HTTP and stream policy

Public routes are limited to status and one-time pairing redemption. All other routes require an
exact bearer device credential. The server exposes no generic upstream proxy and accepts no
client-selected Hermes model, provider, endpoint, header, run ID, or generic administrative
operation. The one operational surface is an exact read-only scheduled-job status route whose
normalizer omits prompts, outputs, and controls.

Request bodies are limited to 6,000,000 bytes so bounded inline images fit without opening an
upload/filesystem surface. Turn schemas still cap text, attachment count, each image at 4,000,000
decoded bytes, and each text file at 128,000 characters. The process applies a
120-request-per-minute client-IP limit
and a five-attempt-per-minute pairing limit. The in-memory counters are intentionally
single-instance; multi-replica deployment requires a shared limiter and a coordinated storage
decision first.

One device can run one turn at a time, one session can have one active turn, and the process-wide
maximum defaults to four. Wave starts a normalized SSE stream before contacting Hermes, then
enforces first-event, idle, and total timers. An authenticated cancellation request, mobile
disconnect, timeout, upstream error, or downstream consumer exit aborts or cancels the Hermes
stream. Events contain only Wave-owned identifiers, assistant text, and sanitized tool lifecycle
status plus optional bounded tool input/output details. Each detail is capped at 64,000 characters,
all details share a 512,000-character per-history-response or per-turn budget, and truncation is
explicit.

Realtime call creation accepts a bounded SDP offer only after resolving the Hermes session for an
active authenticated device. Wave creates the OpenAI call server-side, attaches the server-only sideband,
and returns only the SDP answer, an expiry, and an opaque Wave call ID. The registry rejects a
second call for the same device or Hermes session and defaults to two calls process-wide. It
reauthorizes the device before every tool dispatch, keeps the server-bound session immutable, never
accepts a model-controlled session ID, serializes `ask_hermes` calls per live call, bounds
active-or-waiting Hermes work to
eight requests, caps each call at 128 total tool requests, and expires all state after 30 minutes
by default. Barge-in stops the Realtime model's audio response without cancelling the active
Hermes request. The Realtime session can submit another tool call before earlier tool output is
available; the Companion accepts it into the same trusted session's bounded queue and executes
Hermes requests one at a time in arrival order. Completed tool outputs remain buffered while the
user is speaking or another default-conversation response is active, preventing competing
`response.create` events. Call state is intentionally process-local. Distinct tool-call IDs
carrying the same normalized instruction share one in-flight or completed result, preventing a
Realtime retry from duplicating Hermes work. A multi-replica deployment requires deliberate
shared-state and routing decisions first.

The Realtime model is the user-facing Wave assistant; Hermes is its server-side execution and
reasoning layer. Users make requests directly to Wave and never need to name Hermes or ask for a
handoff. The session prompt gives explicit selection rules: handle lightweight conversation and
simple computations locally, but automatically call `ask_hermes` for current or external
information, private context, device or service control, durable work, and substantial reasoning.
Wave may rewrite the request into a clearer self-contained Hermes instruction, while preserving its
intent, scope, constraints, identifiers, quoted text, and literal values. It must not broaden the
action, invent details, or report success before a structured result confirms it. Neutral tool
preambles and post-result responses avoid exposing implementation terminology unless progress or an
error makes that context useful.

See [`companion/README.md`](../companion/README.md) for the endpoint table and operator workflow.

## Shared protocol

`@wave/contracts` currently defines:

- the literal Wave API version (`v1`);
- strict response metadata;
- the companion status and feature-availability response;
- authenticated content-free diagnostics and the strict Realtime voice catalog, including an
  opaque samples version and the bounded `audio/wav` voice-sample response limit;
- stable safe error codes and error envelopes;
- one-time pairing requests and responses;
- compatibility, paginated session lifecycle, cursor-paginated unified timeline,
  attachment-aware turn, read-only
  scheduled-job, and cancellation requests and responses;
- a strict discriminated union of ordered normalized turn events;
- strict inert tool-detail fields with explicit truncation;
- bounded SDP call setup/termination contracts that contain only Wave-owned identifiers;
- the strict `ask_hermes({ instruction })` schema and small structured success/error result.

Schemas reject unknown fields unless a future contract explicitly defines forward-compatible
behavior. Both sides validate untrusted boundary data at runtime. Screens should consume normalized
domain types through `WaveBackendClient`; they must not construct HTTP, SSE, Hermes, or OpenAI
protocol messages.

## State and UI direction

- Hermes remains the source of truth for its durable sessions, messages, and tool records. The
  Companion interaction ledger is authoritative only for finalized Wave speech and handoff
  lifecycle records; it stores no raw audio, partial transcripts, or hidden reasoning.
- TanStack Query owns finite server state such as status, paginated account sessions, the
  cursor-paginated unified timeline, read-only scheduled jobs, diagnostics, and the Realtime voice
  catalog. Retryable finite reads retry at most twice with the shared 500 ms exponential-jitter
  policy capped at 8 seconds; mutations never retry automatically.
- Active SSE and Realtime lifecycles belong in focused controllers/reducers, not query cache.
- The connection provider owns only credential bootstrap and compatibility state; it is not a
  general application-state container.
- PanelUI renders Wave-owned conversation types; it does not own transport types or state.
- Timeline normalization drops empty records, groups entries by stable Wave-owned turn IDs, and
  suppresses the canonical Hermes range already represented by a correlated Realtime handoff.
  Direct Hermes work and Realtime handoffs both render under the Wave identity. Tool activity
  renders as collapsed named status rows with the Wave avatar aligned to the last item. Expanding a
  row lazily renders bounded raw input and output as copyable plain code, never Markdown.
- Handoff correlation keeps the terminal Hermes stream event ID and timestamp server-side. Because
  the pinned history response omits message IDs, the merge falls back to the nearest assistant
  timestamp inside a five-second window; it never compares user or assistant text.
- The Companion persists only finalized Realtime user and assistant transcripts. Successful
  hangup refreshes the unified timeline query before returning to text chat, so casual Wave speech
  and completed `ask_hermes` work appear immediately without duplicating Hermes's canonical turn.
- Timeline pagination uses a stable entry cursor rather than an offset. Deleting a Hermes session
  cascades its Companion interaction records; clearing only Hermes history leaves the Wave handoff
  record visible with its bounded result.
- The initial Realtime tool is the strict
  `ask_hermes({ instruction: string })` operation. A model-controlled session ID is forbidden.
- Wave owns the spoken interaction. The user addresses Wave naturally, and Wave selects and
  phrases a Hermes handoff when backend work is needed; successful voice responses do not require
  the user to understand or manage that boundary.
- Wave does not add an extra approval dialog before that narrow tool. The companion dispatches it
  automatically only after strict argument validation, active-device authorization, and trusted
  server-bound session selection;
  Hermes's own tool safety policy still applies.

## Verification

Run the complete workspace checks from the repository root:

```bash
npm run build
npm test
npm run lint
npm run typecheck
npm run verify:boundaries
npx expo install --check
npm run mobile:smoke:production
```

The root `npm run lint` command includes the workspace ESLint checks and Prettier verification.
Use `npm run format` to apply the repository's shared formatting configuration.

Runtime-affecting changes also require the relevant iOS and Android flows. Native dependency or app
configuration changes require clean prebuilds, affected native builds, and Expo Doctor as described
in `AGENTS.md`.
