# Wave Companion

The Wave Companion is the trusted server-side boundary between Wave mobile and Hermes. It exposes
only Wave-owned conversation endpoints, holds the Hermes API key, and never returns raw Hermes
events, run identifiers, tool arguments, authorization headers, or stack traces to a client.

## Run locally

Use Node.js 24 and the repository's root install:

```bash
nvm use
npm install
export HERMES_API_URL=https://<private-hermes-api>
read -s HERMES_API_KEY
export HERMES_API_KEY
npm run companion:build
npm run companion:start
```

The default listener is `127.0.0.1:8787` and the default database is
`companion/data/wave-companion.sqlite` when the process starts from this workspace. In deployment,
set `WAVE_DATABASE_PATH` to a persistent private volume and use the same value for the server and
operator commands.

The companion creates a new database directory with owner-only permissions and sets the database
file to mode `0600`. An operator must apply equivalent permissions when pointing at an existing
directory. Treat the database and its SQLite sidecar files as sensitive authorization state even
though device credentials and pairing codes are stored only as SHA-256 verifiers.

## Pair and revoke devices

Generate a cryptographically random one-time pairing code:

```bash
npm run companion:pair
```

The default expiry is ten minutes. The code can be redeemed exactly once by
`POST /v1/pairings/redeem`; a successful response is the only time the random device credential is
returned in plaintext.

List device IDs and lifecycle metadata:

```bash
npm run companion:devices
```

Revoke one device:

```bash
npm run companion:revoke -- <device-id>
```

Revocation rejects subsequent authenticated requests and leaves other devices intact. It does not
interrupt a turn already streaming in another process; the configured total turn timeout bounds
that window. Stop the companion process as well if immediate termination of all in-flight work is
required.

The operator commands need only `WAVE_DATABASE_PATH` and
`WAVE_PAIRING_CODE_TTL_SECONDS`; they do not load or print Hermes credentials.

## Wave API

All request and response bodies are validated with the strict runtime schemas in
`@wave/contracts`. Except for status and pairing redemption, routes require:

```text
Authorization: Bearer <device-credential>
```

| Method and path | Authentication | Purpose |
| --- | --- | --- |
| `GET /v1/status` | Public | Non-sensitive service and feature status |
| `POST /v1/pairings/redeem` | One-time code | Create a named device and return its credential once |
| `GET /v1/compatibility` | Device | Probe the live Hermes capability contract |
| `GET /v1/sessions` | Device | List only Hermes sessions already bound to this device |
| `POST /v1/sessions/import` | Device | Bind up to 200 existing Hermes sessions to this device |
| `POST /v1/sessions` | Device | Create and bind a Hermes session |
| `GET /v1/sessions/:sessionId/messages` | Device and session | Read normalized history |
| `POST /v1/sessions/:sessionId/turns` | Device and session | Stream normalized Wave SSE events |
| `POST /v1/sessions/:sessionId/turns/:turnId/cancel` | Device and session | Cancel that device's active turn |

The client cannot select a Hermes model, provider, endpoint, header, run ID, or arbitrary
operation. Unknown fields fail validation. Session lookup deliberately returns `404` for both
missing and unauthorized sessions.

Turn streams use `text/event-stream` with ordered, versioned Wave events:

```text
turn.started
assistant.started
assistant.delta
tool.status
assistant.completed
turn.completed
turn.error
```

The companion permits one active turn per device and one per Hermes session, with a bounded global
maximum. Cancellation, client disconnect, first-event timeout, idle timeout, and total timeout all
abort the upstream Hermes request.

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `HERMES_API_URL` | Required | Server-only Hermes API Server base URL |
| `HERMES_API_KEY` | Required | Server-only Hermes bearer credential |
| `HERMES_ALLOW_INSECURE_HTTP` | `false` | Allow explicit private/local HTTP upstream traffic |
| `WAVE_DATABASE_PATH` | `./data/wave-companion.sqlite` | Persistent device and session authorization database |
| `WAVE_HOST` | `127.0.0.1` | Listener address |
| `WAVE_PORT` | `8787` | Listener port |
| `WAVE_LOG_LEVEL` | `info` | Fastify/Pino log level |
| `WAVE_PAIRING_CODE_TTL_SECONDS` | `600` | Pairing expiry, from 60 through 3600 seconds |
| `WAVE_MAX_ACTIVE_TURNS` | `4` | Process-wide active-turn maximum, from 1 through 32 |
| `WAVE_HERMES_FIRST_EVENT_TIMEOUT_MS` | `30000` | Time to the first upstream event |
| `WAVE_HERMES_IDLE_TIMEOUT_MS` | `60000` | Maximum gap between upstream events |
| `WAVE_HERMES_TOTAL_TIMEOUT_MS` | `600000` | Maximum total turn duration |

The total timeout must exceed both event timeouts. Request bodies are limited to 64 KiB. The
process applies a 120-request-per-minute client-IP limit and a stricter five-attempt-per-minute
pairing limit. These counters are process-local; run one companion replica until a shared limiter
and coordinated authorization store are deliberately introduced.

## Verification

From the repository root:

```bash
npm run build
npm test
npm run lint
npm run typecheck
npm run verify:boundaries
```

The opt-in real Hermes probe is documented in
[`docs/hermes-connectivity.md`](../docs/hermes-connectivity.md). It requires server-side Hermes
environment variables and must never use an `EXPO_PUBLIC_*` variable.
