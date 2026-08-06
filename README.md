# Wave

Wave is a focused mobile client for chatting with a user's
[Hermes Agent](https://github.com/NousResearch/hermes-agent). It is a conversation surface, not an
administration console.

Wave talks directly to the user's Hermes gateway: sign-in uses the same username and password as
the Hermes dashboard, conversations stream over the gateway's WebSocket protocol, and voice ships
in two modes. The default voice mode runs on the gateway's own speech endpoints and needs no extra
credentials. The opt-in live voice mode is backed by the OpenAI Realtime API using an API key the
user supplies in Settings: the Realtime model is the user's Wave assistant — it answers
lightweight conversation directly and automatically delegates requests that need tools, private
context, current information, durable work, or substantial reasoning to Hermes through a typed
tool. While that delegated execution is active, Wave can also steer it through a second narrowly
scoped typed correction. Wave validates every call, forwards an intent-preserving instruction,
and presents the confirmed result naturally as its own response. The user never has to address
Hermes separately.

## Product scope

Wave is intended to support:

- text chat with a Hermes agent;
- text-only correction of a running response without discarding completed work;
- browsing, searching, pinning, continuing, renaming, and deleting the user's Hermes conversation
  history;
- sending bounded images and text-based files with a message;
- a natural, interruptible live voice conversation;
- automatic typed delegation from the Realtime session to Hermes when work requires it;
- natural correction of the one active Realtime-delegated Hermes execution;
- iOS and Android, with shared behavior where the platforms allow it.

Wave is not intended to manage Hermes configuration, providers, models, skills, or server
administration. Wave does not expose a generic Hermes proxy or operational mutations. It must
never ship a long-lived OpenAI API key in the app bundle; the only OpenAI credential the app ever
holds is the one the user deliberately enters, kept in platform secure storage.

The trust boundary is:

```text
Wave mobile ── rotating session tokens + gateway protocol ──> Hermes gateway
     │
     └════ direct WebRTC audio + sideband (user-owned key) ════> OpenAI Realtime API
```

Wave has no application backend of its own. Environment-specific deployment, networking, and
gateway secrets remain in the Homelab repository.

## Current status

The repository has authenticated text chat against the Hermes gateway plus both voice modes. It
currently includes:

- Expo SDK 57 with Expo Router and development-client support for iOS and Android;
- [PanelUI](https://www.panelui.dev/docs) through the `panelui-native` package;
- Uniwind and Tailwind CSS v4 for PanelUI themes and utility styling;
- the Expo SDK 57-native [`react-native-webrtc` foundation](./docs/webrtc-foundation.md), including
  an audio-only development proof validated on iOS and Android;
- a bounded foreground-only
  [`streaming PCM playback foundation`](./docs/pcm-playback-foundation.md) for Hermes v0.20
  gateway speech, now backed by Software Mansion's native audio-buffer queue after the focused
  Android `AudioTrack` prototype remained intermittently audible; its repeated Pixel 8 Pro
  built-in-speaker proof now passes, while production gateway voice stays on buffered speech until
  the remaining device-route and lifecycle gates pass;
- the repository-local mobile agent bridge in [`tools/mobile-agent`](./tools/mobile-agent/README.md);
- repo-level Expo MCP configuration for Codex and Claude Code;
- a typed gateway client (`src/services/gateway`) that signs in with the gateway's password
  provider, stores only rotating session tokens in platform secure storage, streams turns over the
  platform WebSocket with the gateway's JSON-RPC framing, normalizes every protocol shape into
  Wave contracts at the boundary, and never logs tokens, URLs, or conversation content;
- runtime-neutral normalized Wave error, turn-event, session, unified timeline, attachment,
  Realtime call, and strict `ask_hermes`/`correct_hermes` schemas in `@wave/contracts`;
- resumable turn streams: a dropped connection, backgrounding, or app restart no longer cancels a
  running Hermes turn — the chat screen resumes the live session and reconciles from authoritative
  Hermes history, restores the server's starting/working/waiting state and last-activity time,
  while explicit Stop still cancels;
- an offline read cache that keeps previously viewed chats and the session list readable without
  connectivity, retains a bounded app-trusted journal of accepted mid-turn corrections for stable
  reload ordering, shows a quiet offline notice for connectivity-shaped failures, and purges
  itself on sign-in and sign-out;
- a ChatGPT-style chat-first shell that creates a new conversation on connected launch, opens
  account-wide history from a side drawer, keeps server-owned pins above Today / Yesterday /
  Previous 7 days / Older groups, separates Chats from Automations and external activity without
  hiding unknown future sources, searches titles and messages, renames/deletes sessions, and keeps
  Settings and Disconnect fixed at the bottom;
- TanStack Query-backed paginated session/timeline state plus PanelUI conversation and chat routes
  with batched assistant deltas, lifecycle-safe prompt cancellation, coherent grouped turns,
  sealed interim narration, in-place bounded tool progress, reviewed ephemeral activity and
  stale-working hints, bottom-aligned Wave avatars, collapsed named tool rows whose disclosures
  render bounded raw input/output as inert code, current-session tracking, and a keyboard-sticky rounded composer
  with an internal attachment control and exactly one trailing action: Send when text is present,
  live voice when it is empty, or — during an active turn — Correct for text and Stop when empty;
- inline mid-turn prompts: Hermes approval and clarify requests render in the turn they belong
  to, are answered on the socket bound to that turn, and clear as soon as anything proves them
  settled; secret/sudo requests are declined with copy that says why;
- gateway voice mode (default): half-duplex speech on the gateway's speech-to-text and
  text-to-speech endpoints with adaptive silence detection tuned per platform, an explicit
  interrupt control, a stop word, and composer dictation;
- opt-in Realtime live voice keyed by the user's own OpenAI key: SDP exchange directly against
  `POST /v1/realtime/calls`, the authenticated WebSocket sideband, an audio-only native
  `RealtimeTransport` and focused lifecycle controller with bounded reconnection, strictly
  validated `ask_hermes` dispatch executed as ordinary turns on the gateway connection with
  serialization and coalescing, dynamically advertised `correct_hermes` steering of only the one
  trusted active execution, serialized and acknowledged Realtime tool-surface updates,
  response-safe result delivery, a fixed metadata-free delegation prompt, exact whole-utterance
  stop handling, ephemeral in-call transcripts, and unified-timeline refresh before returning to
  text chat;
- an OpenAI key card in Settings that validates the key before saving, stores it with
  `WHEN_UNLOCKED_THIS_DEVICE_ONLY`, exposes presence (never the value) to the UI, can remove it,
  plus separate per-device Realtime model and voice pickers. The model picker accepts only
  `gpt-realtime-2.1-mini` (the latency/cost-oriented default) or `gpt-realtime-2.1` (the
  larger-model option), and a change applies to the next call;
- a persisted appearance setting pairing PanelUI's Panel, Moon, and Grass theme families with a
  separate system/light/dark choice, applied live across the app including native headers and the
  status bar;
- a Settings legal card that opens native iOS and Android acknowledgements generated from the
  production dependency graph during Prebuild;
- automated dependency, import, configuration, and production-bundle boundary checks, including a
  production scanner that rejects key-shaped literals in shipped bundles.

The visible app begins with the sign-in flow, then opens a newly created Hermes conversation. The
hamburger drawer provides the full top-level Hermes history, title/message search, server-backed
pinning, conversation lifecycle actions, Settings, and Disconnect. The composer can attach bounded
images and supported text
files. Its trailing action changes between Send and a live-wave control based on whether trimmed
text is present, so both are never shown together. From an active chat, the live-wave control
opens the voice route: gateway voice by default, or — when the user has saved an OpenAI key and
left Realtime enabled — a native WebRTC Realtime call that automatically dispatches a strictly
validated `ask_hermes({ instruction })` call against the bound Hermes session when the user's
natural request requires backend work. The Realtime model may turn that request into a clearer,
self-contained Hermes instruction, but it must preserve the user's intent, scope, constraints,
identifiers, quoted text, literal values, and any explicitly named execution preference. It does
not receive a catalog of Hermes tools, skills, MCP servers, peers, or configuration; Hermes chooses
how to execute the generic instruction. It then summarizes or confirms only the result Hermes
actually returned, without making the user manage the internal handoff. While exactly one
delegated execution is live, Wave advertises `correct_hermes({ instruction })`: corrections and
constraints steer only that active work, while distinct new work still uses the bounded
`ask_hermes` queue. The correction accepts no model-controlled identifier, never retries, and
fails as `nothing_active` rather than jumping to queued or completed work. A final bare Stop phrase
ends the Realtime call locally and is not stored. Physical iOS
(including barge-in), audio-route, interruption, release-build, and realistic network validation
remain before Realtime voice is production-ready. See the tracked
[`docs/roadmap.md`](./docs/roadmap.md) for the prioritized remaining work.
See [`docs/architecture.md`](./docs/architecture.md) for workspace and trust boundaries and
[`docs/hermes-connectivity.md`](./docs/hermes-connectivity.md) for the gateway contract and
validated private deployment. [`docs/security.md`](./docs/security.md) records the threat model,
implemented controls, residual risks, and store-release security gates. The current dependency
review is recorded in [`docs/dependency-security.md`](./docs/dependency-security.md).

## Local development

Requirements:

- Node.js 24 LTS;
- Xcode and an iOS Simulator for iOS development;
- Android Studio and an Android emulator for Android development;
- a reachable Hermes gateway to sign in against.

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

The root is also the npm workspace root; compile `packages/contracts` with
`npm run build:contracts`.

Create and run a local development build when native dependencies change. The current client
requires `react-native-webrtc`, `react-native-legal`, `expo-secure-store`,
`react-native-keyboard-controller`, `expo-image-picker`, `expo-document-picker`, and
`expo-file-system`, plus `react-native-audio-api`, so an older installed development client cannot
run it:

```bash
npx expo prebuild --clean
npx expo run:ios
# or
npx expo run:android
```

### Streaming PCM playback proof

The development client includes a focused native proof for the raw Int16 PCM stream returned by
Hermes v0.20. Open **Settings → Development** while connected, or open `wave://development`
directly in a development build, then run **Streaming PCM playback proof**. It checks bounded
20 ms chunk scheduling, exact drain, feed underruns, a sample-rate restart, cancellation, and
cleanup. After a pass, **Run again** starts another proof without requiring Stop. The route is
development-only; it does not connect to the gateway or replace production buffered speech.

The original focused native player passed exact accounting but crackled intermittently on the
Pixel 8 Pro, so Wave replaced it with `react-native-audio-api`'s native audio-buffer queue. Clean
Prebuild and iOS/Android builds pass, as does the iOS simulator proof. A cold screening plus six
consecutive Pixel 8 Pro built-in-speaker runs drained exactly with zero feed underruns and no pops
or crackles. Physical iOS, the remaining hardware routes, OS interruptions, and release behavior
still require validation before the streaming gateway client is implemented. See
[`docs/pcm-playback-foundation.md`](./docs/pcm-playback-foundation.md) for the exact contract and
remaining gates.

Native identifiers are configured in `app.json`:

- iOS bundle identifier: `com.renanqueiroz.wave`
- Android application ID: `com.renanqueiroz.wave`

### Standalone and EAS builds

The repository requires EAS CLI 21.4.0 or newer and defines three profiles in `eas.json`:

| Profile       | Purpose                                                                        |
| ------------- | ------------------------------------------------------------------------------ |
| `development` | Installable development client; native code is included, but Metro is required |
| `preview`     | Internally distributed release build; Android produces a standalone APK        |
| `production`  | Store build; Android uses the default AAB output                               |

Sign in to Expo once, then use the local-only build scripts:

```bash
npx eas-cli@21.4.0 login
npm run build:preview:android:local
npm run build:production:android:local
npm run build:production:ios:local
```

The preview command writes an installable `artifacts/wave-preview.apk` with the production
JavaScript bundle embedded, so it runs without Metro. The production commands write
`artifacts/wave-production.aab` for Google Play and `artifacts/wave-production.ipa` for App Store
distribution. Every repository EAS build command passes `--local`; there are no cloud-build
aliases. The first invocation may prompt to create or link the Expo project and configure signing
credentials. Local builds still contact EAS for project and credential metadata, require the
platform toolchain on the build machine, and never use Expo's cloud builders. Build outputs under
`artifacts/` are intentionally ignored; credentials and signing files must never be committed.

Android release builds enable R8 code minification and resource shrinking through the
`expo-build-properties` config plugin. These optimizations intentionally do not apply to
development clients, which include Metro and debugging infrastructure and are therefore
substantially larger than store-ready release artifacts.

### Sign in a mobile development build

In Wave, enter the gateway URL and the same username and password as the Hermes dashboard. A bare
address defaults to HTTPS — or to HTTP for localhost and Tailscale CGNAT (`100.64.0.0/10`)
addresses, where the transport is already private. All builds also accept an explicitly typed
`http://` URL to a private LAN host — an RFC 1918 address like `192.168.1.50` or an mDNS name
like `renans-mac-mini.local` — for connecting directly on a trusted home network; that traffic
crosses the LAN unencrypted, so the explicit scheme is the deliberate opt-in. `.local` names
resolve on iOS and current Android; fall back to the LAN IP on a device that cannot resolve
them. Note that on the same network a tailnet connection is already a direct WireGuard path
between the devices, so the Tailscale address stays the recommended default. These private
carve-outs work in release builds too — Android release enables cleartext app-wide with the
app's URL policy as the scoping enforcement, and iOS keeps ATS on with only local networking
allowed (see `docs/security.md`). Development builds additionally allow an explicit HTTP URL to
any host for trusted local testing.

Sign-in sends the password to the gateway exactly once and keeps only the gateway's rotating
session tokens in platform secure storage. On later launches Wave restores and re-verifies the
saved connection asynchronously. **Disconnect** deletes the local tokens; the gateway's stateless
tokens cannot be revoked individually and expire when the gateway's token secret rotates (for
example on gateway restart), which signs out every client at once.

After sign-in, Wave creates and opens a new Hermes conversation. The drawer pages through every
top-level session returned by the Hermes account, groups server-backed pins and recent dates, and
offers Chats, Activity, and All filters. Activity includes automations, external activity, and
unknown future source identifiers instead of hiding them. Pin/unpin, rename, and delete are typed
single-attempt mutations; search covers local titles and server-indexed message content. Hermes
remains canonical for conversation history; Realtime speech is ephemeral, and only
the work Wave hands to Hermes through `ask_hermes` lands as ordinary turns. Opening a deleted
session returns the app to a new conversation. Tool calls are collapsed by default. A user can
expand one to inspect bounded raw input and output as inert, copyable text; Wave does not parse it
as Markdown or execute it. Truncation is explicit.

The composer accepts up to four attachments with a non-empty message. Camera and Photos are
converted to bounded inline JPEG data (4 MB per image). Files are restricted to supported
text/code/JSON/CSV/XML/Markdown content and 128,000 characters. Unsupported binary documents are
rejected locally before dispatch. While a response is active, the composer accepts a text-only
correction that preserves completed work; attachments remain unavailable until that response
settles, and an empty composer keeps the explicit Stop action. Accepted corrections remain
ordinary user rows after reload even when Hermes delivered one at a safe tool-result boundary
without a distinct HTTP history row.

### Realtime voice with your own key

Add an OpenAI API key in **Settings → OpenAI key** to enable Realtime live voice. The key is
validated against `GET /v1/models` before saving, stored only in platform secure storage scoped to
this device, sent only to `api.openai.com` in Authorization headers, and removable at any time.
With no key — or with the **Prefer live voice** switch off — the voice route uses gateway voice.
Realtime usage bills the user's own OpenAI account.

### WebRTC development proof

After installing `react-native-webrtc` or changing microphone permissions, rebuild the native
development client; a JavaScript reload alone cannot add native code. In a signed-in development
build, open **Development tools** and select **Start proof** to verify microphone acquisition, a
local peer negotiation, a remote audio track, a data-channel echo, and cleanup. Realtime remains
audio-only. Camera access is requested separately and only after the user chooses the chat
attachment Camera action.

The proof remains a small local diagnostic separate from the production OpenAI Realtime transport.
See [`docs/webrtc-foundation.md`](./docs/webrtc-foundation.md) for the exact workflow, validation
record, automation hooks, and remaining physical-device gates.

## Checks

Run these before handing off a change:

```bash
npm run build:contracts
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
- Never embed an OpenAI API key in the mobile app bundle or configuration. The only OpenAI
  credential the app holds is the one the user enters in Settings, kept in platform secure
  storage, sent only to `api.openai.com`, and never logged, displayed back, or cached outside
  secure storage. The production bundle scanner rejects key-shaped literals.
- Treat Realtime tool arguments and Hermes responses as untrusted input. Validate them at the
  boundary.
- Realtime may dispatch narrow `ask_hermes({ instruction })` and active-only
  `correct_hermes({ instruction })` tools without an additional Wave confirmation dialog after
  strict schema validation and trusted binding. This does not bypass Hermes's own tool safety
  policy or broaden either tool into administration access.
- Realtime receives fixed Wave-authored tool definitions, never a reflected catalog of Hermes
  tools, skills, MCP/A2A metadata, Agent Cards, or configuration. The correction tool is advertised
  only while the app has one registered live Hermes execution and still rechecks that trusted
  execution when called. Preserve an execution preference only when the user states it explicitly;
  otherwise Hermes chooses its own plan.
- Store only the gateway's rotating session tokens (and the user's optional OpenAI key) in Expo
  SecureStore. Never expose them through UI, development state, logs, screenshots, or traces.
- Keep Wave's Hermes access limited to chat and explicit conversational tools; do not quietly add
  configuration or administrative capabilities.

## Gateway transport

The transport boundary lives under `src/services/gateway`. It owns sign-in, token rotation,
WebSocket framing, stream reattachment, speech endpoints, and error normalization; gateway
protocol shapes never leave it. Conversation screens depend on the backend-neutral
`WaveChatClient` surface, and gateway-specific capabilities (speech, prompts, Realtime execution)
are asked for explicitly. The full contract notes and validated deployment details are in
[`docs/hermes-connectivity.md`](./docs/hermes-connectivity.md).

Run the deterministic tests with:

```bash
npm test
```

## Reference documentation

- [Expo SDK 57 documentation](https://docs.expo.dev/versions/v57.0.0/)
- [PanelUI installation](https://www.panelui.dev/docs/installation)
- [PanelUI CLI](https://www.panelui.dev/docs/cli)
- [PanelUI theming](https://www.panelui.dev/docs/theming)
- [OpenAI Realtime API](https://developers.openai.com/api/docs/guides/realtime)
- [Realtime WebRTC connection guide](https://developers.openai.com/api/docs/guides/realtime-webrtc)
- [Realtime prompting guide](https://developers.openai.com/api/docs/guides/realtime-models-prompting)
- [Realtime server-side controls](https://developers.openai.com/api/docs/guides/realtime-server-controls)
- [React Native Legal](https://github.com/callstackincubator/react-native-legal)
- [Wave architecture and workspace boundaries](./docs/architecture.md)
- [Hermes connectivity contract](./docs/hermes-connectivity.md)
- [WebRTC foundation and validation](./docs/webrtc-foundation.md)

## License

Wave is available under the [MIT License](./LICENSE). The license retains the copyright notices
for Expo starter material and the official Expo skills committed in this repository. Third-party
software included in native builds keeps its own license; users can review those acknowledgements
from **Settings → Legal → Open-source licenses**.
