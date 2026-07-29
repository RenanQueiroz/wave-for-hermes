# Hermes connectivity

Wave talks to Hermes through the Hermes API Server over private HTTPS. It does not use the
dashboard's PTY or WebSocket protocol.

## Current client boundary

The transport lives under `src/services/hermes` and currently provides:

- bearer-authenticated capability probing;
- session creation and listing;
- normalized session history;
- streamed session chat;
- typed assistant, tool-lifecycle, completion, and error events;
- `AbortController` cancellation;
- normalized configuration, authentication, network, timeout, server, and protocol errors;
- redaction that prevents bearer keys and raw tool arguments from entering events or errors.

Screens should depend on the `HermesClient` interface and normalized event types. They should not
construct Hermes URLs, authorization headers, request bodies, or SSE frames.

Expo SDK 57 installs `expo/fetch` as the global `fetch` implementation on iOS and Android. Its
documented `ReadableStream` support is sufficient for incremental SSE, so Wave does not carry a
second event-source dependency.

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
`src/services/hermes/__fixtures__/capabilities-v2026.7.20.json`. Replace it with a sanitized live
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
task. `HermesClient.stopRun` is reserved for runs created through `/v1/runs`.

## Private deployment prerequisite

The audited Homelab deployment currently runs only the authenticated dashboard on port `9119`.
`API_SERVER_*` is absent and port `8642` is not listening, so live Wave integration remains pending
a separate, deliberate Homelab change.

That deployment should:

1. enable the API server with a strong unique `API_SERVER_KEY`;
2. bind port `8642` to the container's private Compose network, never directly to the LAN;
3. route a dedicated prefix such as `/wave/` from the existing private Tailscale HTTPS service to
   the API server, stripping that prefix upstream;
4. keep dashboard traffic on port `9119`;
5. disable proxy response/request buffering and retain long streaming timeouts;
6. preserve bearer authentication on the API server and existing dashboard authentication;
7. avoid CORS configuration unless a browser client is intentionally added.

Using `/wave/` avoids collisions with the dashboard's own `/api/*` routes. A resulting client base
URL has this shape:

```text
https://<private-hermes-service>/wave
```

Wave then appends `/v1/capabilities`, `/api/sessions`, and the other advertised paths.

## Validation

Run deterministic transport tests:

```bash
npm test
```

After the private endpoint exists, put the key into the shell without committing it or placing it
in a command argument, then run the integration probe:

```bash
read -s HERMES_API_KEY
export HERMES_API_KEY
export HERMES_API_URL=https://<private-hermes-service>/wave
npm run test:hermes:integration
unset HERMES_API_KEY HERMES_API_URL
```

The probe validates capabilities, creates a session unless `HERMES_INTEGRATION_SESSION_ID` is
provided, and completes one streamed turn. It prints only the resulting session ID, never the key
or response content.
