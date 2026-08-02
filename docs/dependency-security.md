# Dependency and container security review

This is the current point-in-time review for Wave's Expo application, developer tooling, and
shared contracts. Re-run it before the first signed release and whenever the Expo SDK or
production dependencies change.

Reviewed: 2026-07-31. The Companion image review below is retained as the historical record of
that review; the companion workspace and its container were removed in stage 5 of the
direct-to-gateway migration (2026-08-02), so the image, its base-image pins, and its scoped
audit are no longer part of the release process.

## JavaScript dependency graph

`npm audit` reports 20 repository-wide findings: 9 high and 11 moderate. Those aggregate counts do
not describe one runtime, so the dependency paths and reachability were reviewed separately.

The high findings are in ESLint's development-only `minimatch -> brace-expansion` paths.
`brace-expansion` 1.1.16 lacked the output-length bound for
[CVE-2026-14257](https://github.com/advisories/GHSA-mh99-v99m-4gvg). The lockfile now resolves all
compatible 1.x paths to 1.1.18 and the modern path to 5.0.9; both contain the bound. npm's advisory
range currently continues to group the backported 1.x version into the finding, so the aggregate
audit count remains high even though the installed code contains the fix.

The moderate production-labeled findings roll up through Expo's CLI/config packages and
`@expo/config-plugins -> xcode@3.0.1 -> uuid@7.0.3`. The
[uuid advisory](https://github.com/advisories/GHSA-w5hq-g745-h8pq) affects caller-supplied output
buffers in `v3()`, `v5()`, and `v6()`; it explicitly excludes `v4()`. The pinned `xcode` package
calls only `uuid.v4()` without a caller buffer, and this build-time graph is absent from native
production bundles. Forcing `uuid@11.1.1` would cross the major range
supported by Expo's pinned `xcode` package, so Wave will take Expo's supported transitive update
instead of adding an unvalidated override.

The production audit scoped to `@wave/contracts` reports zero findings:

```bash
npm audit --omit=dev --workspace @wave/contracts
```

`npx expo install --check`, both native production export scans, and the normal repository gates
remain required. Do not use `npm audit fix --force`: its proposed Expo 46 and splash-screen 55
changes are incompatible with the SDK 57 source-of-truth graph.

## Companion image (historical — removed in stage 5)

The prior digest-pinned Debian slim runtime measured 91,033,033 bytes. A checksum-verified Trivy
0.70.0 scan found 22 high/critical Debian findings without available Debian fixes plus five
fixable findings in npm's bundled packages. The Companion does not execute a package manager in
production.

The final runtime now uses the exact official Node 24 Alpine image digest declared in
`companion/Dockerfile` and removes npm, npx, corepack, yarn, and pnpm before application files are
copied. Build stages remain on the separate digest-pinned Debian image. The selected Companion and
contracts production graph contains no native `.node` binaries, and the rebuilt runtime starts on
Node 24.18.1.

The rebuilt image measured 69,389,962 bytes, a 23.8% reduction. The same Trivy database found zero
OS or language-package vulnerabilities at any severity. This does not turn one clean scan into a
permanent guarantee; Homelab must continue to pin the exact source and base images, and the scan
must be repeated after either pin changes.

## Accepted residual work

- Take Expo's supported `xcode`/`uuid` update when it enters the SDK 57 line or during a deliberate
  SDK upgrade.
- Recheck npm advisory metadata for the fixed `brace-expansion` 1.x backport.
- Repeat the scoped production audit immediately before signed store builds.
