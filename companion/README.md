# Wave Companion

The Wave Companion is the trusted server-side boundary between Wave mobile, Hermes, and OpenAI
Realtime. It exposes only Wave-owned conversation endpoints, holds the Hermes key and, when
Realtime is enabled, the standard OpenAI key, and never returns raw upstream events, provider call
identifiers, run identifiers, authorization headers, or stack traces to a client. Session history
and turn events may include explicit raw tool input/output fields for the paired user, but the
Companion bounds each field to 64,000 characters, applies a 512,000-character aggregate budget,
and never forwards the upstream tool-call identifier.

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

Text chat does not require OpenAI configuration. To enable the Realtime routes for a local server,
set the OpenAI key only in the Companion process:

```bash
read -s OPENAI_API_KEY
export OPENAI_API_KEY
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

## Container artifact

Build the production image from the repository root:

```bash
docker build \
  --file companion/Dockerfile \
  --build-arg WAVE_COMPANION_REVISION="$(git rev-parse HEAD)" \
  --tag wave-companion:local \
  .
```

The multi-stage build uses the digest-pinned official Node.js 24 slim image and installs only the
Companion/contracts workspaces. The runtime stage runs as a non-root user and contains compiled
server, admin, and Hermes integration entrypoints plus production dependencies. It does not contain
the Expo app, mobile dependencies, development dependencies, repository history, or local
credentials.

Deployment must mount a private writable directory for `WAVE_DATABASE_PATH` and may keep the
container root filesystem read-only. Generate pairing codes and manage devices inside a deployed
container with:

```bash
node companion/dist/admin.js pair
node companion/dist/admin.js devices
node companion/dist/admin.js revoke <device-id>
```

## Pair and revoke devices

Generate a cryptographically random one-time pairing code:

```bash
npm run companion:pair
```

The default expiry is ten minutes. The code can be redeemed exactly once by
`POST /v1/pairings/redeem`; a successful response is the only time the random device credential is
returned in plaintext. In the mobile app, enter the reachable companion URL, a recognizable device
name, and this code on the **Connect Wave** screen. Production mobile builds require an HTTPS
companion URL; local development builds allow an explicit trusted HTTP URL.

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

### Development-only mobile fixture

When a live private Hermes API is not available, run a local in-memory companion fixture to verify
mobile pairing, text streaming, cancellation wiring, and history restoration without inventing
production credentials:

```bash
npm run companion:mobile-fixture
```

It prints one short-lived pairing code, uses deterministic fake Hermes capability/session
responses, provides a cancellation-only test prompt, streams assistant deltas around a sanitized
tool lifecycle with deterministic expandable input/output details, and stores normalized history
only in process memory. It loses every device/session when stopped. It binds to
`127.0.0.1:8787` by default. To reach it from an Android emulator, bind the fixture to the host
network and enter `http://10.0.2.2:8787` in a development build:

```bash
WAVE_FIXTURE_HOST=0.0.0.0 npm run companion:mobile-fixture
```

`WAVE_FIXTURE_PORT` can select another local port. This fixture is not a deployment entrypoint,
must never be exposed outside a trusted development machine, and does not replace validation
against the pinned Hermes deployment.

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
| `POST /v1/sessions/:sessionId/realtime/calls` | Device and session | Exchange a bounded SDP offer for transient Wave call state |
| `POST /v1/realtime/calls/:callId/end` | Device and call owner | End and discard a Wave Realtime call |

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

### Realtime call and tool policy

`features.realtime` is true only when `OPENAI_API_KEY` was available at startup. Without it, text
chat continues normally and Realtime call creation returns a safe unavailable response.

The mobile client sends a strict SDP offer for an already-authorized Hermes session. The Companion
uses the official OpenAI JavaScript SDK to perform unified WebRTC call setup, attaches its
server-only sideband WebSocket, and returns only the SDP answer, expiry, and an opaque Wave-owned
call ID. OpenAI's API key and call ID never cross the Wave API boundary.

One device and one Hermes session can each participate in only one active Realtime call, and the
process-wide default is two. A call expires after 30 minutes by default, and explicit termination
is restricted to the device that created it. The process registry is intentionally single-instance;
do not add replicas without sticky ownership or coordinated call state.

The Realtime session exposes exactly one function:
`ask_hermes({ instruction: string })`. Its JSON Schema is generated from the same strict runtime
schema used at dispatch. The Companion ignores model-selected session identifiers, rechecks device
and trusted session authorization before every invocation, executes one Hermes request at a time
for the bound session, allows at most eight active-or-waiting requests per call, caps a call at 128
total tool requests, and returns only bounded structured success/error results. Additional requests
wait in order instead of cancelling the active Hermes run. Exact normalized instructions are
executed at most once during a live call: distinct Realtime tool-call IDs share the same in-flight
or completed Hermes result so a model retry cannot duplicate Hermes work.

Hermes work remains in the background relative to the voice conversation. Realtime barge-in stops
assistant playback but does not cancel Hermes. If Hermes finishes while the user is speaking or a
default-conversation response is active, the sideband holds the structured result until it can add
the function output and safely create one follow-up response. Wave does not add a separate approval
prompt; Hermes's own tool safety policy remains authoritative.

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `HERMES_API_URL` | Required | Server-only Hermes API Server base URL |
| `HERMES_API_KEY` | Required | Server-only Hermes bearer credential |
| `OPENAI_API_KEY` | unset | Server-only OpenAI credential; enables Realtime when present |
| `OPENAI_REALTIME_MODEL` | `gpt-realtime-2.1-mini` | Server-selected cost-efficient Realtime model |
| `OPENAI_REALTIME_VOICE` | `marin` | Server-selected Realtime voice |
| `HERMES_ALLOW_INSECURE_HTTP` | `false` | Allow explicit private/local HTTP upstream traffic |
| `WAVE_DATABASE_PATH` | `./data/wave-companion.sqlite` | Persistent device and session authorization database |
| `WAVE_HOST` | `127.0.0.1` | Listener address |
| `WAVE_PORT` | `8787` | Listener port |
| `WAVE_LOG_LEVEL` | `info` | Fastify/Pino log level |
| `WAVE_PAIRING_CODE_TTL_SECONDS` | `600` | Pairing expiry, from 60 through 3600 seconds |
| `WAVE_MAX_ACTIVE_TURNS` | `4` | Process-wide active-turn maximum, from 1 through 32 |
| `WAVE_MAX_ACTIVE_REALTIME_CALLS` | `2` | Process-wide active-call maximum, from 1 through 16 |
| `WAVE_HERMES_FIRST_EVENT_TIMEOUT_MS` | `30000` | Time to the first upstream event |
| `WAVE_HERMES_IDLE_TIMEOUT_MS` | `60000` | Maximum gap between upstream events |
| `WAVE_HERMES_TOTAL_TIMEOUT_MS` | `600000` | Maximum total turn duration |
| `WAVE_OPENAI_REALTIME_REQUEST_TIMEOUT_MS` | `15000` | OpenAI setup/hangup request timeout |
| `WAVE_REALTIME_SIDEBAND_CONNECT_TIMEOUT_MS` | `10000` | Sideband connection timeout |
| `WAVE_REALTIME_CALL_TTL_MS` | `1800000` | Maximum call lifetime, from 1 minute through 2 hours |
| `WAVE_REALTIME_TOOL_TIMEOUT_MS` | `120000` | Per-tool timeout, from 10 seconds through 10 minutes |

The Hermes total timeout must exceed both event timeouts, and the Realtime call lifetime must
exceed its tool timeout. Request bodies are limited to 64 KiB. The process applies a
120-request-per-minute client-IP limit, a five-attempt-per-minute pairing limit, and a
five-attempt-per-minute Realtime setup limit. These counters are process-local; run one companion
replica until shared limiters, coordinated authorization/call state, and call routing are
deliberately introduced.

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
