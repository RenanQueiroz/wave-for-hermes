# Wave

Wave is a focused mobile client for chatting with a user's
[Hermes Agent](https://github.com/NousResearch/hermes-agent). It is a conversation surface, not an
administration console.

The core feature is a low-latency live voice mode backed by the OpenAI Realtime API. The
Realtime model is the user's Wave assistant: it answers lightweight conversation directly and
automatically delegates requests that need tools, private context, current information, durable
work, or substantial reasoning to Hermes through a typed tool. Wave validates the call, forwards
an intent-preserving instruction, and presents the confirmed result naturally as its own response.
The user never has to address Hermes separately.

## Product scope

Wave is intended to support:

- text chat with a Hermes agent;
- browsing, searching, continuing, renaming, and deleting the user's Hermes conversation history;
- sending bounded images and text-based files with a message;
- a natural, interruptible live voice conversation;
- automatic typed delegation from the Realtime session to Hermes when work requires it;
- focused read-only Hermes status surfaces, beginning with scheduled jobs;
- iOS and Android, with shared behavior where the platforms allow it.

Wave is not intended to manage Hermes configuration, providers, models, skills, or server
administration. Read-only operational status crosses only explicit normalized Wave contracts; Wave
does not expose a generic Hermes proxy or operational mutations. It must never ship a long-lived
OpenAI API key in the app bundle.

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
- a Node.js 24/Fastify Wave Companion workspace with one-time pairing, hashed and revocable
  account-scoped device credentials, paginated Hermes conversation lifecycle routes, bounded
  streamed chat and attachments, an idempotent finalized-voice interaction ledger, normalized
  errors, metadata-only correlated request logs, and graceful shutdown;
- the official OpenAI JavaScript SDK in the Companion only for unified WebRTC call setup and
  lifecycle requests, plus the documented authenticated `ws` sideband connection, opaque
  Wave-owned call identifiers, bounded call state, background Hermes request serialization,
  exact-instruction coalescing, response-safe result delivery, and cleanup;
- runtime-neutral Wave pairing, paginated session lifecycle and unified timeline, attachment,
  read-only scheduled-job, redacted diagnostics, cancellation, error, normalized turn-event,
  Realtime voice/catalog, call, and strict `ask_hermes` schemas in `@wave/contracts`;
- a contract-validating mobile `WaveBackendClient` with strict URL policy, bounded JSON requests,
  strict ordered SSE streaming through Expo's native `expo/fetch`, cancellation, response-size
  limits, authenticated Realtime call start/end methods, safe normalized errors, bounded
  exponential-jitter retries for finite retryable reads, and no direct Hermes or OpenAI transport;
- an audio-only native `RealtimeTransport` and focused lifecycle controller that own microphone
  tracks, WebRTC negotiation, data-channel events, reconnect bounds, cancellation, expiry, and
  explicit companion cleanup outside React components;
- a PanelUI live-voice route over the active Hermes session with safe listening/speaking/error
  state, in-call transcripts, mute/unmute, explicit hangup, stable automation identifiers, and
  unified-timeline refresh before returning to text chat, plus
  validated real Realtime connection/teardown flows on Radon-managed iOS and Android simulators,
  plus audible microphone/assistant playback, background-work barge-in, and bounded ordered
  `ask_hermes` follow-ups on a physical Android device;
- a secure per-device live-voice preference backed by a strict Gateway-owned voice catalog, with
  in-settings voice previews served as bounded Gateway-generated samples that both sides cache
  until the Gateway's Realtime model changes, plus actionable microphone-permission recovery on
  both mobile platforms;
- a persisted appearance setting pairing PanelUI's Panel, Moon, and Grass theme families with a
  separate system/light/dark choice, applied live across the app including native headers and the
  status bar;
- resumable turn streams: a dropped connection, backgrounding, or app restart no longer cancels a
  running Hermes turn — the companion buffers ordered events and the chat screen reattaches with
  sequence replay, while explicit Stop still cancels;
- an offline read cache that keeps previously viewed chats and the session list readable without
  connectivity, showing a quiet offline notice for connectivity-shaped failures and purging itself
  on pair, forget, and disconnect;
- a PanelUI pairing flow that exchanges a one-time code for a revocable device credential, stores
  the connection in Expo SecureStore, restores and verifies it on launch, and can revoke the
  current device before clearing local access;
- a ChatGPT-style chat-first shell that creates a new conversation on connected launch, opens
  account-wide history from a side drawer, searches titles, renames/deletes sessions, keeps
  Settings and Disconnect fixed at the bottom, exposes scheduled jobs as read-only status, and can
  share content-free support diagnostics from Settings;
- TanStack Query-backed paginated session/timeline state plus PanelUI conversation and chat routes
  with batched assistant deltas, lifecycle-safe prompt cancellation, canonical Hermes records and
  finalized Wave speech merged into coherent turns, bottom-aligned Wave avatars, collapsed named
  tool and Hermes-handoff rows whose disclosures render bounded raw input/output as inert code,
  current-session tracking, and a keyboard-sticky rounded composer with an internal attachment
  control and exactly one trailing action: Send when text is present, live voice when it is empty,
  or Stop during an active turn;
- a typed, bearer-authenticated server-only Hermes Sessions API adapter with capability validation,
  streamed SSE parsing, cancellation, normalized errors, redaction, fixtures, and unit tests;
- a live Homelab deployment with unpublished Hermes/Companion ports, Tailscale-only HTTPS ingress
  at `/wave`, revocable device authentication, and validated streaming, persisted history, and
  cancellation against the pinned Hermes release;
- an explicit live integration probe that validates OpenAI's unified SDP exchange, authenticated
  Realtime sideband control, WebRTC connectivity, strict `ask_hermes` dispatch, Hermes persistence,
  the final model response, and cleanup without printing secrets or conversation content;
- automated dependency, import, configuration, and production-bundle boundary checks.

The visible app begins with the connection flow, then opens a newly created Hermes conversation.
The hamburger drawer provides the full top-level Hermes history, title search, conversation
lifecycle actions, Settings, Disconnect, and focused read-only scheduled-job status. The composer
can attach bounded images and supported text files. Its trailing action changes between Send and a
live-wave control based on whether trimmed text is present, so both are never shown together. From
an active chat, the live-wave control opens the live-voice route, establishes a native WebRTC call
through the Companion, and automatically dispatches a strictly validated
`ask_hermes({ instruction })` call against the trusted active Hermes session when the user's natural
request requires backend work. The Realtime model may turn that request into a clearer,
self-contained Hermes instruction, but it must preserve the user's intent, scope, constraints,
identifiers, quoted text, and literal values. It then summarizes or confirms only the result Hermes
actually returned, without making the user manage the internal handoff. Physical iOS (including
barge-in), audio-route, interruption, release-build, and realistic network validation remain before
live voice is production-ready. See the tracked
[`docs/roadmap.md`](./docs/roadmap.md) for the prioritized remaining work.
See [`docs/architecture.md`](./docs/architecture.md) for workspace and trust boundaries and
[`docs/hermes-connectivity.md`](./docs/hermes-connectivity.md) for the current upstream contract and
validated private deployment. [`docs/security.md`](./docs/security.md) records the threat model,
implemented controls, residual risks, and store-release security gates. The current dependency and
container review is recorded in
[`docs/dependency-security.md`](./docs/dependency-security.md).

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

Repository formatting is defined by `prettier.config.js`. Run `npm run format` to format supported
files; the normal `npm run lint` handoff also runs `npm run format:check`, while
`eslint-config-prettier` keeps ESLint's style rules from conflicting with Prettier.

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

The image contains only Node on a digest-pinned Alpine runtime, the compiled Companion, compiled
shared contracts, and their production dependencies. npm, corepack, mobile/build dependencies, and
development tooling stay outside the runtime. Homelab pins the exact Wave source revision, builds
the image locally, and owns its private network, persistent authorization database, Tailscale-only
`/wave/` Nginx route, runtime secrets, pairing/revocation commands, and live integration
validation.

Create and run a local development build when native dependencies change. The current client
requires `react-native-webrtc`, `expo-secure-store`, `react-native-keyboard-controller`,
`expo-image-picker`, `expo-document-picker`, and `expo-file-system`, so an older installed
development client cannot run it:

```bash
npx expo prebuild --clean
npx expo run:ios
# or
npx expo run:android
```

Native identifiers are configured in `app.json`:

- iOS bundle identifier: `com.renanqueiroz.wave`
- Android application ID: `com.renanqueiroz.wave`

Android release builds enable R8 code minification and resource shrinking through the
`expo-build-properties` config plugin. These optimizations intentionally do not apply to development
clients, which include Metro and debugging infrastructure and are therefore substantially larger
than store-ready release artifacts.

### Set up a companion with your agent

The Connect screen's **Share setup prompt** action shares a self-contained prompt for the coding
agent on the machine that runs Hermes. The agent builds and runs the Companion container, makes it
reachable over Tailscale (preferring `tailscale serve` for HTTPS), verifies `/v1/status`, and
replies with the companion URL and a one-time pairing code — no manual server work on the phone
side. The prompt text lives in `src/features/connection/companion-setup-prompt.ts` and contains no
credentials.

### Pair a mobile development build

Start a companion that the emulator or simulator can reach, then generate a one-time code against
the same `WAVE_DATABASE_PATH`:

```bash
npm run companion:pair
```

In Wave, enter the companion URL, a recognizable device name, and the 16-character code. A bare
address defaults to HTTPS — or to HTTP for localhost and Tailscale CGNAT (`100.64.0.0/10`)
addresses, where the transport is already private. All builds also accept an explicitly typed
`http://` URL to a private LAN host — an RFC 1918 address like `192.168.1.50` or an mDNS name
like `renans-mac-mini.local` — for connecting directly on a trusted home network; that traffic
crosses the LAN unencrypted, so the explicit scheme is the deliberate opt-in, and `.local` names
resolve on iOS only (use the LAN IP on Android). Note that on the same network a tailnet
connection is already a direct WireGuard path between the devices, so the Tailscale address stays
the recommended default. Development builds additionally allow an explicit HTTP URL to any host
for trusted local testing. Pairing checks the public companion status, redeems the code exactly
once, saves the device-scoped credential in platform secure storage, and performs an
authenticated live Hermes compatibility check before entering the app.

On later launches Wave reads the saved connection asynchronously and repeats the compatibility
check. **Disconnect this device** calls the authenticated self-revocation endpoint, ends that
device's active text and voice work, then removes its local secure credential. If the Gateway is
unreachable, the saved-connection screen offers an explicit local-only forget action and reminds
the user to revoke the device through the operator tools. The full operator workflow is in
[`companion/README.md`](./companion/README.md).

After pairing, Wave creates and opens a new Hermes conversation. The drawer pages through every
top-level session returned by the Hermes account and supports title search, continue, rename, and
delete. Hermes remains canonical for Hermes-authored messages and tools. The Companion keeps only
finalized live-voice user/Wave transcripts and handoff metadata, without raw audio; clearing Hermes
history removes its canonical turns on the next timeline refresh while retained Wave voice turns
remain inspectable until the parent session is deleted. Opening a deleted session returns the app
to a new conversation. Tool calls and voice handoffs are collapsed by default. A user can expand
one to inspect bounded raw input and output as inert, copyable text; Wave does not parse it as
Markdown or execute it. Truncation is explicit.

The composer accepts up to four attachments with a non-empty message. Camera and Photos are
converted to bounded inline JPEG data (4 MB per image). Files are restricted to supported
text/code/JSON/CSV/XML/Markdown content and 128,000 characters. Unsupported binary documents are
rejected locally. The Companion validates the same strict turn schema before translating it to the
pinned Hermes multimodal chat format.

For UI development before the private Hermes API is available, the companion also provides an
explicitly development-only, in-memory fixture:

```bash
WAVE_FIXTURE_HOST=0.0.0.0 npm run companion:mobile-fixture
```

An Android emulator can reach that listener at `http://10.0.2.2:8787`. The fixture provides
deterministic sessions, assistant deltas, sanitized tool lifecycle events, and history restoration,
plus the Realtime voice catalog with locally synthesized per-voice preview tones so the settings
voice previews work without OpenAI; live Realtime calls stay unavailable.
The tool event includes deterministic raw input/output for exercising the collapsed disclosure. See
the companion README before using it; the fixture is not a production entrypoint and all of its
state disappears when it stops.

### WebRTC development proof

After installing `react-native-webrtc` or changing microphone permissions, rebuild the native
development client; a JavaScript reload alone cannot add native code. In a paired development
build, open **Development tools** and select **Start proof** to verify microphone acquisition, a
local peer negotiation, a remote audio track, a data-channel echo, and cleanup. Realtime remains
audio-only. Camera access is requested separately and only after the user chooses the chat
attachment Camera action.

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
exception is enabled, and converts Hermes tool calls into strict bounded Wave detail fields without
exposing upstream call or run identifiers. Mobile features use `WaveBackendClient`, not
`HermesClient`; the repository intentionally has no second mobile Hermes transport.

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
