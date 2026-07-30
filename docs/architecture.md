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
keys remain server-side. The phone will store only a revocable device credential and transient
Realtime connection material.

Homelab owns deployment manifests, private networks, pinned production images, Nginx/Tailscale
routing, and secrets. This repository owns companion behavior, its container artifact when one is
introduced, and the Wave API contract.

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

## Current companion foundation

The initial companion lives in `companion/` and provides:

- a separately buildable Node.js 24 TypeScript entrypoint;
- Fastify with authorization and cookie log redaction;
- strict server-only configuration validation;
- graceful `SIGINT` and `SIGTERM` shutdown;
- `GET /v1/status`, validated against the shared Wave status schema;
- normalized versioned error envelopes for unknown routes and internal failures;
- the tested Hermes HTTP/SSE adapter under `companion/src/hermes`.

`GET /v1/status` is currently a non-sensitive foundation endpoint. Its feature flags are all
`false` because pairing, chat, and Realtime routes are not implemented. `hermes.configured: true`
means the companion accepted Hermes configuration at startup; it is not yet a live capability
probe.

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
| `HERMES_ALLOW_INSECURE_HTTP` | `false` | Allows an explicit private/local HTTP Hermes URL |

`HERMES_API_URL` must not contain credentials, a query, or a fragment. HTTP is rejected unless
`HERMES_ALLOW_INSECURE_HTTP=1` is explicitly set for a trusted private/local path. The externally
reachable companion remains private-HTTPS-only in production.

For source-watch development, use `npm run companion:dev`. This still requires valid Hermes
configuration and does not load secrets from mobile `EXPO_PUBLIC_*` variables.

## Shared protocol

`@wave/contracts` currently defines:

- the literal Wave API version (`v1`);
- strict response metadata;
- the companion status and feature-availability response;
- stable safe error codes and error envelopes;
- base metadata for ordered versioned event streams.

Schemas reject unknown fields unless a future contract explicitly defines forward-compatible
behavior. Both sides validate untrusted boundary data at runtime. Screens should consume normalized
domain types through `WaveBackendClient`; they must not construct HTTP, SSE, Hermes, or OpenAI
protocol messages.

The current contracts are the foundation, not the finished chat protocol. Pairing, session,
history, streamed conversation, cancellation, and Realtime tool schemas will be added alongside
their companion handlers and contract tests.

## State and UI direction

- Hermes remains the source of truth for durable sessions and history.
- TanStack Query is planned only for finite server state such as status, sessions, and history.
- Active SSE and Realtime lifecycles belong in focused controllers/reducers, not query cache.
- PanelUI renders Wave-owned conversation types; it does not own transport types or state.
- Realtime voice remains an ephemeral overlay on an active Hermes session until post-call history
  behavior is deliberately decided.
- The initial Realtime tool will be the strict
  `ask_hermes({ instruction: string })` operation. A model-controlled session ID is forbidden.

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
