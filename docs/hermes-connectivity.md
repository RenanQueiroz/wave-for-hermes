# Hermes connectivity

The Wave Companion talks to Hermes through the Hermes API Server. The mobile application talks only
to the companion over private HTTPS; it does not receive the Hermes bearer key or use the
dashboard's PTY or WebSocket protocol.

## Current server adapter

The Hermes adapter is server-only under `companion/src/hermes` and currently provides:

- bearer-authenticated capability probing;
- session creation and listing;
- normalized session history;
- streamed session chat;
- typed assistant, tool-lifecycle, completion, and error events;
- `AbortController` cancellation;
- normalized configuration, authentication, network, timeout, server, and protocol errors;
- redaction that prevents bearer keys and raw tool arguments from entering events or errors.

It uses Node.js 24's standard `fetch`, `ReadableStream`, `AbortController`, and encoding APIs with no
Expo or React Native imports. Its implementation, fixture, unit tests, and integration probe all
live in the companion workspace. Do not import `HermesClient` into mobile features. The mobile
application will instead use `WaveBackendClient` and Wave-owned normalized contracts from
`packages/contracts`.

The companion exposes a non-sensitive `GET /v1/status` plus authenticated Wave-owned compatibility,
session, history, streamed-turn, cancellation, and Realtime call routes. The authenticated
`GET /v1/compatibility` route performs a live Hermes capability probe. Mobile does not call Hermes
routes directly: its contract-validating `WaveBackendClient` calls only the normalized Wave API,
and pairing/bootstrap require the live compatibility probe before showing the connected route.

## Minimum server contract

The current fixture and parsers were checked against the exact Hermes image pinned by the
development Homelab and revalidated against its live API Server on 2026-07-30:

```text
nousresearch/hermes-agent:v2026.7.20
revision 3ef6bbd201263d354fd83ec55b3c306ded2eb72a
```

Wave requires these `/v1/capabilities` feature flags:

```text
run_stop
session_chat
session_chat_streaming
session_resources
tool_progress_events
```

It also requires these advertised endpoints:

```text
run_stop
session_chat_stream
session_create
session_messages
sessions
```

The sanitized fixture is
`companion/src/hermes/__fixtures__/capabilities-v2026.7.20.json`. Its complete shape and required
values match the live response; only the deployment-specific `model` value is normalized to
`hermes-agent` so a local provider choice does not enter the repository. Revalidate it whenever
the pinned Hermes image changes.

## Streaming and cancellation

`POST /api/sessions/{session_id}/chat/stream` emits named SSE frames. Wave accepts the pinned
server's `run.started`, `message.started`, assistant, tool, completion, error, and `done` events and
rejects malformed or unknown frames as protocol errors. Raw tool arguments, transcript arrays, and
usage payloads are deliberately not copied into UI-facing events.

For the pinned release, the `run_id` emitted by the session streaming handler is local to that
stream. It is not registered with `POST /v1/runs/{run_id}/stop`. Cancelling a session-chat stream
therefore aborts its fetch; the server observes the closed connection and cancels the associated
task. Ending Wave's downstream stream early also cancels the upstream response reader.
`HermesClient.stopRun` is reserved for runs created through `/v1/runs`.

## Realtime `ask_hermes` dispatch

The Companion's Realtime registry reuses this same Hermes streaming adapter. A newly created
Realtime call is bound to the authenticated device and the Hermes session from the Wave route; the
model cannot provide or replace that session ID.

When OpenAI requests `ask_hermes`, the Companion:

1. accepts only the strict bounded `{ instruction }` schema;
2. rechecks that the device is active and still authorized for the call's trusted session;
3. permits only one active Hermes tool request for that call;
4. streams the instruction through `HermesClient.streamChat`;
5. returns only a bounded structured answer or safe error through the original Realtime tool call;
6. aborts the Hermes stream when the tool times out or its Realtime call ends.

Unknown tools, malformed JSON, unknown fields, model-selected session identifiers, duplicate tool
IDs, and unauthorized calls never reach Hermes. Wave does not add another confirmation dialog for
this narrow tool; Hermes's own tool safety behavior remains authoritative.

## Private production deployment

The Homelab deployment now runs the pinned Hermes API Server and the production Companion with
these boundaries:

1. Hermes API Server listens on port `8642` only inside the private Compose network and requires a
   generated bearer key.
2. Wave Companion listens on port `8787` only inside that network and is the sole service given
   the Hermes key.
3. Neither service publishes a host or LAN port.
4. Nginx exposes the Companion only at `/wave/` on the host-loopback listener used by the existing
   private `svc:hermes` Tailscale HTTPS Service.
5. The plain-HTTP LAN listener has no Wave route.
6. Nginx strips the `/wave/` prefix, disables response/request buffering, uses bounded long
   streaming timeouts, and writes Wave requests through a pathless log format.
7. The Companion runs as a non-root user with a read-only root filesystem, all capabilities
   dropped, and one dedicated private authorization-state mount.
8. CORS remains disabled because Wave supports native iOS and Android only.

The generated Hermes key stays in Homelab's ignored mode-`0600` `.env` and the two server
environments. A mobile device receives only a separately revocable Wave credential after
one-time pairing.

The currently recorded Homelab validation covers pairing, authorization, text streaming,
persisted history, and cancellation. OpenAI Realtime must be enabled with a server-only
`OPENAI_API_KEY` and validated separately before the deployment can advertise the live voice
feature.

Container-to-container traffic uses the explicit private-network exception
`http://hermes:8642`; the mobile Wave API remains private HTTPS at:

```text
https://hermes.<tailnet>.ts.net/wave
```

## Validation

Run deterministic contract and companion tests:

```bash
npm test
```

To run only the relocated Hermes adapter tests:

```bash
npm run test:hermes
```

The Homelab repository owns production deployment validation. From that repository run:

```bash
./scripts/validate-wave-companion.sh
./scripts/validate-wave-companion.sh --live
```

The base check validates container isolation, the Tailscale-only Wave route, device-auth rejection,
the existing password-gated dashboard and WebSocket boundary, and the live Hermes capability
contract. `--live` additionally creates and revokes a temporary Wave device, exercises pairing and
authenticated compatibility through Nginx, creates a Hermes session, completes and reloads a
streamed turn, and cancels a second active stream. It prints only the resulting session ID and
supported operations, never the key, device credential, or response content.

The baseline validators do not create a billable OpenAI Realtime call. Run the separate,
deliberately opt-in integration probe when changing Realtime call setup, sideband control, or the
Hermes tool bridge:

```bash
./scripts/probe-wave-realtime.sh
```

The probe uses a temporary device and Hermes session to validate OpenAI's unified SDP exchange,
authenticated sideband control, WebRTC connectivity, strict `ask_hermes` dispatch, the answer
persisted by Hermes, the final Realtime response, explicit hangup, and cleanup. It prints only a
success or safe error summary and never prints credentials, SDP, call identifiers, or conversation
content. The live Homelab path passed this probe on 2026-07-30.

For a separate development server, `npm run test:hermes:integration` remains available with
server-only `HERMES_API_URL`, `HERMES_API_KEY`, and, for a trusted private HTTP endpoint,
`HERMES_ALLOW_INSECURE_HTTP=1`. These variables must never use the `EXPO_PUBLIC_*` prefix or enter
mobile storage.
