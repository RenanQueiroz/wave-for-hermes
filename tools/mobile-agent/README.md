# Wave mobile agent

This repository-local MCP controls and inspects the Wave Expo development build managed
by Radon IDE. It composes the public `appium-mcp/core` extension API with Radon-aware iOS
discovery, ADB discovery, native accessibility/UIAutomator trees, native input,
Metro/Hermes observability, and an opt-in development state bridge.

It does not require a paid Radon MCP license and does not modify Radon itself.

## Architecture and design decisions

```text
Codex / Claude Code
        |
        | MCP over stdio
        v
Wave mobile-agent plugin + Appium MCP core
        |
        +--> XCUITest --------> Radon's private iOS device set
        +--> UiAutomator2 ----> Radon's ADB-visible Android emulator
        +--> Hermes CDP ------> Metro console, network, reload, development state
        +--> Native commands -> on-demand iOS and Android process logs
```

Radon remains responsible for starting Metro and managing its simulator or emulator. The
mobile agent discovers and attaches to those existing resources; it does not replace,
erase, boot, or silently switch them.

The integration deliberately uses public platform and Appium interfaces rather than
Radon's paid MCP implementation or its private extension internals. Expo MCP could discover
the ordinary CoreSimulator set, but Radon manages iOS in an alternate device set. An
`xcrun` shim was sufficient for basic `simctl` operations but not XCTest: `xcodebuild`
could not resolve the Radon-private simulator as an eligible destination. XCUITest's
official `appium:simulatorDevicesSetPath` capability is therefore a required architectural
boundary, not a convenience.

Other durable choices:

- `appium-mcp` and its native drivers are installed only in this isolated tooling package
  and pinned exactly. Do not install a mutable global Appium stack or import
  `appium-mcp` internals; use its public `appium-mcp/core` plugin API.
- Device IDs, Metro ports, runtime versions, process IDs, and app-container paths are
  ephemeral. Discover them at runtime and require explicit selection when more than one
  eligible target exists.
- MCP uses stdio. Do not expose Appium or an automation listener on a LAN interface.
- Native logs are queried on demand from Wave's current process with strict time/count
  bounds. This follows PID changes naturally and avoids persistent `log stream` or
  `logcat` child processes.
- The automation package stays independent of the Expo application's dependency graph.
  Mobile-agent maintenance must not upgrade Expo, React Native, or app dependencies.

Current scope is Radon-managed iOS simulators and Android emulators for local development.
Physical iOS automation, production monitoring, arbitrary application-state access, and
replacement of end-to-end suites such as Maestro or Detox are outside this integration.
Possible future extensions—not missing implementation phases—are React component-tree
inspection, bounded video or screenshot-sequence capture, and deterministic action replay.

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
automation itself requires macOS/Xcode. On Android, the server discovers `adb` first and
exports its SDK root before loading Appium, so a standard Android Studio installation does
not require `ANDROID_HOME` to be exported into the editor process.

## Typical MCP workflow

1. Call `mobile_doctor`.
2. On iOS, call `mobile_prepare_ios_wda` once if the verified runner is not cached.
3. Call `mobile_get_capabilities` for `ios` or `android`.
4. Pass the complete capabilities object to `appium_session_management` with
   `action=create`.
5. Inspect with `mobile_get_element_tree`; query with `mobile_find_elements`.
6. Use the Wave action tools for snapshot-safe gestures, text, navigation, lifecycle,
   and deep links. They all return the unified action envelope described below.
7. Call `mobile_reload` when Wave needs a JavaScript reload without restarting Radon.
8. Query JavaScript logs, network activity, native logs, or registered development state.
9. Delete the Appium session when finished. Disconnect cleanup also deletes any owned
   session.

The MCP server adds these Wave-specific tools to Appium's standard tool set:

- Environment: `mobile_doctor`, `mobile_list_devices`, `mobile_get_capabilities`,
  `mobile_prepare_ios_wda`
- Native UI: `mobile_get_element_tree`, `mobile_find_elements`
- Unified actions: `mobile_tap`, `mobile_long_press`, `mobile_type_text`,
  `mobile_clear_text`, `mobile_swipe`, `mobile_scroll`, `mobile_drag`,
  `mobile_press_key`, `mobile_app_lifecycle`, `mobile_open_deep_link`,
  `mobile_reload`
- Artifacts: `mobile_prune_artifacts`
- Observability: `mobile_observability_status`, `mobile_get_logs`,
  `mobile_get_network_requests`, `mobile_get_network_request`,
  `mobile_get_native_logs`, `mobile_clear_observability`, `mobile_reload`
- Controlled diagnostics: `mobile_run_observability_probe`
- Development state: `mobile_list_state_providers`, `mobile_read_state`

Appium's standard tools remain registered as a lower-level fallback. Prefer the Wave tools
for normal agent work because they enforce current-snapshot checks where applicable and
return one machine-readable contract:

```json
{
  "ok": true,
  "action": "tap",
  "platform": "ios",
  "deviceId": "<dynamic-device-id>",
  "applicationId": "com.renanqueiroz.wave",
  "sessionId": "<appium-session-id>",
  "startedAt": "2026-07-29T20:00:00.000Z",
  "completedAt": "2026-07-29T20:00:00.500Z",
  "durationMs": 500,
  "target": {},
  "beforeSnapshotId": "<snapshot-id>",
  "afterSnapshotId": "<snapshot-id>",
  "result": {},
  "trace": {},
  "warnings": []
}
```

Failed actions return `ok=false`, the attempted action and any identity/target already
resolved, `durationMs`, and an `error` object with a stable `code`, `message`, and optional
`recovery`. `sessionId`, snapshot IDs, and trace are omitted when they do not apply.

## CLI commands

Run these from `tools/mobile-agent`, or use the corresponding `mobile:*` root scripts:

```sh
npm run doctor
node dist/cli.js doctor --json
node dist/cli.js devices
node dist/cli.js capabilities --platform ios
npm run prepare:ios
npm run reload -- --platform ios
npm run prune:artifacts
npm run prune:artifacts -- --confirm
npm run smoke:android
npm run smoke:ios
npm run smoke:pairing -- --platform android
npm run smoke:chat -- --platform android
npm run smoke:observability -- --platform android
npm run smoke:production
npm run check
npm run mcp
```

`smoke:android` and `smoke:ios` create and remove an Appium session on the currently
selected Radon device without terminating the running app. They use the pairing screen's
stable `pair-device-button` identifier for a safe validation-only tap, so the smoke remains
aligned with the current application shell. `smoke:observability` verifies Hermes logs,
fetch metadata, the development state provider, and platform-native logs without creating
an Appium session.

`smoke:pairing` is an explicit stateful development check for the in-memory companion
fixture. Wave must begin disconnected. The check redeems the supplied one-time code,
confirms a secret-free development-state summary, terminates and relaunches the app to
verify SecureStore restoration, then clears the fixture credential locally and deletes
its owned Appium session. Inputs come from the environment, text/action traces are
disabled, the MCP child process's diagnostic stream is not forwarded, and the report
contains neither the pairing code nor the device credential:

```sh
MOBILE_AGENT_METRO_URL=http://127.0.0.1:<radon-port> \
MOBILE_AGENT_PAIRING_URL=http://10.0.2.2:8787 \
MOBILE_AGENT_PAIRING_CODE=XXXX-XXXX-XXXX-XXXX \
npm run smoke:pairing -- --platform android
```

Use a fresh fixture/code for each platform because a code can be redeemed only once. See
[`companion/README.md`](../../companion/README.md) for the fixture's trust boundary.

`smoke:chat` uses the same environment variables and one-time-code rule. It pairs, creates a
conversation, cancels a deliberately suspended fixture turn and proves the composer is reusable,
sends a completed fixture message, waits for the assistant text and sanitized tool task, confirms
raw fixture input/output is absent while collapsed, expands and collapses the disclosure through
its accessibility actions, verifies the inert raw detail text while open, terminates and relaunches
Wave to verify active-session/history restoration, then navigates back and disconnects. It also
disables action traces for text and lifecycle operations and deletes the owned Appium session. The
runner prints secret-free progress, clears and verifies every controlled input before submission,
waits for the fixture's first cancellation delta before tapping Stop, and uses stable iOS
accessibility IDs for native text assertions:

```sh
MOBILE_AGENT_METRO_URL=http://127.0.0.1:<radon-port> \
MOBILE_AGENT_PAIRING_URL=http://10.0.2.2:8787 \
MOBILE_AGENT_PAIRING_CODE=XXXX-XXXX-XXXX-XXXX \
npm run smoke:chat -- --platform android
```

`reload` sends the React Native inspector's supported `Page.reload` command, prints the
unified action envelope, and exits after Metro accepts it; the long-running MCP collector
reconnects when Wave's Hermes target returns. It auto-selects the platform only when
exactly one is ready; otherwise pass `--platform`. If multiple Wave Hermes targets are
connected through one Metro server, set `MOBILE_AGENT_OBSERVABILITY_TARGET_ID` to an ID
reported by `mobile_doctor`. If iOS and Android use separate Radon Metro servers, set
`MOBILE_AGENT_METRO_URL` to the intended server; an explicit URL disables automatic Metro
discovery so the agent never attaches to the other platform by accident.
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
- Snapshot-backed actions reject stale IDs. Locator-backed taps, long presses, and drags
  require an explicit opt-in before falling back to snapshot coordinates.
- Every attempted native action invalidates its previous hierarchy snapshot. Traced actions
  return a fresh after-snapshot; untraced actions require a new tree before another
  node-backed action.
- Wave gesture actions capture local before/after screenshots and hierarchies by default.
  Text entry, text clearing, lifecycle operations, and deep links default trace capture off
  to avoid persisting credentials or sensitive app state. A caller may explicitly opt in.
- Text action responses include character counts but never echo the supplied text. Deep-link
  targets redact sensitive query parameters before entering responses or traces.
- Wave lifecycle actions intentionally expose only activate, terminate, and temporary
  backgrounding. They do not expose install, uninstall, app-data clearing, arbitrary W3C
  action payloads, shell execution, or device switching.
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
