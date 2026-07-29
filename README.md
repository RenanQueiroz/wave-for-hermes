# Wave

Wave is a focused mobile client for chatting with a user's
[Hermes Agent](https://github.com/NousResearch/hermes-agent). It is a conversation surface, not an
administration console.

The core feature will be a low-latency live voice mode backed by the OpenAI Realtime API. The
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

The repository is at the application-foundation and transport stage. It currently includes:

- Expo SDK 57 with Expo Router and development-client support for iOS and Android;
- [PanelUI](https://www.panelui.dev/docs) through the `panelui-native` package;
- Uniwind and Tailwind CSS v4 for PanelUI themes and utility styling;
- the repository-local mobile agent bridge in [`tools/mobile-agent`](./tools/mobile-agent/README.md);
- repo-level Expo MCP configuration for Codex and Claude Code;
- a typed, bearer-authenticated Hermes Sessions API adapter with capability validation, streamed
  SSE parsing, cancellation, normalized errors, redaction, fixtures, and unit tests.

The adapter is temporarily located under `src/services/hermes`; it will move into the Node
companion when the workspace is introduced and must not become a mobile production dependency. The
visible screens are still starter UI. Companion authentication, secure device credential storage,
connection screens, text chat, and the Realtime voice slice have not been implemented yet. See
[`docs/hermes-connectivity.md`](./docs/hermes-connectivity.md) for the current adapter contract and
private deployment prerequisite.

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

Create and run a local development build when native dependencies change:

```bash
npx expo prebuild --clean
npx expo run:ios
# or
npx expo run:android
```

Native identifiers are configured in `app.json`:

- iOS bundle identifier: `com.renanqueiroz.wave`
- Android application ID: `com.renanqueiroz.wave`

## Checks

Run these before handing off a change:

```bash
npm test
npm run lint
npx tsc --noEmit
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
- Never embed a standard OpenAI API key in the mobile app. Realtime client access must use
  short-lived credentials created by a trusted server-side component.
- Treat Realtime tool arguments and Hermes responses as untrusted input. Validate them at the
  boundary.
- Store user credentials with an appropriate platform-backed secure-storage solution when that
  feature is implemented.
- Keep Wave's Hermes access limited to chat and explicit conversational tools; do not quietly add
  configuration or administrative capabilities.

## Hermes adapter

The server-side transport boundary is currently staged under `src/services/hermes`. It supports an
optional profile or proxy prefix in the base URL, requires HTTPS unless an explicit private/local
development exception is enabled, and never exposes raw tool arguments through its event types.
When the companion workspace is introduced, this implementation and its tests will move behind the
companion. Mobile features will use `WaveBackendClient`, not `HermesClient`.

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
- [OpenAI Realtime API](https://platform.openai.com/docs/api-reference/realtime)
- [Hermes connectivity contract](./docs/hermes-connectivity.md)
