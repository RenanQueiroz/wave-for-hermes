# Dependency security review

This is the current point-in-time review for Wave's Expo application, repository-local developer
tools, and shared contracts. Re-run it before the first signed release and whenever the Expo SDK or
production dependencies change.

Reviewed: 2026-08-22.

## Application dependency graph

`npm audit --omit=dev` reports 23 aggregate findings: 11 high, 12 moderate, and no critical
findings. The aggregate count expands dependency effects into separate rows; the installed graph
contains three underlying advisories, reviewed below.

Two high-severity advisories affect `image-size@1.2.1`, which Metro uses while processing local
image assets:

- [ICNS parser infinite loop](https://github.com/advisories/GHSA-w3rx-r6r6-pgpr)
- [JXL and HEIF parser infinite loops](https://github.com/advisories/GHSA-5p2g-fcmc-qvqq)

There is no patched `image-size` release as of this review. The package is build tooling under
Metro: it is not imported by Wave application code or included as a native runtime dependency, and
the build processes only version-controlled, maintainer-reviewed assets rather than remote or
user-supplied images. The 11 high audit rows are rollups from these two advisories through Metro,
React Native, Uniwind, and PanelUI. Do not replace Expo's Metro graph with an unsupported override;
take the SDK-supported patch as soon as one is available.

The twelve moderate rows roll up from
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
build and an Xcode simulator build passed with the new native modules. One deliberate deviation:
`expo-modules-core` is pinned to 57.0.11 through an npm `overrides` entry because the 57.0.12
binary that `expo` 57.0.15 pulls breaks
`matchContents` SwiftUI Host sizing in Wave (drawer header/footer collapse, composer overflow,
untappable Host content — see the exception in `AGENTS.md`). The package ships as Expo's prebuilt
xcframework, so this is a version pin rather than a source patch; lift it when an upstream
release fixes the sizing.

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
- Take the upstream Appium/Webdriver archive-extraction fix when it is available without a toolchain
  downgrade.
- Repeat application, contracts, voice-harness, and mobile-agent audits immediately before signed
  store builds.
