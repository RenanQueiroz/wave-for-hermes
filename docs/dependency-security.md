# Dependency security review

This is the current point-in-time review for Wave's Expo application, repository-local developer
tools, and shared contracts. Re-run it before the first signed release and whenever the Expo SDK or
production dependencies change.

Reviewed: 2026-08-22.

## Application dependency graph

`npm audit --omit=dev` reports 20 aggregate findings: 5 high, 15 moderate, and no critical
findings. The aggregate count expands dependency effects into separate rows; the installed graph
contains three underlying advisories, reviewed below.

Two high-severity advisories affect `image-size@1.2.1`, which Metro uses while processing local
image assets:

- [ICNS parser infinite loop](https://github.com/advisories/GHSA-w3rx-r6r6-pgpr)
- [JXL and HEIF parser infinite loops](https://github.com/advisories/GHSA-5p2g-fcmc-qvqq)

There is no patched `image-size` release as of this review. The package is build tooling under
Metro: it is not imported by Wave application code or included as a native runtime dependency, and
the build processes only version-controlled, maintainer-reviewed assets rather than remote or
user-supplied images. The high audit rows are rollups from these two advisories through Metro,
React Native, Uniwind, and PanelUI. Do not replace Expo's Metro graph with an unsupported override;
take the SDK-supported patch as soon as one is available.

A moderate advisory,
[`decode-uri-component` denial of service via exponential decoding of malformed percent-encoded
input](https://github.com/advisories/GHSA-vcc3-ghjq-m6fr), entered the graph with the SDK 57.0.19
pass through `expo-router -> query-string@7.1.3 -> decode-uri-component@0.2.2`. Unlike the other
two this is shipped application code — expo-router's deep-link URL parsing. It is accepted rather
than remediated, because no remediation exists that does not break the app:

- `npm audit fix --force` proposes `expo-router@5.1.11`, a multi-major downgrade incompatible with
  SDK 57 and forbidden by the policy below.
- An `overrides` entry cannot help: the advisory covers `<= 0.4.2`, so the only fixed release is
  `0.5.0`, which is ESM-only (`"type": "module"`) while `query-string@7.1.3` is CommonJS and
  `require()`s it. Forcing it would fail at runtime under Metro.
- `expo-router@57.0.18` still depends on `query-string@^7.1.3`, so the SDK bump does not clear it.

Exposure is a malformed percent-encoded deep link that the user must open; the impact is a
client-side hang, not disclosure or code execution. Re-evaluate when expo-router moves off
`query-string@7`.

The remaining moderate rows roll up from
[`uuid`](https://github.com/advisories/GHSA-w5hq-g745-h8pq) through Expo config plugins and
`react-native-legal -> xcode@3.0.1`. The advisory affects caller-supplied output buffers in `v3()`,
`v5()`, and `v6()` and explicitly excludes `v4()`. The installed `xcode` package calls only
`uuid.v4()` without a caller buffer. This graph runs during Prebuild to generate native projects
and open-source acknowledgements; it is not part of the native application runtime. Forcing
`uuid@11.1.1` would cross the major range supported by the pinned `xcode` package, so Wave will take
the supported upstream update instead.

This review refreshed the lockfile from vulnerable `nanoid@3.3.16` to `3.3.18`, which is accepted by
Expo Router and PostCSS's existing ranges and fixes the zero-size custom-generator denial of
service. That lock-only remediation did not change an application manifest range or native
dependency.

The 2026-08-22 refresh moved every Expo-managed package to its SDK 57 recommendation (`expo`
57.0.15, `expo-router` 57.0.15, `@expo/ui` 57.0.12, `expo-dev-client` 57.0.14, `expo-audio`
57.0.4, `expo-file-system` 57.0.5, `expo-image` 57.0.3, `expo-image-picker` 57.0.12,
`expo-splash-screen` 57.0.7, and the other flagged modules) and the non-Expo application
dependencies to their latest releases: `panelui-native` 0.63.0 → 0.79.1, `@tanstack/react-query`
and its persist client 5.101.4 → 5.102.0, `@legendapp/list` 3.3.5 → 3.3.8, `uniwind` 1.10.1 →
1.11.0, `react-native-legal` 1.6.3 → 1.6.5, `react-native-gesture-handler` 3.1.0 → 3.2.1, and
`react-native-keyboard-controller` 1.22.3 → 1.22.4 (the last two stay in `expo.install.exclude`
because Expo's SDK 57 map still recommends 2.32 and 1.21.9). `react-native-webrtc` 124.0.8 is the
latest published release. `react-native-audio-api` stays at the device-validated 0.13.2 (0.13.3
exists; the upgrade policy below requires physical listening on both platforms first). Dev
tooling stays on ESLint 9.39.5 and TypeScript 6.0.3: `eslint-plugin-import` and
`eslint-plugin-react` still cap their ESLint peer at 9, and `typescript-eslint` caps TypeScript
below 6.1. The local `eas-cli` pin in the root scripts moved to 22.2.0. Zod, Zustand, Tailwind,
Prettier, and the Expo ESLint config were already current. Clean Prebuild plus a Gradle debug
build and an Xcode simulator build passed with the new native modules. The `expo-modules-core` `overrides` pin is gone as of the SDK 57.0.19 pass: 57.0.13 shipped
[expo/expo#49211](https://github.com/expo/expo/pull/49211), the fix for the `matchContents`
SwiftUI Host sizing regression the pin existed for, and 57.0.14 and 57.0.15 fixed the adjacent
hosted-view measurement and Host/`RNHostView` size-feedback cases. The package resolves through
`expo` itself at ~57.0.15. The lift was verified visually on the iOS 26.5 simulator from a clean
Prebuild: the drawer header Host measures 208pt and its footer 44pt (both collapsed to ~9pt under
the bug), and the composer island, chat header, and empty-state overlay all render correctly.

The production audit scoped to `@wave/contracts` reports zero findings:

```bash
npm audit --omit=dev --workspace @wave/contracts
```

## Repository-local tools

`tools/voice-harness` reports zero production audit findings.

The mobile-agent toolchain now uses `appium-mcp@1.92.5`,
`appium-xcuitest-driver@12.7.0` (which nests `appium-webdriveragent` 16.5.1; the prebuilt
simulator runner checksums in `tools/mobile-agent/src/wda.ts` are re-pinned to that release's
published assets), `@xmldom/xmldom@0.9.12`, `ws@8.21.3`, and the current Node types. TypeScript
stays on 6.0.3 because TypeScript 7's platform compiler package was not restored reliably by a
clean npm install in this larger tool graph (and the lint toolchain caps it below 6.1). Its
standard `npm audit` reports seven high rows from two underlying advisories: the
[`extract-zip` symlink traversal advisory](https://github.com/advisories/GHSA-jmr9-qjv8-65gv)
through `appium-mcp -> webdriver -> @wdio/utils -> @puppeteer/browsers`, and the
[`deepmerge-ts` recursive-graph stack exhaustion advisory](https://github.com/advisories/GHSA-ggr8-5vv4-36mx)
through `appium-mcp -> webdriver -> @wdio/config`. This repository-local automation tool is never
bundled into Wave or installed on a user's device. The affected browser archive path is not used
by Wave's native Appium smoke workflows, the WebdriverIO config merge only ever sees the tool's own
static capability objects, and the current upstream graph offers no compatible patched version for
either. Do not accept npm's proposed breaking downgrade of `appium-mcp`; update the validated
toolchain when its upstream dependencies move to fixed releases.

## Validation and upgrade policy

- `npx expo install --check` and Expo Doctor must pass after dependency changes.
- Production exports for both platforms must pass the bundle boundary and credential-literal
  scanner.
- Native dependency changes require clean Prebuild, both native builds, and affected device flows.
- Do not run `npm audit fix --force`. Its proposed Expo, React Native, and local-tool downgrades are
  outside the SDK 57 compatibility graph.
- Keep the deliberate `react-native-gesture-handler` and
  `react-native-keyboard-controller` Expo-install exclusions until Expo's supported map catches up.
- Keep `react-native-audio-api` exact until an upgrade passes clean native builds and repeated
  physical listening on both platforms.

## Accepted residual work

- Take Expo's supported Metro/`image-size` and `xcode`/`uuid` updates when they enter SDK 57 or
  during a deliberate SDK upgrade.
- Re-evaluate `decode-uri-component` when `expo-router` moves off `query-string@7` (see below).
- Revisit TypeScript 7 and ESLint 10 once their plugin ecosystems support them (see below).
- Take the upstream Appium/Webdriver archive-extraction fix when it is available without a toolchain
  downgrade.

### Deferred major upgrades

- **TypeScript 7.** `tsc --noEmit` is already clean on both the app and `@wave/contracts` under
  7.0.2, `moduleSuffixes` included, so the codebase is ready. The blocker is lint:
  `@typescript-eslint/parser@8.69.0` (pulled by `eslint-config-expo`) declares
  `typescript: ">=4.8.4 <6.1.0"` and there is no v9 line, so adopting TypeScript 7 would run
  `expo lint` on an unsupported compiler. Re-check when typescript-eslint ships TS 7 support.
- **ESLint 10.** `eslint-config-expo` itself allows `>=8.10`, but two of its own plugin
  dependencies cap below 10: `eslint-plugin-import@2.32.0` peers `... || ^9` and
  `eslint-plugin-react@7.37.5` peers `... || ^9.7`. Stay on the 9.x maintenance line.
- **`react-native-audio-api` 0.13.3.** Not a no-op: it restructures the iOS podspec's
  prebuilt-binary hydration into a `:before_headers` script phase, and changes `AudioParam` so
  assigning `.value` also calls `setValueAtTime` — which lands on the gain-fade path the Pixel
  listening runs validated. Upgrade only as its own task with a clean Prebuild on both platforms
  and repeated physical listening.
- Repeat application, contracts, voice-harness, and mobile-agent audits immediately before signed
  store builds.
