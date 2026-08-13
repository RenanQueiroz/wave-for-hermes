# Dependency security review

This is the current point-in-time review for Wave's Expo application, repository-local developer
tools, and shared contracts. Re-run it before the first signed release and whenever the Expo SDK or
production dependencies change.

Reviewed: 2026-08-12.

## Application dependency graph

`npm audit --omit=dev` reports 25 aggregate findings: 17 high, 8 moderate, and no critical
findings. The aggregate count expands dependency effects into separate rows; the installed graph
contains three underlying advisories, reviewed below.

Two high-severity advisories affect `image-size@1.2.1`, which Metro uses while processing local
image assets:

- [ICNS parser infinite loop](https://github.com/advisories/GHSA-w3rx-r6r6-pgpr)
- [JXL and HEIF parser infinite loops](https://github.com/advisories/GHSA-5p2g-fcmc-qvqq)

There is no patched `image-size` release as of this review. The package is build tooling under
Metro: it is not imported by Wave application code or included as a native runtime dependency, and
the build processes only version-controlled, maintainer-reviewed assets rather than remote or
user-supplied images. The 17 high audit rows are rollups from these two advisories through Metro,
React Native, Uniwind, and PanelUI. Do not replace Expo's Metro graph with an unsupported override;
take the SDK-supported patch as soon as one is available.

The eight moderate rows roll up from
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

The current dependency refresh also moved `panelui-native` from 0.49.0 to 0.63.0,
`react-native-keyboard-controller` from 1.22.2 to 1.22.3, and Zustand from 5.0.14 to 5.0.15.
`react-native-gesture-handler@3.1.0` and `react-native-audio-api@0.13.2` were already the latest
stable releases, so their validated versions remain unchanged. Expo's SDK 57 compatibility map
still requires the documented Gesture Handler and Keyboard Controller exclusions.

The production audit scoped to `@wave/contracts` reports zero findings:

```bash
npm audit --omit=dev --workspace @wave/contracts
```

## Repository-local tools

`tools/voice-harness` reports zero production audit findings.

The mobile-agent toolchain now uses `appium-mcp@1.92.2`,
`appium-xcuitest-driver@12.3.2`, `@xmldom/xmldom@0.9.11`, `ws@8.21.3`, and the current Node
types. TypeScript stays on 6.0.3 because TypeScript 7's platform compiler package was not restored
reliably by a clean npm install in this larger tool graph. Its standard `npm audit` still reports
six high rows, all from one underlying
[`extract-zip` symlink traversal advisory](https://github.com/advisories/GHSA-jmr9-qjv8-65gv)
through `appium-mcp -> webdriver -> @wdio/utils -> @puppeteer/browsers`. This repository-local
automation tool is never bundled into Wave or installed on a user's device. The affected browser
archive path is not used by Wave's native Appium smoke workflows, and the current upstream graph
offers no compatible patched version. Do not accept npm's proposed breaking downgrade of
`appium-mcp`; update the validated toolchain when its upstream dependency moves to a fixed archive
extractor.

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
