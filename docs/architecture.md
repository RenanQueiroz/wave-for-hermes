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
  ├─ device authentication and authorization
  ├─ Wave contract validation
  ├─ server-only Hermes adapter
  └─ future OpenAI Realtime setup and sideband tools
          │                         │
          ▼                         ▼
    Hermes API Server        OpenAI Realtime API
      private HTTP/SSE       call setup + sideband WebSocket

Wave mobile ◀════════ direct WebRTC audio ════════▶ OpenAI Realtime API
```

The companion is the mobile application's only production backend. Standard OpenAI and Hermes API
keys remain server-side. The phone stores only a revocable device credential and its small
connection profile in platform secure storage; future Realtime connection material will remain
transient.

Homelab owns deployment manifests, private networks, pinned production images, Nginx/Tailscale
routing, and secrets. This repository owns companion behavior, its container artifact, and the Wave
API contract.

The production artifact is defined by `companion/Dockerfile`. Its multi-stage build installs only
the Companion/contracts workspaces and copies only compiled server-side output plus production
dependencies into the non-root runtime stage. Homelab pins the resulting source revision and owns
the read-only runtime policy, private writable authorization database, health check, and ingress.

## Workspace boundaries

| Path | Runtime | Responsibility |
| --- | --- | --- |
| `src/` | Expo / React Native | Native mobile routes, UI, features, and client-side service adapters |
| `packages/contracts/` | Runtime-neutral TypeScript | Strict Zod schemas and inferred types for the Wave protocol |
| `companion/` | Node.js 24 | Fastify API, authentication, Hermes transport, and future OpenAI Realtime integration |
| `tools/mobile-agent/` | Development tooling | Repository-local native automation and observability |

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
`src/features/chat`, `src/services/credentials`, `src/services/query`, `src/services/sessions`, and
`src/services/wave`:

- `WaveBackendClient` is the only mobile production HTTP boundary. It validates request inputs and
  every JSON response with `@wave/contracts`, preserves an intentional companion path prefix,
  rejects credentials/query/fragment components in configured URLs, rejects HTTP outside an
  explicit development exception, refuses redirects, bounds response size, and applies
  cancellation-aware request timeouts. Its streaming path uses Expo SDK 57's native `expo/fetch`,
  validates every SSE event, enforces session/turn identity and sequence order, and bounds connect,
  idle, total, frame, and error-response sizes.
- `SecureWaveCredentialStore` persists one versioned connection record through Expo SecureStore's
  asynchronous APIs with `WHEN_UNLOCKED_THIS_DEVICE_ONLY`. The record contains the normalized
  companion URL, public device metadata, and the revocable device credential. UI and
  development-state summaries omit the credential.
- `WaveConnectionProvider` owns bootstrap, pairing, restore, compatibility verification, retry, and
  local disconnect state. Screens do not construct authorization headers or raw protocol
  messages.
- The PanelUI connection route performs the public status check and one-time redemption before
  saving the credential, then requires an authenticated live compatibility check. A saved
  credential is rechecked at launch. Local disconnect deletes the secure record but deliberately
  does not revoke the server-side device.
- `WaveQueryProvider` owns finite server state for session lists and histories. Connection changes
  cancel and remove the connection-scoped `wave` cache so one companion/device cannot reuse
  another's data.
- `ActiveSessionStore` persists only a versioned, non-secret connection/session identifier pair.
  Hermes remains the durable message source and the sessions screen resumes only an authorized ID
  returned by the current companion.
- `useWaveChat` and its reducer own the single active stream, 50 ms assistant-delta batching,
  cancellation races, safe error state, and post-stream history reconciliation. The reducer keeps
  the composer busy until stream cleanup and reconciliation have settled, so a newly enabled send
  cannot race the prior turn. React screens do not parse SSE or construct protocol messages.
- The PanelUI session and chat routes render normalized conversation data only. Tool events become
  name/status-only `Task` parts; raw arguments, output, upstream events, and credentials never enter
  the mobile render model. `KeyboardProvider` is mounted once at the app root, and PanelUI's
  `KeyboardAvoider` docks the complete composer row so its Input and Send/Stop controls move
  together above the native keyboard.

## Current companion API

The companion lives in `companion/` and provides:

- a separately buildable Node.js 24 TypeScript entrypoint;
- Fastify with authorization and credential/cookie log redaction;
- strict server-only configuration validation;
- graceful `SIGINT` and `SIGTERM` shutdown;
- a public, non-sensitive `GET /v1/status`;
- one-time operator-generated pairing codes and revocable device credentials;
- device-scoped session authorization;
- live compatibility, session, history, streamed-turn, and cancellation routes;
- request-size, rate, active-turn, first-event, idle, and total-time bounds;
- normalized versioned error envelopes for unknown routes and internal failures;
- the tested Hermes HTTP/SSE adapter under `companion/src/hermes`.

`GET /v1/status` reports `pairing: true`, `chat: true`, and `realtime: false`.
`hermes.configured: true` means the companion accepted Hermes configuration at startup. An
authenticated `GET /v1/compatibility` performs the live capability probe.

Start the built companion with server-only environment variables:

```bash
export HERMES_API_URL=https://<private-hermes-api>
read -s HERMES_API_KEY
export HERMES_API_KEY
npm run companion:build
npm run companion:start
```

Optional variables:

| Variable | Default | Meaning |
| --- | --- | --- |
| `WAVE_HOST` | `127.0.0.1` | Listener address |
| `WAVE_PORT` | `8787` | Listener port |
| `WAVE_LOG_LEVEL` | `info` | Fastify/Pino log level |
| `WAVE_DATABASE_PATH` | `./data/wave-companion.sqlite` | Persistent device and session authorization database |
| `WAVE_PAIRING_CODE_TTL_SECONDS` | `600` | One-time pairing-code lifetime |
| `WAVE_MAX_ACTIVE_TURNS` | `4` | Process-wide active turn limit |
| `WAVE_HERMES_FIRST_EVENT_TIMEOUT_MS` | `30000` | Time allowed to receive the first Hermes event |
| `WAVE_HERMES_IDLE_TIMEOUT_MS` | `60000` | Time allowed between Hermes events |
| `WAVE_HERMES_TOTAL_TIMEOUT_MS` | `600000` | Maximum total turn duration |
| `HERMES_ALLOW_INSECURE_HTTP` | `false` | Allows an explicit private/local HTTP Hermes URL |

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

Each device can access only sessions explicitly bound to it. Creating a session binds it
automatically. `POST /v1/sessions/import` is an explicit bootstrap operation that binds the first
200 existing Hermes sessions to that device. Unauthorized session access returns the same `404`
shape as a missing session.

### HTTP and stream policy

Public routes are limited to status and one-time pairing redemption. All other routes require an
exact bearer device credential. The server exposes no generic upstream proxy and accepts no
client-selected Hermes model, provider, endpoint, header, run ID, or administrative operation.

Request bodies are limited to 64 KiB. The process applies a 120-request-per-minute client-IP limit
and a five-attempt-per-minute pairing limit. The in-memory counters are intentionally
single-instance; multi-replica deployment requires a shared limiter and a coordinated storage
decision first.

One device can run one turn at a time, one session can have one active turn, and the process-wide
maximum defaults to four. Wave starts a normalized SSE stream before contacting Hermes, then
enforces first-event, idle, and total timers. An authenticated cancellation request, mobile
disconnect, timeout, upstream error, or downstream consumer exit aborts or cancels the Hermes
stream. Events contain only Wave-owned identifiers, assistant text, and sanitized tool lifecycle
status.

See [`companion/README.md`](../companion/README.md) for the endpoint table and operator workflow.

## Shared protocol

`@wave/contracts` currently defines:

- the literal Wave API version (`v1`);
- strict response metadata;
- the companion status and feature-availability response;
- stable safe error codes and error envelopes;
- one-time pairing requests and responses;
- compatibility, session, history, turn, and cancellation requests and responses;
- a strict discriminated union of ordered normalized turn events.

Schemas reject unknown fields unless a future contract explicitly defines forward-compatible
behavior. Both sides validate untrusted boundary data at runtime. Screens should consume normalized
domain types through `WaveBackendClient`; they must not construct HTTP, SSE, Hermes, or OpenAI
protocol messages.

Realtime call setup and `ask_hermes` tool schemas remain future additions. They will be added
alongside their companion handlers and contract tests rather than inferred in mobile code.

## State and UI direction

- Hermes remains the source of truth for durable sessions and history.
- TanStack Query is planned only for finite server state such as status, sessions, and history.
- Active SSE and Realtime lifecycles belong in focused controllers/reducers, not query cache.
- The connection provider owns only credential bootstrap and compatibility state; it is not a
  general application-state container.
- PanelUI renders Wave-owned conversation types; it does not own transport types or state.
- Realtime voice remains an ephemeral overlay on an active Hermes session until post-call history
  behavior is deliberately decided.
- The initial Realtime tool will be the strict
  `ask_hermes({ instruction: string })` operation. A model-controlled session ID is forbidden.
- Wave does not add an extra approval dialog before that narrow tool. The companion dispatches it
  automatically only after strict argument validation and trusted device/session authorization;
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

Runtime-affecting changes also require the relevant iOS and Android flows. Native dependency or app
configuration changes require clean prebuilds, affected native builds, and Expo Doctor as described
in `AGENTS.md`.
