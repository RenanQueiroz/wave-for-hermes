<p align="center">
  <img src="./assets/images/icon.png" width="128" alt="Wave app icon" />
</p>

<h1 align="center">Wave</h1>

<p align="center">
  A focused iOS and Android client for chatting naturally with your
  <a href="https://github.com/NousResearch/hermes-agent">Hermes Agent</a>.
</p>

<p align="center">
  <img alt="Platforms: iOS and Android" src="https://img.shields.io/badge/platforms-iOS%20%7C%20Android-111111" />
  <img alt="Expo SDK 57" src="https://img.shields.io/badge/Expo%20SDK-57-111111" />
  <a href="./LICENSE"><img alt="MIT License" src="https://img.shields.io/badge/license-MIT-111111" /></a>
</p>

Wave is the conversation surface for a user's Hermes agent. It talks directly to the Hermes
gateway, keeps the product centered on chat and voice, and deliberately leaves server
administration to Hermes itself.

> [!IMPORTANT]
> Wave is under active development and does not yet publish store binaries. Text chat and gateway
> voice are functional, while Realtime voice still has release validation work tracked in the
> [roadmap](./docs/roadmap.md).

## Highlights

- Stream conversations from the Hermes gateway and resume work after disconnects or app restarts.
- Browse, search, pin, mark read or unread, rename, delete, branch, and continue the account's
  top-level conversations.
- Send bounded images and text-based files, steer an active response, and answer inline Hermes
  prompts.
- Talk through Hermes's gateway speech endpoints with no additional client credential.
- Optionally use OpenAI Realtime for an interruptible live conversation that delegates substantial
  work to Hermes through narrow, validated tools.
- Choose the model for one conversation without exposing provider onboarding or global Hermes
  configuration.
- Read previously viewed conversations when the gateway is temporarily unavailable.
- Use native SwiftUI and Jetpack Compose controls where platform behavior matters, with PanelUI for
  shared React Native surfaces.

## Screenshots

Every screen in both appearances, on both platforms.

<table>
  <thead>
    <tr>
      <th align="center">iOS light</th>
      <th align="center">iOS dark</th>
      <th align="center">Android light</th>
      <th align="center">Android dark</th>
    </tr>
  </thead>
  <tbody>
    <tr><td colspan="4" align="center"><strong>Sign in to Hermes</strong></td></tr>
    <tr>
      <td align="center"><img src="./docs/images/screenshots/ios-connect-light.png" width="200" alt="Wave sign-in screen on iOS in light appearance" /></td>
      <td align="center"><img src="./docs/images/screenshots/ios-connect-dark.png" width="200" alt="Wave sign-in screen on iOS in dark appearance" /></td>
      <td align="center"><img src="./docs/images/screenshots/android-connect-light.png" width="200" alt="Wave sign-in screen on Android in light appearance" /></td>
      <td align="center"><img src="./docs/images/screenshots/android-connect-dark.png" width="200" alt="Wave sign-in screen on Android in dark appearance" /></td>
    </tr>
    <tr><td colspan="4" align="center"><strong>Browse conversations</strong></td></tr>
    <tr>
      <td align="center"><img src="./docs/images/screenshots/ios-conversations-light.png" width="200" alt="Wave conversation drawer on iOS in light appearance" /></td>
      <td align="center"><img src="./docs/images/screenshots/ios-conversations-dark.png" width="200" alt="Wave conversation drawer on iOS in dark appearance" /></td>
      <td align="center"><img src="./docs/images/screenshots/android-conversations-light.png" width="200" alt="Wave conversation drawer on Android in light appearance" /></td>
      <td align="center"><img src="./docs/images/screenshots/android-conversations-dark.png" width="200" alt="Wave conversation drawer on Android in dark appearance" /></td>
    </tr>
    <tr><td colspan="4" align="center"><strong>Continue a chat</strong></td></tr>
    <tr>
      <td align="center"><img src="./docs/images/screenshots/ios-chat-light.png" width="200" alt="Wave chat on iOS in light appearance" /></td>
      <td align="center"><img src="./docs/images/screenshots/ios-chat-dark.png" width="200" alt="Wave chat on iOS in dark appearance" /></td>
      <td align="center"><img src="./docs/images/screenshots/android-chat-light.png" width="200" alt="Wave chat on Android in light appearance" /></td>
      <td align="center"><img src="./docs/images/screenshots/android-chat-dark.png" width="200" alt="Wave chat on Android in dark appearance" /></td>
    </tr>
    <tr><td colspan="4" align="center"><strong>Search conversations</strong></td></tr>
    <tr>
      <td align="center"><img src="./docs/images/screenshots/ios-search-light.png" width="200" alt="Wave conversation search on iOS in light appearance" /></td>
      <td align="center"><img src="./docs/images/screenshots/ios-search-dark.png" width="200" alt="Wave conversation search on iOS in dark appearance" /></td>
      <td align="center"><img src="./docs/images/screenshots/android-search-light.png" width="200" alt="Wave conversation search on Android in light appearance" /></td>
      <td align="center"><img src="./docs/images/screenshots/android-search-dark.png" width="200" alt="Wave conversation search on Android in dark appearance" /></td>
    </tr>
    <tr><td colspan="4" align="center"><strong>Choose the model for one chat</strong></td></tr>
    <tr>
      <td align="center"><img src="./docs/images/screenshots/ios-model-picker-light.png" width="200" alt="Wave per-conversation model picker on iOS in light appearance" /></td>
      <td align="center"><img src="./docs/images/screenshots/ios-model-picker-dark.png" width="200" alt="Wave per-conversation model picker on iOS in dark appearance" /></td>
      <td align="center"><img src="./docs/images/screenshots/android-model-picker-light.png" width="200" alt="Wave per-conversation model picker on Android in light appearance" /></td>
      <td align="center"><img src="./docs/images/screenshots/android-model-picker-dark.png" width="200" alt="Wave per-conversation model picker on Android in dark appearance" /></td>
    </tr>
    <tr><td colspan="4" align="center"><strong>Attach an image or file</strong></td></tr>
    <tr>
      <td align="center"><img src="./docs/images/screenshots/ios-attachments-light.png" width="200" alt="Wave composer attachment menu on iOS in light appearance" /></td>
      <td align="center"><img src="./docs/images/screenshots/ios-attachments-dark.png" width="200" alt="Wave composer attachment menu on iOS in dark appearance" /></td>
      <td align="center"><img src="./docs/images/screenshots/android-attachments-light.png" width="200" alt="Wave composer attachment menu on Android in light appearance" /></td>
      <td align="center"><img src="./docs/images/screenshots/android-attachments-dark.png" width="200" alt="Wave composer attachment menu on Android in dark appearance" /></td>
    </tr>
    <tr><td colspan="4" align="center"><strong>Talk through Hermes (gateway voice)</strong></td></tr>
    <tr>
      <td align="center"><img src="./docs/images/screenshots/ios-voice-gateway-light.png" width="200" alt="Wave gateway voice mode on iOS in light appearance" /></td>
      <td align="center"><img src="./docs/images/screenshots/ios-voice-gateway-dark.png" width="200" alt="Wave gateway voice mode on iOS in dark appearance" /></td>
      <td align="center"><img src="./docs/images/screenshots/android-voice-gateway-light.png" width="200" alt="Wave gateway voice mode on Android in light appearance" /></td>
      <td align="center"><img src="./docs/images/screenshots/android-voice-gateway-dark.png" width="200" alt="Wave gateway voice mode on Android in dark appearance" /></td>
    </tr>
    <tr><td colspan="4" align="center"><strong>Live voice with OpenAI Realtime</strong></td></tr>
    <tr>
      <td align="center"><img src="./docs/images/screenshots/ios-voice-realtime-light.png" width="200" alt="Wave Realtime live voice on iOS in light appearance" /></td>
      <td align="center"><img src="./docs/images/screenshots/ios-voice-realtime-dark.png" width="200" alt="Wave Realtime live voice on iOS in dark appearance" /></td>
      <td align="center"><img src="./docs/images/screenshots/android-voice-realtime-light.png" width="200" alt="Wave Realtime live voice on Android in light appearance" /></td>
      <td align="center"><img src="./docs/images/screenshots/android-voice-realtime-dark.png" width="200" alt="Wave Realtime live voice on Android in dark appearance" /></td>
    </tr>
    <tr><td colspan="4" align="center"><strong>Settings</strong></td></tr>
    <tr>
      <td align="center"><img src="./docs/images/screenshots/ios-settings-light.png" width="200" alt="Wave settings on iOS in light appearance" /></td>
      <td align="center"><img src="./docs/images/screenshots/ios-settings-dark.png" width="200" alt="Wave settings on iOS in dark appearance" /></td>
      <td align="center"><img src="./docs/images/screenshots/android-settings-light.png" width="200" alt="Wave settings on Android in light appearance" /></td>
      <td align="center"><img src="./docs/images/screenshots/android-settings-dark.png" width="200" alt="Wave settings on Android in dark appearance" /></td>
    </tr>
  </tbody>
</table>

Screenshots use privacy-safe fixture conversations served by the repository's local test gateway,
including its scripted voice scenarios for both voice modes.

## How it works

```text
Wave mobile ── rotating session tokens + gateway protocol ──> Hermes gateway
     │
     └════ direct WebRTC audio + sideband (user-owned key) ════> OpenAI Realtime API
```

Wave has no application backend of its own. Gateway sign-in is the only connection model, and the
Hermes API key never reaches the phone. If a user enables Realtime voice, their own OpenAI key is
validated before saving, stored only in device secure storage, and sent only to `api.openai.com`.

Realtime exposes two tightly scoped tools:

- `ask_hermes({ instruction })` delegates work to the conversation's trusted Hermes session.
- `correct_hermes({ instruction })` exists only while that delegated execution is active and can
  steer only that execution.

Arguments and responses are treated as untrusted data. Wave validates tool calls against explicit
schemas, preserves the user's intent and literal constraints, and reports completion only after
Hermes confirms it. See [Security](./docs/security.md) for the complete threat model and residual
risks.

## Product boundaries

Wave is intentionally a chat client, not a Hermes administration console. It does not manage
providers, credentials, global models, skills, server configuration, or infrastructure. Selecting
a model for one conversation is the narrow exception and remains session-scoped.

Wave supports iOS and Android only. React Native Web and server routes are out of scope.

## Tech stack

- [Expo SDK 57](https://docs.expo.dev/versions/v57.0.0/), React Native 0.86, and React 19.2
- [Expo Router](https://docs.expo.dev/versions/v57.0.0/router/introduction/) and `@expo/ui`
- [PanelUI](https://www.panelui.dev/docs), Uniwind, and Tailwind CSS v4
- TanStack Query for finite server state and focused controllers/reducers for active streams
- Zustand for versioned, device-local preferences only
- A runtime-neutral [`@wave/contracts`](./packages/contracts) workspace for normalized protocol
  schemas

## Getting started

### Requirements

- Node.js 24 LTS and npm
- Xcode for iOS development
- Android Studio for Android development
- A reachable Hermes gateway

Install dependencies and start the development Metro server:

```bash
nvm use
npm install
npm start
```

Wave uses native dependencies that are not present in a stock Expo Go installation. Build the
development client before first use and whenever native dependencies or app configuration change:

```bash
npm run prebuild:development
npm run run:development:ios
# or
npm run run:development:android -- --device
```

Sign in with the URL, username, and password used by the Hermes dashboard. Wave sends the password
only for sign-in and persists the gateway's rotating session tokens in platform secure storage.
Disconnect removes those local tokens; the gateway's stateless tokens cannot be individually
revoked.

See [Hermes connectivity](./docs/hermes-connectivity.md) for HTTPS requirements, private-network
development allowances, token rotation, and the normalized gateway contract.

### Build variants

`app.json` owns the production identity. The typed `app.config.ts` overlay gives local variants
distinct native identities so they can be installed side by side:

| Variant       | Display name     | Native identifier               | URL scheme     |
| ------------- | ---------------- | ------------------------------- | -------------- |
| `development` | `Wave (Dev)`     | `com.renanqueiroz.wave.dev`     | `wave-dev`     |
| `preview`     | `Wave (Preview)` | `com.renanqueiroz.wave.preview` | `wave-preview` |
| `production`  | `Wave`           | `com.renanqueiroz.wave`         | `wave`         |

Development is the safe default for local Expo commands. The repository's EAS scripts are
deliberately local-only:

```bash
npm run build:preview:android:local
npm run build:production:android:local
npm run build:production:ios:local
```

Generated native projects and build outputs are ignored. Do not commit signing credentials or
local artifacts.

### Android release pipeline

Every push to `main` runs [`release-apk`](./.github/workflows/release-apk.yml) on GitHub
Actions: it prebuilds the production variant, builds a signed, R8-optimized APK with Gradle
(no EAS involvement), and publishes it as a GitHub release tagged `v<version>-<versionCode>`
with `.sha256` and `.md5` sidecars. Builds target `arm64-v8a` only (`buildArchs` in
`app.json`): every supported phone is arm64, and dropping the three unused ABIs cuts the APK
from ~162 MB to ~57 MB while keeping one release asset the in-app updater can pick without
architecture logic. The version name is single-sourced from
`package.json` (`app.config.ts` injects it into the native build, the workflow reads it for the
tag and APK name, and `app.json` deliberately has no version field — bump one file and it
updates everywhere); the `versionCode` is the `main`-branch commit count, so every release
installs over its predecessors.

Release signing is injected at prebuild time by `plugins/with-android-release-signing.js` from
`WAVE_UPLOAD_*` environment variables; when they are absent (every local development flow) the
generated project keeps Expo's stock debug signing. The release keystore and its passwords
exist only in the repository's `release` GitHub environment — restricted to `main`, unreachable
from forks — and in the maintainer's offline backup. Losing the keystore orphans every
installed copy; committing it is never acceptable.

### Updating Wave on Android

Install the newest `wave-<version>.apk` from
[GitHub Releases](https://github.com/RenanQueiroz/wave-for-hermes/releases/latest) once; after
that the app updates itself. Production builds check the releases feed on launch (Settings →
Updates can turn the automatic check off) and the drawer's **Check for updates** row checks on
demand. When a newer `versionCode` exists, a sheet offers to download and install it: the
download is verified against the release's `.md5` sidecar and exact size, then handed to the
Android system installer — Wave closes during the install (the OS requires it) and the
installer's **Open** button relaunches the new version. The first update on a device asks for
Android's one-time "install unknown apps" permission. Android itself refuses any APK not signed
with Wave's release key, so a tampered feed cannot replace a real install. Dev and preview
clients have different application ids and never run the updater.

## Development tools

The repository includes two focused test systems:

- [`tools/voice-harness`](./tools/voice-harness/README.md) provides a deterministic fake Hermes
  gateway and scripted OpenAI Realtime peer for end-to-end chat and voice tests.
- [`tools/mobile-agent`](./tools/mobile-agent/README.md) provides device discovery, accessibility
  inspection, screenshots, gestures, logs, and production-bundle smoke tests.

Development builds also expose local WebRTC and streaming-PCM proofs under **Settings →
Development**. Their contracts and validation records live in
[WebRTC foundation](./docs/webrtc-foundation.md) and
[PCM playback foundation](./docs/pcm-playback-foundation.md).

## Validation

Run the repository checks before handing off a change:

```bash
npm run build:contracts
npm test
npm run lint
npm run typecheck
npm run verify:boundaries
npx expo install --check
npx expo-doctor
npm run mobile:smoke:production
```

The production smoke test exports both platforms and rejects credential-shaped literals in shipped
JavaScript bundles. The [dependency review](./docs/dependency-security.md) records current
SDK-compatibility and audit decisions.

## Contributing

Contributions are welcome. Read the [contributor guide](./CONTRIBUTING.md) and the product and
architecture constraints in [AGENTS.md](./AGENTS.md) before starting a change. Report suspected
vulnerabilities privately through the [security policy](./SECURITY.md), not in a public issue.

## Repository map

```text
src/app/              Expo Router routes and layouts
src/features/         Product behavior and feature-owned UI
src/services/gateway/ Raw Hermes protocol boundary and normalization
src/services/realtime OpenAI Realtime transport and orchestration
src/state/             Device-local preference state
packages/contracts/   Runtime-neutral Wave schemas
tools/                 Deterministic gateway and mobile test tooling
docs/                  Architecture, security, and validation records
```

Shared UI uses PanelUI semantic tokens. Settings, Connect, the chat composer, and the voice
screens keep explicit platform-native SwiftUI and Jetpack Compose implementations behind shared
behavior contracts. Read
[AGENTS.md](./AGENTS.md) before changing architecture or product boundaries.

## Documentation

- [Architecture and workspace boundaries](./docs/architecture.md)
- [Security model](./docs/security.md)
- [Vulnerability reporting policy](./SECURITY.md)
- [Contributor guide](./CONTRIBUTING.md)
- [Hermes gateway contract](./docs/hermes-connectivity.md)
- [Roadmap](./docs/roadmap.md)
- [Dependency and supply-chain review](./docs/dependency-security.md)
- [WebRTC foundation](./docs/webrtc-foundation.md)
- [Streaming PCM playback foundation](./docs/pcm-playback-foundation.md)

## License

Wave is available under the [MIT License](./LICENSE). The license preserves the notices for
retained Expo starter material and the official Expo skills committed in this repository.
Third-party native dependencies keep their own licenses; installed builds expose generated
acknowledgements under **Settings → Legal → Open-source licenses**.
