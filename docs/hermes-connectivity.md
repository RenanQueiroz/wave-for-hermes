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
session, history, streamed-turn, and cancellation routes. The authenticated
`GET /v1/compatibility` route performs a live Hermes capability probe. The mobile application still
does not call these routes directly; Phase 4 will add the contract-validating `WaveBackendClient`
and platform-backed credential storage.

## Minimum server contract

The current fixture and parsers were checked against the exact Hermes image pinned by the
development Homelab:

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

The source-derived fixture is
`companion/src/hermes/__fixtures__/capabilities-v2026.7.20.json`. Replace it with a sanitized live
response after the private endpoint is enabled and verify that the meaningful contract has not
drifted.

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

## Private deployment prerequisite

The audited Homelab deployment currently runs only the authenticated dashboard on port `9119`.
`API_SERVER_*` is absent and port `8642` is not listening, so live Wave integration remains pending
a separate, deliberate Homelab change.

That deployment should:

1. enable the API server with a strong unique `API_SERVER_KEY`;
2. bind port `8642` to the container's private Compose network, never directly to the LAN;
3. place the Wave Companion on the same explicit private network;
4. let only the companion call the API Server in production;
5. expose the companion through the existing private Nginx/Tailscale HTTPS edge without publishing
   a direct host or LAN port;
6. disable proxy response buffering and retain long streaming timeouts for the companion's Wave
   event stream;
7. preserve Hermes bearer authentication and existing dashboard authentication;
8. avoid CORS configuration because Wave supports native iOS and Android only.

Container-to-container Hermes traffic may use an explicit private-network HTTP exception such as
`http://hermes:8642`; the companion's externally reachable Wave API still requires private HTTPS.
An optional development-only Hermes edge may be used by the integration probe, but it is not the
mobile production API and must not weaken dashboard or API authentication.

## Validation

Run deterministic contract and companion tests:

```bash
npm test
```

To run only the relocated Hermes adapter tests:

```bash
npm run test:hermes
```

After a development endpoint exists, put the key into the shell without committing it or placing
it in a command argument, then run the server-side integration probe:

```bash
read -s HERMES_API_KEY
export HERMES_API_KEY
export HERMES_API_URL=https://<private-hermes-service>/wave
npm run test:hermes:integration
unset HERMES_API_KEY HERMES_API_URL
```

The probe validates capabilities, creates a session unless `HERMES_INTEGRATION_SESSION_ID` is
provided, and completes one streamed turn. It prints only the resulting session ID, never the key
or response content. These variables belong only to the local integration process or deployed
companion; they must never use the `EXPO_PUBLIC_*` prefix or enter mobile storage.
