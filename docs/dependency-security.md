# Dependency security review

This is the current point-in-time review for Wave's Expo application, developer tooling, and
shared contracts. Re-run it before the first signed release and whenever the Expo SDK or
production dependencies change.

Reviewed: 2026-08-06.

## JavaScript dependency graph

`npm audit` reports 12 repository-wide moderate findings and no high or critical findings. Those
aggregate counts do not describe one runtime, so the dependency paths and reachability were
reviewed separately.

This review updated the seven packages reported by Expo Doctor to their SDK 57-compatible patch
versions: `expo@57.0.11`, `expo-asset@57.0.9`, `expo-build-properties@57.0.9`,
`expo-file-system@57.0.2`, `expo-image-picker@57.0.8`, `expo-router@57.0.11`, and
`expo-symbols@57.0.2`. The Expo patch includes `expo/fetch` stream-ordering, cancellation, and
teardown fixes used by Wave's gateway reads. Expo Doctor and `npx expo install --check` pass with
the two deliberate exclusions below.

The same review found the high-severity
[`js-yaml` advisory](https://github.com/advisories/GHSA-5p4m-2wfm-xmqj) in the shared Node tooling
copy used by ESLint and Expo's `xcpretty`. Every installed consumer accepts the patched 4.x line,
so the lockfile now resolves `js-yaml@4.3.1` without a manifest override. The high finding is gone;
`js-yaml` is build/development tooling and is not imported into the native production bundle.

The moderate production-labeled findings roll up through Expo's CLI/config packages and
`@expo/config-plugins -> xcode@3.0.1 -> uuid@7.0.3`. The
[uuid advisory](https://github.com/advisories/GHSA-w5hq-g745-h8pq) affects caller-supplied output
buffers in `v3()`, `v5()`, and `v6()`; it explicitly excludes `v4()`. The pinned `xcode` package
calls only `uuid.v4()` without a caller buffer, and this build-time graph is absent from native
production bundles. Forcing `uuid@11.1.1` would cross the major range
supported by Expo's pinned `xcode` package, so Wave will take Expo's supported transitive update
instead of adding an unvalidated override.

`react-native-legal@1.6.3` adds one additional moderate audit rollup because its Expo config plugin
also uses `xcode@3.0.1`; it does not add another underlying advisory. Its license scanner also
depends on deprecated `glob@7.2.3`, but the installed graph resolves the affected matching helpers
to `minimatch@3.1.5` and the bounded `brace-expansion@1.1.18`. These Node packages run while
generating acknowledgements during Prebuild and are not imported into the React Native production
bundle. The generated native acknowledgement data includes runtime transitive and optional
dependencies while excluding root development dependencies.

The production audit scoped to `@wave/contracts` reports zero findings:

```bash
npm audit --omit=dev --workspace @wave/contracts
```

`npx expo install --check`, both native production export scans, and the normal repository gates
remain required. Do not use `npm audit fix --force`: its proposed Expo 46 and splash-screen 55
changes are incompatible with the SDK 57 source-of-truth graph.

Two native packages deliberately sit ahead of Expo SDK 57's bundled dependency map:
`react-native-gesture-handler` 3.1.0 and `react-native-keyboard-controller` 1.22.2. Both are explicit
`expo.install.exclude` entries rather than silent check failures. Keep their focused iOS and
Android gesture, drawer, swipe-back, composer, and keyboard validation gates; remove each
exclusion when Expo's supported map catches up.

## Accepted residual work

- Take Expo's supported `xcode`/`uuid` update when it enters the SDK 57 line or during a deliberate
  SDK upgrade.
- Repeat the scoped production audit immediately before signed store builds.
