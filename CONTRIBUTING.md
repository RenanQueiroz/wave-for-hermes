# Contributing to Wave

Thanks for helping improve Wave. The project is under active development, so focused changes with
clear validation are easier to review and keep reliable.

## Before opening a change

- Read the product boundaries and repository conventions in [`AGENTS.md`](./AGENTS.md).
- Check the existing issues and roadmap before starting substantial work.
- Open an issue for a large feature, dependency migration, or architectural change so its scope can
  be agreed before implementation.
- Report security vulnerabilities privately according to [`SECURITY.md`](./SECURITY.md), not in a
  public issue.

Wave is a conversation and live-voice client for Hermes. Provider onboarding, server
administration, global Hermes configuration, and a Wave-owned backend are deliberately out of
scope.

## Development setup

Use Node.js 24 LTS and npm:

```bash
nvm use
npm install
npm start
```

Wave uses native dependencies, so Expo Go is not sufficient. Build a development client before
first use and after native dependency or app-configuration changes:

```bash
npm run prebuild:development
npm run run:development:ios
# or
npm run run:development:android -- --device
```

Keep credentials, signing material, local gateway details, and build artifacts out of commits.
Use the deterministic voice harness and mobile tooling described in the
[`README`](./README.md#development-tools) when a change needs end-to-end coverage.

## Implementation guidelines

- Use the exact Expo SDK 57 documentation and install Expo/React Native dependencies with
  `npx expo install`.
- Keep shared behavior shared, but preserve explicit iOS and Android implementations where native
  controls or behavior differ.
- Use PanelUI semantic tokens for shared UI; verify light and dark themes on both platforms for
  visual changes.
- Keep raw gateway protocol data behind `src/services/gateway` and validate every untrusted
  boundary.
- Add deterministic tests for behavior changes and stable accessibility identifiers for meaningful
  controls.
- Update documentation in the same change when setup, behavior, architecture, security, or
  validation requirements change.

## Validation

Run the repository gates before opening a pull request:

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

Also exercise affected behavior on both iOS and Android. Native dependency or app-configuration
changes require clean Prebuild, both native builds, and the relevant device flows.

## Pull requests

Keep each pull request focused and explain:

- the user-visible or maintenance outcome;
- important design or security decisions;
- the automated checks and device scenarios run;
- any known limitation or follow-up work.

Do not combine unrelated cleanup with a behavioral change. Prefer concise commits that leave the
repository buildable and reviewable at each step.
