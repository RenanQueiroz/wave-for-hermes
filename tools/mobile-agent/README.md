# Wave mobile agent

This repository-local MCP controls and inspects the Wave Expo development build managed
by Radon IDE. It composes the public `appium-mcp/core` extension API with Radon-aware iOS
discovery, ADB discovery, native accessibility/UIAutomator trees, native input,
Metro/Hermes observability, and an opt-in development state bridge.

It does not require a paid Radon MCP license and does not modify Radon itself.

## Setup

From the repository root:

```sh
npm run mobile:install
npm run mobile:doctor
npm run mobile:prepare:ios
```

Keep Wave open in Radon so its Metro/Hermes target is available. The project already
contains repository-scoped definitions for both clients:

- Codex: `.codex/config.toml`
- Claude Code: `.mcp.json`

Restart the client after installing dependencies. Claude Code asks for one-time approval
of the shared project MCP; approve `wave-mobile-agent` when prompted. The config invokes
`npm` with relative arguments and works on Windows, macOS, and Linux, although iOS
automation itself requires macOS/Xcode.

## Typical MCP workflow

1. Call `mobile_doctor`.
2. On iOS, call `mobile_prepare_ios_wda` once if the verified runner is not cached.
3. Call `mobile_get_capabilities` for `ios` or `android`.
4. Pass the complete capabilities object to `appium_session_management` with
   `action=create`.
5. Inspect with `mobile_get_element_tree`; query with `mobile_find_elements`.
6. Use `mobile_tap` for snapshot-safe native taps. Appium's built-in gesture, text,
   lifecycle, deep-link, screenshot, and key tools cover the remaining native actions.
7. Query JavaScript logs, network activity, native logs, or registered development state.
8. Delete the Appium session when finished. Disconnect cleanup also deletes any owned
   session.

The MCP server adds these Wave-specific tools to Appium's standard tool set:

- Environment: `mobile_doctor`, `mobile_list_devices`, `mobile_get_capabilities`,
  `mobile_prepare_ios_wda`
- Native UI: `mobile_get_element_tree`, `mobile_find_elements`, `mobile_tap`
- Artifacts: `mobile_prune_artifacts`
- Observability: `mobile_observability_status`, `mobile_get_logs`,
  `mobile_get_network_requests`, `mobile_get_network_request`,
  `mobile_get_native_logs`, `mobile_clear_observability`
- Controlled diagnostics: `mobile_run_observability_probe`
- Development state: `mobile_list_state_providers`, `mobile_read_state`

## CLI commands

Run these from `tools/mobile-agent`, or use the corresponding `mobile:*` root scripts:

```sh
npm run doctor
node dist/cli.js doctor --json
node dist/cli.js devices
node dist/cli.js capabilities --platform ios
npm run prepare:ios
npm run prune:artifacts
npm run prune:artifacts -- --confirm
npm run smoke:android
npm run smoke:ios
npm run smoke:observability -- --platform android
npm run smoke:production
npm run check
npm run mcp
```

`smoke:android` and `smoke:ios` create and remove an Appium session on the currently
selected Radon device without terminating the running app. `smoke:observability` verifies
Hermes logs, fetch metadata, the development state provider, and platform-native logs
without creating an Appium session.
It auto-selects the platform only when exactly one is ready. If multiple Wave Hermes
targets are connected, pass `--target-id` using an ID reported by `mobile_doctor`.
`smoke:production` creates ignored iOS and Android production exports and verifies
that the development state bridge is absent from both native bundles.

Native devices are auto-selected only when exactly one eligible device is visible.
When Radon has multiple simulators running, select one explicitly without hardcoding it
in the repository:

```sh
MOBILE_AGENT_IOS_UDID="<simulator-udid>" npm run mobile:doctor
MOBILE_AGENT_ANDROID_SERIAL="<adb-serial>" npm run mobile:doctor
```

The same environment variables apply to the MCP process. Use `mobile_list_devices` to
obtain the current dynamic identifiers.

## Safety model

- Discovery never boots, erases, installs, uninstalls, or resets a device.
- The selected device must be unique or explicitly named by dynamic ID. The agent never
  silently switches devices.
- iOS targets Radon's alternate CoreSimulator device set explicitly.
- iOS preparation downloads Appium's pinned prebuilt WebDriverAgent release and verifies
  its architecture-specific SHA-256 before extraction.
- Capabilities preserve the installed development build and app data (`noReset`).
- Snapshot actions reject stale IDs. Coordinate taps require an explicit opt-in.
- Normalized taps capture local before/after screenshots and hierarchies by default.
  Set `captureTrace=false` for an individual tap to opt out.
- Hermes buffers are bounded. Authorization, cookies, tokens, passwords, and common
  secret fields are redacted before storage.
- Response bodies are off by default and limited to text/JSON under 64 KiB when
  explicitly requested.
- Native logs are filtered to Wave's current process ID and redacted before return.
- Arbitrary JavaScript evaluation and arbitrary shell execution are not exposed.
- The state bridge exists only under `__DEV__`; production export verification checks
  that its bridge key and provider are absent.
- Screenshots, WebDriverAgent, exports, and other generated evidence live under the
  ignored `.mobile-agent/` directory.
- Action traces are automatically bounded to 50 entries and seven days. Override with
  `MOBILE_AGENT_TRACE_MAX_COUNT` and `MOBILE_AGENT_TRACE_MAX_AGE_DAYS`. Artifact pruning
  only removes generated directories under `.mobile-agent/traces`; the CLI previews
  removals unless `--confirm` is present, and the MCP tool requires `confirm=true`.

## State providers

Application code may register a read-only provider:

```ts
registerMobileAgentStateProvider({
  name: 'example',
  read: () => ({ ready: true }),
});
```

Only registered names can be read. Returned values must be JSON serializable and are
subject to recursive redaction, maximum depth, and maximum byte size. There is no state
mutation API.

## Troubleshooting

- `No Wave Hermes inspector target`: open or relaunch Wave in Radon and wait for the
  development bundle to load.
- Hermes commands time out after an Android automation session: relaunch the development
  client. The agent rejects the stale inspector connection and reconnects to the fresh target.
- `No unique booted Radon iOS simulator`: set `MOBILE_AGENT_IOS_UDID` to a booted
  simulator reported by `mobile_list_devices`. `MOBILE_AGENT_IOS_DEVICE_SET` selects
  Radon's CoreSimulator set, not an individual simulator.
- `Multiple Android devices`: set `MOBILE_AGENT_ANDROID_SERIAL` to the intended online
  ADB serial reported by `mobile_list_devices`.
- Android CMake fails with a restricted Java method warning: restart the Radon launch
  configuration so its `envCommand` can select JDK 17 or Android Studio's bundled JDK 21.
- Appium cannot find the app: confirm `com.renanqueiroz.wave` is installed on the device
  reported by `mobile_doctor`.
- Android is unavailable: start the Radon Android emulator, install/launch Wave there,
  and rerun the doctor.
- Claude shows `Pending approval`: start Claude Code in this repository and approve the
  shared `wave-mobile-agent` server.

## Upgrade checklist

The automation package is intentionally isolated from Expo dependencies. When upgrading:

1. Keep `appium-mcp` and driver versions exact.
2. Review `npm audit` rather than applying forced or major-version fixes blindly.
3. Run `npm run mobile:check`.
4. Run the iOS native and observability smoke tests.
5. Run the Android native and observability smoke tests.
6. Re-run the production export bridge-exclusion check.
