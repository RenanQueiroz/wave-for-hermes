# Wave

Wave is a focused mobile client for chatting with a user's
[Hermes Agent](https://github.com/NousResearch/hermes-agent). It is a conversation surface, not an
administration console.

The core feature is a low-latency live voice mode backed by the OpenAI Realtime API. The
Realtime model can request typed tools; Wave validates those tool calls, forwards the corresponding
request to the user's Hermes agent, and returns the result to the conversation.

## Product scope

Wave is intended to support:

- text chat with a Hermes agent;
- a natural, interruptible live voice conversation;
- explicit tool calls that let the Realtime session ask Hermes to perform work;
- iOS and Android, with shared behavior where the platforms allow it.

Wave is not intended to manage Hermes configuration, providers, models, skills, or server
administration. It must never ship a long-lived OpenAI API key in the app bundle.

The Hermes transport targets the authenticated Sessions API exposed by Hermes's API Server. A
self-hosted Wave Companion is the application's only production backend: it holds the long-lived
Hermes and OpenAI credentials, exposes a narrow Wave-specific API, and handles Realtime call setup
and tool dispatch. The intended trust boundary is:

```text
Wave mobile ── device credential + Wave API ──> Wave Companion ──> Hermes API Server
     │                                              │
     └════ direct WebRTC audio ════> OpenAI Realtime API
                                                   ▲
                         call setup + sideband ────┘
```

The companion source belongs in this repository so the client, server, and shared contracts evolve
together. Environment-specific Compose, Nginx, Tailscale, image pinning, and secrets remain in the
Homelab repository.

## Current status

The repository has authenticated text chat and the first end-to-end live-voice vertical slice. It
currently includes:

- Expo SDK 57 with Expo Router and development-client support for iOS and Android;
- [PanelUI](https://www.panelui.dev/docs) through the `panelui-native` package;
- Uniwind and Tailwind CSS v4 for PanelUI themes and utility styling;
- the Expo SDK 57-native [`react-native-webrtc` foundation](./docs/webrtc-foundation.md), including
  an audio-only development proof validated on iOS and Android;
- the repository-local mobile agent bridge in [`tools/mobile-agent`](./tools/mobile-agent/README.md);
- repo-level Expo MCP configuration for Codex and Claude Code;
- a Node.js 24/Fastify Wave Companion workspace with one-time pairing, hashed and revocable device
  credentials, device/session authorization, bounded streamed chat, normalized errors, redacted
  logs, and graceful shutdown;
- the official OpenAI JavaScript SDK in the Companion only for unified WebRTC call setup and
  lifecycle requests, plus the documented authenticated `ws` sideband connection, opaque
  Wave-owned call identifiers, bounded call state, and cleanup;
- runtime-neutral Wave pairing, session, history, cancellation, error, normalized turn-event,
  Realtime call, and strict `ask_hermes` schemas in `@wave/contracts`;
- a contract-validating mobile `WaveBackendClient` with strict URL policy, bounded JSON requests,
  strict ordered SSE streaming through Expo's native `expo/fetch`, cancellation, response-size
  limits, authenticated Realtime call start/end methods, safe normalized errors, and no direct
  Hermes or OpenAI transport;
- an audio-only native `RealtimeTransport` and focused lifecycle controller that own microphone
  tracks, WebRTC negotiation, data-channel events, reconnect bounds, cancellation, expiry, and
  explicit companion cleanup outside React components;
- a PanelUI live-voice route over the active Hermes session with safe listening/speaking/error
  state, ephemeral transcripts, mute/unmute, explicit hangup, stable automation identifiers, and
  validated real Realtime connection/teardown flows on Radon-managed iOS and Android simulators;
- a PanelUI pairing flow that exchanges a one-time code for a revocable device credential, stores
  the connection in Expo SecureStore, restores and verifies it on launch, and can clear local
  access explicitly;
- TanStack Query-backed session/history state plus PanelUI conversation list and chat routes with
  batched assistant deltas, lifecycle-safe prompt cancellation, sanitized tool tasks,
  active-session restoration, and a keyboard-sticky native composer that keeps Send and Stop
  controls reachable;
- a typed, bearer-authenticated server-only Hermes Sessions API adapter with capability validation,
  streamed SSE parsing, cancellation, normalized errors, redaction, fixtures, and unit tests;
- a live Homelab deployment with unpublished Hermes/Companion ports, Tailscale-only HTTPS ingress
  at `/wave`, revocable device authentication, and validated streaming, persisted history, and
  cancellation against the pinned Hermes release;
- an explicit live integration probe that validates OpenAI's unified SDP exchange, authenticated
  Realtime sideband control, WebRTC connectivity, strict `ask_hermes` dispatch, Hermes persistence,
  the final model response, and cleanup without printing secrets or conversation content;
- automated dependency, import, configuration, and production-bundle boundary checks.

The visible app begins with the real connection flow, then opens the user's authorized Hermes
conversations and streams normalized text turns. From an active chat, the microphone control opens
the live-voice route, establishes a native WebRTC call through the Companion, and can automatically
dispatch a strictly validated `ask_hermes({ instruction })` call against the trusted active Hermes
session. Physical-device audio routing, interruption, barge-in, release-build, and realistic
network validation remain before live voice is production-ready.
See [`docs/architecture.md`](./docs/architecture.md) for workspace and trust boundaries and
[`docs/hermes-connectivity.md`](./docs/hermes-connectivity.md) for the current upstream contract and
validated private deployment.

## Local development

Requirements:

- Node.js 24 LTS;
- Xcode and an iOS Simulator for iOS development;
- Android Studio and an Android emulator for Android development.

Install dependencies and start Metro:

```bash
nvm use
npm install
npm start
```

The `start`, `ios`, and `android` scripts set `EXPO_UNSTABLE_MCP_SERVER=1` in a cross-platform way.
They work on Windows, macOS, and Linux. Radon IDE can manage Metro and the simulator instead; after
changing `metro.config.js`, `src/global.css`, or PanelUI dependencies, fully restart the Radon
launch/Metro server so the Uniwind transform is reloaded.

Wave does not support React Native Web. Web dependencies, scripts, configuration, and
platform-specific implementations should not be added.

The root is also the npm workspace root. Build and run the companion separately:

```bash
export HERMES_API_URL=https://<private-hermes-api>
read -s HERMES_API_KEY
export HERMES_API_KEY
npm run companion:build
npm run companion:start
```

The companion defaults to `127.0.0.1:8787`. It requires HTTPS for Hermes unless
`HERMES_ALLOW_INSECURE_HTTP=1` explicitly permits a trusted private/local HTTP endpoint. Full
configuration and boundary details are in [`docs/architecture.md`](./docs/architecture.md), and
the pairing/operator workflow is in [`companion/README.md`](./companion/README.md).

To enable the Realtime routes, provide the standard OpenAI key only to the Companion process:

```bash
read -s OPENAI_API_KEY
export OPENAI_API_KEY
npm run companion:start
```

Without `OPENAI_API_KEY`, text chat remains available, `GET /v1/status` reports
`features.realtime: false`, and Realtime call creation returns a safe unavailable response.

The repository also owns a production-only Companion container artifact:

```bash
docker build \
  --file companion/Dockerfile \
  --tag wave-companion:local \
  .
```

The image contains only the compiled Companion, compiled shared contracts, and their production
dependencies. Homelab pins the exact Wave source revision, builds the image locally, and owns its
private network, persistent authorization database, Tailscale-only `/wave/` Nginx route, runtime
secrets, pairing/revocation commands, and live integration validation.

Create and run a local development build when native dependencies change. The current client
requires `react-native-webrtc`, `expo-secure-store`, and `react-native-keyboard-controller`, so an
older installed development client cannot run it:

```bash
npx expo prebuild --clean
npx expo run:ios
# or
npx expo run:android
```

Native identifiers are configured in `app.json`:

- iOS bundle identifier: `com.renanqueiroz.wave`
- Android application ID: `com.renanqueiroz.wave`

### Pair a mobile development build

Start a companion that the emulator or simulator can reach, then generate a one-time code against
the same `WAVE_DATABASE_PATH`:

```bash
npm run companion:pair
```

In Wave, enter the companion URL, a recognizable device name, and the 16-character code. Production
builds accept HTTPS only. Development builds also allow an explicit HTTP URL for trusted local
testing. Pairing checks the public companion status, redeems the code exactly once, saves the
device-scoped credential in platform secure storage, and performs an authenticated live Hermes
compatibility check before entering the app.

On later launches Wave reads the saved connection asynchronously and repeats the compatibility
check. **Disconnect this device** removes only the phone's local credential; use
`npm run companion:revoke -- <device-id>` when the credential must also be invalidated server-side.
The full operator workflow is in [`companion/README.md`](./companion/README.md).

After pairing, Wave lists only sessions authorized for that device. Start a new conversation or
explicitly import existing Hermes sessions, then send text from the chat route. Hermes remains the
durable history source; Wave stores only the active session identifier so it can resume that
conversation after process restart. Raw tool arguments and output are never rendered by the mobile
chat UI.

For UI development before the private Hermes API is available, the companion also provides an
explicitly development-only, in-memory fixture:

```bash
WAVE_FIXTURE_HOST=0.0.0.0 npm run companion:mobile-fixture
```

An Android emulator can reach that listener at `http://10.0.2.2:8787`. The fixture provides
deterministic sessions, assistant deltas, sanitized tool lifecycle events, and history restoration.
See the companion README before using it; the fixture is not a production entrypoint and all of its
state disappears when it stops.

### WebRTC development proof

After installing `react-native-webrtc` or changing microphone permissions, rebuild the native
development client; a JavaScript reload alone cannot add native code. In a paired development
build, open **Development tools** and select **Start proof** to verify microphone acquisition, a
local peer negotiation, a remote audio track, a data-channel echo, and cleanup. Wave requests
microphone access only and explicitly blocks the Android camera permission.

The proof remains a small local diagnostic separate from the production OpenAI Realtime transport.
See
[`docs/webrtc-foundation.md`](./docs/webrtc-foundation.md) for the exact workflow, validation
record, automation hooks, and remaining physical-device gates.

## Checks

Run these before handing off a change:

```bash
npm run build
npm test
npm run lint
npm run typecheck
npm run verify:boundaries
npx expo install --check
npm run mobile:smoke:production
```

For device discovery, screenshots, accessibility trees, gestures, logs, and the local mobile MCP
server, see [`tools/mobile-agent/README.md`](./tools/mobile-agent/README.md).

## UI system

PanelUI is installed in package mode so the app can receive upstream component fixes. Import
components from `panelui-native`. The root provider and theme bridge live in
`src/app/_layout.tsx`, while Uniwind is configured in `metro.config.js` and `src/global.css`.
Use PanelUI's semantic tokens rather than hard-coded palette colors. For colors required by native
props or non-PanelUI components, resolve the corresponding `--color-*` token with
`useCSSVariable`.

The [PanelUI CLI](https://www.panelui.dev/docs/cli) is optional. Use it only when a component needs
to be copied into the repository for deliberate source-level customization; package and copied
components can coexist.

## Security baseline

- Never commit credentials or print them in logs.
- Never embed a standard OpenAI API key in the mobile app. The Companion uses OpenAI's unified
  WebRTC interface so the mobile app exchanges its SDP offer for an SDP answer and an opaque
  Wave-owned call ID without receiving the provider key or provider call ID.
- Treat Realtime tool arguments and Hermes responses as untrusted input. Validate them at the
  boundary.
- Realtime may dispatch the narrow `ask_hermes({ instruction })` tool without an additional Wave
  confirmation dialog after schema validation and companion authorization. This does not bypass
  Hermes's own tool safety policy or broaden the tool into administration access.
- Store only the revocable device-scoped companion credential and its small connection record in
  Expo SecureStore. Never expose that credential through UI, development state, logs, screenshots,
  or traces.
- Keep Wave's Hermes access limited to chat and explicit conversational tools; do not quietly add
  configuration or administrative capabilities.

## Hermes adapter

The server-side transport boundary lives under `companion/src/hermes`. It supports an optional
profile or proxy prefix in the base URL, requires HTTPS unless an explicit private/local development
exception is enabled, and never exposes raw tool arguments through its event types. Mobile features
use `WaveBackendClient`, not `HermesClient`; the repository intentionally has no second mobile
Hermes transport.

Run its deterministic tests with:

```bash
npm test
```

Once a private API Server endpoint is available, the opt-in real integration probe is:

```bash
npm run test:hermes:integration
```

It requires `HERMES_API_URL` and `HERMES_API_KEY` in the server-side process environment. Do not
commit them, put the key in an `EXPO_PUBLIC_*` variable, persist it in the mobile app, or pass it as
a command-line argument. Full setup and cancellation semantics are documented in
[`docs/hermes-connectivity.md`](./docs/hermes-connectivity.md).

## Reference documentation

- [Expo SDK 57 documentation](https://docs.expo.dev/versions/v57.0.0/)
- [PanelUI installation](https://www.panelui.dev/docs/installation)
- [PanelUI CLI](https://www.panelui.dev/docs/cli)
- [PanelUI theming](https://www.panelui.dev/docs/theming)
- [OpenAI Realtime API](https://developers.openai.com/api/docs/guides/realtime)
- [Realtime WebRTC connection guide](https://developers.openai.com/api/docs/guides/realtime-webrtc)
- [Realtime server-side controls](https://developers.openai.com/api/docs/guides/realtime-server-controls)
- [Wave architecture and workspace boundaries](./docs/architecture.md)
- [Hermes connectivity contract](./docs/hermes-connectivity.md)
- [WebRTC foundation and validation](./docs/webrtc-foundation.md)
