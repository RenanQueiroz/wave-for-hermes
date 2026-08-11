# Wave agent guide

## Product contract

Wave is a simple mobile client for chatting with a user's Hermes agent. Its defining feature is an
OpenAI Realtime API-backed live voice mode in which Wave can use typed tool calls to delegate work
to the user's Hermes agent. Wave is the user-facing assistant and Hermes is its execution and
reasoning layer; never require the user to address them as separate entities.

Keep the product focused:

- Build conversation and live-voice experiences.
- Let the signed-in user browse, search, pin, rename, delete, and continue every top-level
  conversation exposed by their Hermes server.
- Do not add generic proxying, operational status surfaces, or operational mutations.
- Do not add Hermes configuration, provider/model management, skill administration, or server
  administration. One deliberate carve-out: choosing the model for a single conversation is a
  conversation feature — Wave picks among the gateway's own catalog (`model.options`,
  normalized and bounded in `src/services/gateway/gateway-models.ts`) with switches that are
  always session-scoped (`config.set` value built only by `buildModelSwitchValue`, which can
  emit `--session` and nothing else). Provider onboarding, key management (`model.save_key`,
  `model.disconnect`), global config writes, and provider auth/URL internals stay excluded and
  are dropped at normalization.
- Treat all external tool arguments and responses as untrusted data.
- Never embed long-lived OpenAI or Hermes secrets in client code, app configuration, logs, or the
  repository. The one deliberate exception: the user may supply their own OpenAI API key for
  Realtime, held only in platform secure storage
  (`WHEN_UNLOCKED_THIS_DEVICE_ONLY`), validated before saving, removable in Settings, sent only to
  `api.openai.com` in Authorization headers, and never logged, displayed back, cached, or shipped
  in a bundle (the production scanner rejects key-shaped literals).
- Validate every Realtime tool call against an explicit schema before it can reach Hermes.
- Realtime may turn a natural user request into a clearer self-contained Hermes instruction, but it
  must preserve intent, scope, constraints, identifiers, quoted text, and literal values. It must
  not broaden authority, add side effects, invent missing details, or report success before the
  Hermes result confirms it.

If a requested change conflicts with this product contract, stop and raise the conflict.

The app talks to the Hermes gateway directly. Gateway sign-in is the only connection model,
Hermes's server-side voice is the default voice mode, Realtime is an opt-in mode keyed by the
user's own OpenAI key, and Wave has no server-side application component.

## Expo 57 is the source of truth

Expo has changed. Before writing Expo or React Native code, read the exact versioned documentation
at https://docs.expo.dev/versions/v57.0.0/. Do not assume an API from an older SDK still applies.

- This project targets Expo SDK 57, React Native 0.86, and React 19.2.
- Install Expo and React Native dependencies with `npx expo install <packages>` so versions remain
  aligned with the SDK. Do not replace Expo-selected native package versions with arbitrary latest
  versions.
- Run `npx expo install --check` after dependency changes.
- Treat `app.json` as the source of truth for app configuration and native identifiers.
- Treat `eas.json` as the source of truth for EAS build profiles: `development` is a Metro-backed
  development client, `preview` is an internally distributed standalone APK on Android, and
  `production` keeps the store defaults. Every root package script that invokes `eas build` must
  pass `--local`; do not add cloud-build aliases or a generic EAS wrapper that can bypass this
  policy. Never commit EAS credentials or local build artifacts.
- The generated `ios/` and `android/` directories are ignored. Make durable native changes through
  app configuration or config plugins unless the project explicitly changes that policy.

## Runtime and workspace

- Use Node.js 24 LTS and npm. The repository root remains the Expo application and npm workspace
  root.
- Runtime-neutral Wave protocol schemas belong in `packages/contracts/`. Do not move the Expo app
  into another workspace.
- Keep `packages/contracts` free of Node.js, React Native, Expo, OpenAI SDK, Fastify, and UI
  dependencies (zod is its only runtime dependency) so Metro and node tests can both consume it.
- Do not import the official OpenAI JavaScript SDK into the React Native application; Realtime
  uses `expo/fetch` and the platform WebSocket directly.
- The Wave Companion is retired. Do not recreate a `companion/` workspace, server-side
  Wave backend, or `EXPO_PUBLIC_*` credential plumbing; `npm run verify:boundaries` fails if the
  companion workspace reappears.
- Run `npm run verify:boundaries` after changing workspace manifests, shared contracts, backend
  imports, or production bundling.
- Homelab owns the Hermes gateway deployment, private networking, routing, and secrets. This
  repository owns the mobile client only.

## Dependency policy

- Do not add: the Vercel `ai` SDK or `@ai-sdk/*`, Axios or another HTTP client, a second
  SSE/EventSource implementation, Redux/MobX/XState, AsyncStorage, LiveKit, or Expo Router
  `+api.ts` server routes. Server state lives in TanStack Query, active streams live in focused
  controllers/reducers, and streaming stays on the platform WebSocket with the gateway's
  JSON-RPC framing, normalized behind `src/services/gateway`.
- Zustand is allowed for device-local UI and preference state only (the stores under
  `src/state/`): vanilla cores so node tests run rendererless, persistence on
  `expo-secure-store` with strict versioned records that degrade to defaults, React bound only
  at the edge. Never put server data, message content, or secrets in a store — secret values
  stay in secure storage with only presence/status projected. Do not migrate the chat reducer,
  the Realtime controller, or the voice loops onto it.
- Add analytics or crash reporting only after consent and retention are deliberately designed.
- Open-source acknowledgements use the explicit `react-native-legal/app.plugin.js` config plugin
  reference so Expo Tools resolves the same conventional entrypoint as Expo Prebuild. Keep its
  scan configured with `devDepsMode: none`, `includeOptionalDeps: true`, and
  `transitiveDepsMode: all` so native builds include runtime dependency notices without
  development tooling. Re-run clean Prebuild and both native builds after changing the dependency
  graph; do not replace the generated list with a hand-maintained one.
- Install optional PanelUI peer dependencies only when an adopted component needs them.
- PanelUI tracks npm `latest` at install or upgrade time. Never pin an exact application-level
  version and never adopt beta/next/canary builds; the lockfile records the validated build, the
  manifest records the policy.
- `react-native-gesture-handler` 3.1 is a deliberate SDK 57 compatibility exception: Expo's
  bundled dependency map still recommends 2.32 even though Wave deliberately uses the stable 3.1
  line and clean iOS and Android builds pass. Keep it listed in `expo.install.exclude`, re-run
  drawer, swipe-back, and gesture flows after changing it, and remove the exclusion once Expo's
  supported version catches up.
- `react-native-keyboard-controller` 1.22.2 is a deliberate SDK 57 compatibility exception: Expo's
  bundled dependency map still recommends 1.21.9, so keep the exact application version listed in
  `expo.install.exclude`. Re-run native builds and the validated keyboard flows after changing it,
  and remove the exclusion once Expo's supported version catches up.
- `react-native-audio-api` 0.13.2 is the exact device-validated playback foundation. Keep the
  application version exact until an upgrade passes clean native builds and repeated physical
  listening on both platforms. Wave uses the package's stock Android output settings: the final
  player lifecycle passed six consecutive Pixel 8 Pro runs with its MMAP low-latency stream, so do
  not carry a native source patch without a newly reproduced regression and an isolated A/B test.

## UI system

PanelUI is the shared UI component system. Read https://www.panelui.dev/docs and its component
documentation before implementing UI.

- Prefer package components imported from `panelui-native`.
- `PanelUIProvider` belongs exactly once at the application root.
- Uniwind integration lives in `metro.config.js` and `src/global.css`; do not create a second
  Tailwind/Uniwind entrypoint.
- Keep Expo Router's navigation theme synchronized with PanelUI theme variables.
- Follow https://www.panelui.dev/docs/theming: use semantic theme tokens instead of hard-coded
  palette colors, and resolve tokens needed by native props with `useCSSVariable`.
- Register every named theme in Metro before selecting it. When overriding or adding a token,
  define the same variables for every theme with Uniwind `@variant` blocks.
- `uniwind-types.d.ts` is generated by Uniwind and committed for typed theme names; regenerate it
  through Metro and never edit it by hand.
- PanelUI's CLI is optional. Copy a component into the repository only when the change deliberately
  requires owning and maintaining its source. Record that decision in the relevant documentation.
- Two validated PanelUI quirks: `Alert` is `w-full`, so inset it with a padded wrapper rather
  than horizontal margins; and interactive components drive opacity from their press-feedback
  animation, so a disabled control never visually dims through classes or its own style — put
  the dim on a wrapper `View`. Icon typings can also declare more than the runtime entry exports
  (`RotateCwIcon`); a green typecheck does not prove an icon exists at runtime.
- Settings and Connect use platform-specific native `@expo/ui` trees inside a `Host`, backed by
  shared behavior modules. Settings has `settings-screen.ios.tsx`,
  `settings-screen.android.tsx`, and `settings-screen.shared.ts`: iOS uses a SwiftUI
  `Form`/`Section` tree, while Android uses a continuous Material 3 `LazyColumn` with Compose
  `ListItem`, `Switch`, and `OutlinedTextField` controls. Model, voice, and appearance choices use
  the validated `/settings/[selection]` subroute backed by the shared definitions and mutation
  logic under `src/features/settings/selection/`; the main settings screen only shows navigation
  rows with the current values. Android selection pages use grouped radio `ListItem` rows, while
  iOS uses native plain button rows with trailing checkmarks. Every option owns its always-visible
  description, applies immediately without a save action, and leaves the user on the page until
  they navigate back. Do not reintroduce dropdown pickers for these preferences. Settings owns the
  local Disconnect action below Connection details: confirm with SwiftUI `Alert` on iOS and Compose
  `AlertDialog` on Android, and describe its local credential deletion honestly because it cannot
  revoke stateless gateway tokens or stop active Hermes work. Connect follows the same split through
  `connection-screen.ios.tsx`, `connection-screen.android.tsx`, and
  `connection-screen.shared.ts`; its heading, explanatory copy, fields, errors, and actions all
  belong to the native tree, and the Expo Router route keeps its redundant page header hidden.
  Android Settings uses a shadowless, start-aligned Material app bar; resolve the same semantic
  background token into its Compose page surface so the app bar and page stay continuous. Keep
  grouped `ListItem` rows inset, separated, rounded at the section edges, and on their shared
  PanelUI-backed surface color instead of the page background. Android settings
  rows go through `settings-list-item.android.tsx`: its one PanelUI semantic-token map owns row
  colors for static, pressable, switch, and radio variants, while Compose still owns their native
  controls and interaction semantics. Keep its title, overline, and description in one explicitly
  styled headline stack so wrapped copy retains the same typography and vertical rhythm instead of
  switching to Compose's roomier three-line list template. Its centralized default content insets
  are additional to Compose's built-in padding; per-row overrides must distribute the outer start
  and end inset to leading/trailing accessories when present rather than padding only the headline.
  For switch rows, wire the same setter to the row's `toggleable` modifier and the nested Switch's
  `onCheckedChange`, so both native hit targets toggle the setting.
  Keep product state, validation, and mutations shared; do not put PanelUI, React Native visual
  wrappers, universal `FieldGroup`, or `RNHostView` inside either native screen. Each
  platform-native scroll container owns its keyboard insets. Native text fields use
  `useNativeState` and read `state.value` at submit; blur before programmatic writes in a focused
  iOS field (expo/expo #47434). The outer app stack owns iOS utility routes and their Expo Router
  `Stack.Title large` appearance: expanded titles are transparent over the page background and
  collapse to the system-selected blur, while Android retains its Material headers. The drawer
  wraps only the inner chat stack (not utility screens), which avoids the iOS 26 native-stack
  large-title margin bug caused by nesting a stack inside a drawer. Chat alone keeps a compact
  system-blurred header: its transcript scrolls beneath a transparent native header, and its
  drawer action is the native Expo Router `Stack.Toolbar` item on iOS. Android lets the Drawer
  own its header and default toggle instead of embedding a custom Compose or PanelUI button in
  the nested Stack; the chat screen projects its resolved conversation title to that parent
  header. A React
  Native screen with a large title must expose its inset-adjusting scroll
  view as the route root; in Search, the root is the `LegendList` itself because an RN wrapper
  prevents the native title from tracking and collapsing with the list. Every tap on a Realtime
  voice option, including the
  already-selected option, stops any existing preview and starts that voice from the beginning.
  The shared preview owner generates a bounded sample directly through OpenAI Realtime with the
  user's secure-stored key, caches it by app-owned model and voice, and owns the single
  `expo-audio` player lifecycle; platform-native settings rows only dispatch the selection.
- Search and transcript surfaces stay PanelUI/RN. The chat composer is the other deliberate
  direct-Expo-UI surface: shared code owns product state and events only, while `view.android.tsx`
  and `sheets.android.tsx` render direct Jetpack Compose exports and their `.ios.tsx` peers render
  direct SwiftUI exports. Hosts, visible controls, icons, native observable state, and sheet
  presentations must all come from the platform subpackages rather than universal Expo UI
  components. The React Native `ChatComposerDock` is the sole keyboard-movement owner and
  positions the composer as an overlay so the transcript can scroll beneath it; it reports its
  effective resting or keyboard-raised bottom footprint so the transcript keeps reachable content
  above the dock. iOS may render the dock's non-interactive background with Expo `GlassView` when
  Liquid Glass is available, with a solid semantic fallback; Android always composites the
  translucent PanelUI muted token over the page into an opaque native surface. The native hosts
  ignore keyboard safe-area/inset handling. Do not put PanelUI, `RNHostView`, nested manual hosts,
  or a second keyboard-avoidance path inside the composer.
- The conversation drawer is chat chrome. Enable its edge-swipe gesture only on `/new` and
  top-level `/conversation/[sessionId]` routes; Settings, search, development, voice, and other
  pushed routes must not expose or swipe-open it. Keep Disconnect out of the drawer.
- Keyboard avoidance for the remaining PanelUI/RN surfaces (validated on device): a lone
  field — optionally grouped with its submit button — lifts through
  `KeyboardAvoider`/`avoidKeyboard` gated on that field's focus. The native Connect fields use
  Compose `OutlinedTextField` keyboard classes (`uri`, `ascii`, and `password`) with explicit IME
  actions on Android, and SwiftUI keyboard/content-type modifiers on iOS; keep focus progression
  and keyboard submission native rather than adding a React Native avoidance layer.
- Keep Expo UI modifier ownership explicit. On Android, modifiers supplied to a Compose `Switch`
  size the switch control itself rather than its label row, so do not apply `fillMaxWidth()` there.
  On iOS, a SwiftUI container accessibility identifier is inherited by its
  descendants and can overwrite their identifiers, so put identifiers on actionable descendants
  rather than the composer container. Direct platform sheet components need their own
  platform-native presentation `Host`, kept as a sibling of the manually owned inline composer
  `Host`.
- React Native's Android renderer resolves the CSS logical corner classes `rounded-es-*` and
  `rounded-se-*` to the diagonally opposite corner (validated on RN 0.86:
  `BorderRadiusStyle.resolve` reads the tokens inline-axis-first; iOS is correct, and
  `rounded-ss-*`/`rounded-ee-*` are correct on both). For a mixed corner, use RN's directional
  style props (`borderBottomStartRadius`) instead — they resolve correctly everywhere and stay
  RTL-aware.
- Restart Metro with a cleared cache after changes to Metro, global CSS, themes, or PanelUI/Uniwind
  dependencies.

## Repository conventions

- Routes and layouts live in `src/app`. Put reusable UI in `src/components`, product behavior in a
  focused feature/service module, and development-only integrations in `src/dev`.
- Use the `@/` aliases rather than long relative imports across feature boundaries.
- Keep platform-specific behavior explicit and preserve iOS and Android behavior.
- Name platform-only implementations with explicit `.ios.tsx` and `.android.tsx` suffixes; reserve
  unsuffixed `.tsx` files for code genuinely shared by both platforms. Keep the empty suffix first
  in TypeScript's `moduleSuffixes` so package declarations resolve normally while missing local
  shared modules fall through to the platform pair.
- Wave supports iOS and Android only. Do not add React Native Web dependencies, web scripts,
  web configuration, `.web.*` implementations, or web-only branches.
- Add accessible roles, labels, and stable test identifiers to meaningful controls so both people
  and the repository-local mobile agent can operate the app.
- Keep `CLAUDE.md` exactly `@AGENTS.md` so Claude Code reads this guide.
- Do not edit unrelated user changes in a dirty worktree.

## Realtime and Hermes boundaries

- Mobile feature and UI code depends on normalized Wave contracts and typed clients
  (`WaveChatClient`, `GatewayClient`), never on Hermes protocol types. Gateway protocol shapes
  stop at `src/services/gateway`: normalize them into Wave contracts there.
- The Hermes API key lives server-side with the gateway and never reaches the app. Realtime uses
  the user-owned OpenAI key from Settings: secure storage only, presence-not-value in
  the query cache, requests only to `api.openai.com`, ask_hermes bound to the initiating
  conversation through trusted call state with the rules in
  `src/features/realtime/ask-hermes-orchestrator.ts` enforced client-side.
- Gateway session tokens are opaque device-only values, rotated from every response and never
  logged. The gateway cannot revoke them, so Disconnect is local deletion of the stored tokens;
  present it that way, and note that the gateway invalidates outstanding tokens when its token
  secret rotates.
- Keep transport, authentication, and tool schemas behind typed boundaries; screens should not
  construct raw protocol messages.
- Raw tool input/output shown to the user must cross only as bounded Wave-owned detail fields
  with explicit truncation. Never expose Hermes/OpenAI call IDs or run IDs, render tool details
  as Markdown, or execute content-derived behavior.
- Use TanStack Query for finite backend state and a focused controller/reducer for active
  streams. Mobile screens consume normalized state and never parse raw stream frames directly.
- Finite retryable reads may retry at most twice with the shared bounded exponential-jitter policy.
  Mutations and active streams must not retry automatically after an ambiguous failure.
  Reattaching to an already-dispatched turn stream by turn ID and sequence is a read of the same
  execution, not a mutation retry; the turn submission itself is never re-sent automatically.
- Chat correction is text-only and uses `session.redirect` exactly once on the active turn's
  registered RPC channel. It accepts no client/model-supplied session or turn id, never carries
  attachments, and never retries automatically. Keep `redirected`, `queued`, and `rejected`
  reconciliation in the focused chat reducer; an empty busy composer remains Stop. Journal only
  corrections the gateway explicitly accepted, in the bounded account-scoped TanStack cache, so
  tool-boundary steering remains an ordinary user row after reload. Never derive a correction
  from tool output or another content-controlled marker.
- Keep stream framing, ordering, timeout, cancellation, and size limits inside
  `src/services/gateway`; HTTP reads use Expo SDK 57's `expo/fetch`.
- Preserve `message.interim` as sealed assistant segments and reconcile previewed completion
  without duplicate text. `tool.progress` may update only the existing bounded tool preview, and
  `status.update` may cross the gateway boundary only through an explicitly reviewed Wave-owned
  ephemeral state; never render or persist raw lifecycle payloads. Reasoning crosses the boundary
  only as one bounded, truncated, inert plain-text trace per assistant message — live
  `reasoning.delta` frames (emission stays gated by the server's `show_reasoning`) and the stored
  rows' plain-text reasoning fields with Hermes Desktop's precedence. Opaque provider reasoning
  structures (`codex_*` items, detail arrays) never cross, reasoning renders only through the same
  bounded `Response` markdown pipeline as assistant text (non-allowlisted link schemes stay inert)
  and never drives behavior, and Realtime voice still stores and displays none. With Codex providers the
  commentary channel arrives separately as ordinary interim segments (`show_commentary`).
- Server-reported `starting`, `working`, `waiting`, and `idle` plus bounded freshness may inform
  presentation. A stale-working hint never completes a turn, resends work, or relaxes active-turn
  conflicts.
- Validate and authorize a requested tool before forwarding it to Hermes. Return structured
  success and error results to the Realtime session.
- Wave does not add a separate user-approval prompt before `ask_hermes` or `correct_hermes`.
  Dispatch either automatically only after strict schema validation, trusted binding, and
  rate/concurrency checks; Hermes's own tool safety policy remains authoritative.
- Bind the active Hermes session to trusted call state owned by the app. Do not accept a
  model-controlled Hermes session ID in either Realtime tool's arguments.
- Realtime starts ask-only. Advertise strict `correct_hermes({ instruction })` only while exactly
  one `ask_hermes` execution has registered its live gateway redirect lane; steered asks never
  become correction targets. The correction schema has no session, turn, call, run, mode,
  attachment, or arbitrary-options field. Capture the trusted execution object and recheck it
  immediately before and after one non-retrying `session.redirect`; a completion race returns
  `nothing_active` and never becomes new work or retargets a later owner execution.
- Treat Realtime tool surfaces as complete `idle` (`[ask_hermes]`) and `active`
  (`[ask_hermes, correct_hermes]`) snapshots. Serialize `session.update`, coalesce to the latest
  desired state, and acknowledge a snapshot only after a matching full `session.updated`; neither
  model nor voice belongs in an update. Failed/timed-out updates do not retry until a later real
  execution transition, never end the call, and never override the trusted correction gate.
- Treat Hermes work as background work relative to the live voice conversation. Barge-in interrupts
  Realtime playback, not the active Hermes run. Steer by default, never queue client-side: at most
  one ask execution (the turn owner) runs a gateway turn at a time, and an additional `ask_hermes`
  while it runs dispatches one non-retrying `session.redirect` on the owner's live lane —
  serialized and bounded with corrections on one redirect chain — acknowledged to the model as
  `steered` (folded into the active work) or `queued` (Hermes runs it next), with the combined
  outcome arriving on the owner's still-pending call. A `queued` acceptance keeps the owner's
  turn stream open: the gateway drains the text as the next turn on the same socket and the
  stream translates that follow-on turn into the combined answer instead of closing at the first
  completion. An ack is never an answer and never reports completion. A steer that loses the completion race becomes the new turn owner exactly once;
  redirect dispatches per steer are bounded and settle as retryable busy rather than spinning.
  Deliver completed results only when no user speech or default Realtime response is in progress.
  Corrections/constraints to the active deliverable use `correct_hermes`, distinct additional work
  uses `ask_hermes`, speech-only interruption uses neither, and unclear add-versus-replace intent
  requires one concise clarification. Answers to explicit Hermes approval/clarify prompts remain on
  the existing prompt-response path, not either Realtime tool.
- The owner turn's sealed interim narration (`assistant.interim`) may cross to OpenAI as bounded
  inert plain-text progress notes: sanitized of Markdown control syntax with code dropped whole,
  one line of at most 1,000 characters, coalesced to the latest un-flushed note, bounded per
  execution and per call (ending in one suppression marker), flushed only under the same
  response-safe gate as results, and never triggering a model response by themselves. Deltas,
  tool records, reasoning, and prompt requests never cross this channel.
- Coalesce an exact normalized `ask_hermes` instruction within one initiating Realtime user turn.
  Distinct tool-call IDs for that instruction must share one execution and each receive the same
  structured result — the owner's answer or the steer's acknowledgement; model retries must not
  duplicate work or dispatch a second redirect, while a later user turn may deliberately repeat
  the request.
- Realtime transcripts are ephemeral: store no raw audio, no partial or final transcripts, no
  provider identifiers, no audio-meter history, and no hidden reasoning. Work Wave hands to Hermes
  through `ask_hermes` lands as ordinary turns in the bound session; accepted corrections use that
  turn's ordinary redirect lane, and Hermes remains canonical for its own turns.
- Realtime model choice is an app-owned allowlist containing exactly `gpt-realtime-2.1-mini` and
  `gpt-realtime-2.1`; mini is the default. Persist it separately from the key and voice in a strict
  versioned device record, reject free-form ids, and snapshot it into the initial call — never
  attempt to change or silently fall back through `session.update`.
- Keep the Realtime prompt and generic `ask_hermes` description Wave-authored and independent of
  gateway metadata. Never fetch or reflect Hermes tools, skills, MCP servers, A2A peers, Agent
  Cards, configuration, or descriptions into OpenAI. Preserve a tool/skill/CLI/provider preference
  only when the user explicitly states it inside their request; otherwise Hermes chooses its own
  execution plan.
- Consume only a final exact whole-utterance voice stop phrase as local Realtime teardown, before
  it enters transcript state. A phrase that merely contains a stop word remains user intent, and
  speech barge-in still interrupts Wave playback rather than active Hermes work.
- Build mobile conversation history from the paginated unified timeline, not by joining text in
  the client, and refresh that timeline before returning from live voice.
- Do not silently broaden a chat tool into arbitrary administration access.
- Hermes can pause a running turn to ask the user something. Render approval and clarify
  prompts inline in the turn they belong to, answer them on the socket bound to that turn's
  live session, and clear the prompt as soon as anything proves it settled — including an
  answer from another client or a server-side expiry. Never collect secrets or passwords on
  the phone: decline `secret`/`sudo` requests with copy that says why.
- Gateway sign-in authorizes the user's Hermes account; it does not create per-device copies or
  allowlists of Hermes sessions. Session IDs must still be validated and resolved by Hermes, and
  active turn/call conflicts must be enforced before destructive changes.
- For `session.active_list`, treat `starting`, `working`, and `waiting` as active (`running` remains
  a defensive legacy alias); `idle` is the measured inactive state. Do not fabricate an active
  turn from an unknown status or let it override a locally registered turn channel.
- Keep conversation listing paginated. Rename and delete through the typed client; deleting a
  session with an active turn or Realtime call must fail explicitly — and where the backend does
  not enforce that itself, the client does, using the backend's own liveness signal rather than
  local state alone.
- Keep server-owned pins and source organization behind the typed client and normalized Wave
  contracts. Raw Hermes source identifiers never reach screens: map reviewed identifiers to
  `chat`, `automation`, or `external`, preserve `other` as the future-compatible reachable
  fallback, and never exclude a user-facing top-level row merely because its source is unknown.
  Pin/unpin is an ambiguous mutation: send it once, project it optimistically only with rollback,
  and reconcile from the server.
- Turn attachments use strict Wave parts. Mobile may send up to four bounded inline images or
  bounded text-file contents with a non-empty message. Reject unsupported binary documents before
  dispatch and never expose a generic Hermes upload or filesystem endpoint.
- Composer slash commands stay conversation-level. The Wave-owned registry in
  `src/features/chat/slash-commands.ts` routes each recognized command (local action, dedicated
  RPC, or gateway `slash.exec`/`command.dispatch`); administration-flavored commands are
  explicitly unavailable with honest copy, and a name neither Wave nor the gateway catalog knows
  stays ordinary text. Slash text never reaches `prompt.submit` or `session.redirect` — the
  gateway does not parse slash commands server-side — and while a turn runs, recognized commands
  dispatch on their own RPC lane (Desktop parity) with a visibly distinct Run action. Catalog
  entries, completion labels, and command outputs are gateway-authored untrusted text: bounded,
  inert, never markdown. Skill/bundle `send` expansions go to `prompt.submit` verbatim as
  model-facing scaffolding while only the bounded `display` projection reaches the screen, and
  an overlong expansion is refused rather than clipped. Command dispatch is sent once and never
  retried automatically.

## Chat presentation

- Bubbles belong to user messages only. Agent output renders full width and bubble-free:
  assistant text through PanelUI `Response` (model-authored link schemes outside the component's
  allowlist stay inert text), each tool and handoff record as a PanelUI `Marker` action row with
  no disclosure affordance, the turn's bounded reasoning trace as one PanelUI `Reasoning`
  disclosure (streaming live, folded for history, rendered through the same `Response` markdown
  pipeline as assistant text), and waiting states
  as `Shimmer` text showing the reviewed activity label when fresh and "Working…" otherwise. Wave presents as one assistant: user-facing copy
  never frames Wave and Hermes as separate actors.
- Tool calls render only as bounded one-line actions derived by the Wave-owned mapping in
  `src/features/chat/tool-actions.ts` from the validated tool name plus defensively parsed
  bounded input. Derived lines are single-line inert plain text, never markdown; unknown tools
  fall back to a generic action; handoffs are detected by Wave-constructed ids, never titles;
  raw tool input/output is not displayed.
- Every completed assistant turn carries the Wave-owned action row (`turn-action-row.tsx`):
  time-ago timestamp plus icon-only Branch / Copy / Read-aloud / Refresh. The complete visible row
  is one native Expo UI `Host`: `row.android.tsx` owns a direct Jetpack Compose tree and
  `row.ios.tsx` owns a direct SwiftUI tree; do not split its timestamp and controls across React
  Native and native layout trees or replace either tree with universal controls. Native icon
  controls share the composer's platform button and symbol metrics. Keep the RN Host and native
  row at the same explicit fixed height without `matchContents`. SwiftUI hosted inside a recycled
  Legend List cell can retain its old native origin after the cell moves; settled drag, momentum,
  and composer-inset changes increment the shared action-row layout epoch so iOS remounts the
  `HStack` at the cell's current origin before interaction. It renders only on sealed turns, receives the copy text through a lazy accessor
  (never as a prop), and Branch and Refresh are one-shot gateway mutations disabled while a turn
  runs.
  Refresh ordinals and branch counts come only from server timeline rows — `ordinalExempt` rows and
  Wave-injected correction rows never shift them — and the optimistic timeline prune is always
  reconciled by the authoritative refetch.
- Conversation surfaces render through the Wave-owned `ConversationScroller`
  (`src/components/conversation-scroller.tsx`), which composes Legend List v3 and owns the
  transcript scroll contract: pin-to-newest only inside the at-end band, no dragging the reader
  mid-read, a jump-to-newest button while auto-follow is disengaged, stable history prepends, and
  a fresh at-end opening every time the user navigates into a conversation.
  The auto-follow band and jump-control threshold are deliberately separate: streaming may remain
  pinned throughout the wider near-end band, while the shared native jump button hides only within
  a small fixed distance of the actual end. Its visibility is reconciled directly from Legend List
  scroll, drag-end, momentum-end, layout, and content-size metrics. Edge fades are
  passive pointer-free gradient siblings; the bottom fade includes the measured composer inset so
  content is strongly obscured as it scrolls behind either platform's composer. The measured dock
  footprint already includes the bottom safe area and remains the transcript's full tail padding;
  native scroll events' `contentInset.bottom` are the source of truth for distance-to-end checks.
  Legend List owns opening and reader-requested final-item positioning — do not duplicate it with a
  content-height offset, issue a second opening scroll while its virtualized tail is still being
  measured, or optimistically declare a requested jump complete. Reconcile later native content-size
  changes against the last real offset, because a hosted native row can finish layout after a scroll
  request. An empty timeline has no tail padding, bottom alignment, or scrolling;
  its separately positioned empty-state overlay accounts for the composer instead. Keep each iOS
  action-row native subtree stable across scroll completion; remounting its `Host` visibly changes
  the virtualized row's layout and invalidates the scroll endpoint.
  Never wrap the list in PanelUI `ScrollFade` or compose its Reanimated event handler with the
  scroller's ordinary JavaScript callback.
  Do not reintroduce FlatList there or adopt PanelUI `MessageScroller` for unbounded histories —
  it is not virtualized. Keep turn rows memoized with stable `renderItem`/`keyExtractor`, and
  mark only the active turn as streaming: its arriving tail streams through `Response`
  `isStreaming` while sealed segments and completed turns parse once and stay memoized. Never
  call `scrollToEnd` or run layout animation per token; the scroller's reader-initiated jump is the
  deliberate exception, while Legend List's `initialScrollAtEnd` owns initial positioning.
- Conversation switches replace the active chat route; they never push another conversation onto
  the chat stack. Keep the new-chat and conversation screens singular as a navigation backstop.
- Do not log access tokens, full authorization headers, request URLs, network addresses, opaque
  conversation identifiers, or sensitive conversation payloads. Production request logs keep only
  the Wave request correlation ID, HTTP method/status, timing, and explicitly reviewed lifecycle
  fields.

## WebRTC foundation

- `react-native-webrtc` is the accepted native foundation for the production OpenAI Realtime
  transport. Keep the production peer connection, media tracks, data channels, timers, and cleanup
  behind a focused `RealtimeTransport`/controller boundary; React components render snapshots and
  do not own raw WebRTC objects.
- Wave live voice is audio-only. Keep product-specific microphone configuration in `app.json` and
  do not request video for Realtime. Camera permission is deliberately enabled only for the
  user-invoked chat attachment flow; do not make it part of voice setup or background capture.
- WebRTC owns the live-call audio session for full-duplex capture and playback. Never start an
  `expo-audio` recorder — for metering or anything else — while a Realtime call can be active, and
  add real input levels for a call only through data WebRTC itself exposes safely. `expo-audio`
  owns the microphone for the modes WebRTC is not in: gateway voice mode and composer dictation.
  Those and a Realtime call are mutually exclusive; do not create a surface where both can hold
  the audio session at once.
- Gateway voice mode is deliberately half-duplex. `expo-audio` exposes no speaker-routing override,
  so an open recorder forces iOS playback to the earpiece: close the recorder before speaking and
  offer an explicit interrupt control rather than acoustic barge-in. Its live waveform may consume
  the current recorder meter and `expo-audio` samples from audio already being played; never retain
  those samples or start another recorder to animate it.
- Raw gateway-speech output lives only behind the singleton `src/native/pcm-player.ts` owner, which
  adapts `react-native-audio-api`'s native `AudioBufferQueueSourceNode`. Keep the Wave surface
  foreground-only, Int16 little-endian, format/chunk/queue bounded, microphone- and network-free,
  and deterministic on drain, Stop, background, and interruption. Keep the app plugin configured
  without background audio, foreground services, extra Android permissions, FFmpeg, or bundled
  codec libraries. Normal Stop fades immediately but may retain the muted Android source and its
  audio focus until the bounded five-second context close; format restarts must reuse one focus
  request instead of abandoning/re-requesting it mid-proof. Gateway protocol and fallback behavior
  never enter the player.
- The PCM card under `src/dev` is a development-only feasibility proof and never connects to the
  gateway. Production clause-streamed gateway speech lives in
  `src/services/gateway/gateway-speech-stream.ts`: one per-reply ticketed
  `/api/audio/speak-stream` session that owns the protocol frames, bounded inbound sizes,
  timeouts, and the transport admission ledger (six-second high-water under the player's
  12-second capacity; pending and per-session audio bounds fail deterministically). It never
  retries or replays an ambiguous socket: buffered `/api/audio/speak` synthesizes the complete
  reply only when no streamed audio ever became audible, and after first sound the reply stays
  text-only. Feed it only assistant narration through the Wave-owned speech-text filter
  (`src/features/voice/speech-text.ts`) — never tool details, reasoning, prompts, raw Markdown
  control syntax, or already-fed text — and keep Skip stopping audio without stopping the turn.
- Do not add `@config-plugins/react-native-webrtc` until its published Expo compatibility includes
  SDK 57 and its native mutations are reviewed. The current module autolinks and needs no generated
  native edits or repository-owned config plugin.
- The development-tools loopback proof under `src/dev` is development-only. It validates native
  loading, microphone tracks, local negotiation, remote track delivery, data-channel echo, and
  cleanup; it is not a production Realtime transport.
- After changing WebRTC/native dependencies or permissions, run a clean prebuild and native build
  on both affected platforms. Do not call voice production-ready until the physical-device,
  routing, interruption, release-build, and real Realtime gates in
  `docs/webrtc-foundation.md` pass.
- Realtime waveform metering stays inside `RealtimeTransport`: reduce only standards-defined local
  audio-source and remote inbound-audio stats to bounded 0-1 Wave levels, and never expose raw
  WebRTC stats, track/provider identifiers, or meter history to controllers or screens. Missing
  native stats degrade to PanelUI's phase animation and never affect call health or reconnection.

## Verification

Run checks proportional to the change. The normal repository handoff is:

```bash
npm run build:contracts
npm test
npm run lint
npm run typecheck
npm run verify:boundaries
npx expo install --check
npm run mobile:smoke:production
```

Dependency review must separate mobile build tooling from shipped app code. Do not run an
incompatible `npm audit fix --force` through Expo's SDK-aligned graph. Re-run the scoped
production audit before a signed release.

For runtime work, also exercise the affected flow on every changed native platform. The mobile
automation tooling is documented in `tools/mobile-agent/README.md`; keep its server, CLI, and MCP
contracts in sync when modifying it. Native dependency or app-configuration changes also require
`npx expo prebuild --clean`, affected native builds, and `npx expo-doctor`.

Voice flows are exercised mic-free against the local fakes in `tools/voice-harness`
(`npm run harness:gateway`; scripts transcripts, turns, redirect outcomes, speech, and
scripted OpenAI-Realtime calls through its loopback control API — see its README). Dev builds
opt realtime voice into the scripted fake via the development-tools "Realtime harness" card
(`src/dev/realtime-harness.ts`, `__DEV__`-only, dummy-bearer enforced). Build the harness once
with `npm run harness:build` so `npm test` includes the real-`GatewayClient` integration proof
in `test/mobile/voice-harness.integration.test.ts` and the full controller-to-both-fakes loop
in `test/mobile/realtime-harness-e2e.test.ts` (those tests skip when the harness is unbuilt).
The harness is a scripted test double pinned to the deployed gateway protocol; when a Hermes
upgrade changes wire shapes, update it in the same change as `src/services/gateway`. It never
replaces the physical-device audio gates.

## Documentation is part of the change

Keep documentation accurate in the same change as the code. Stale documentation is worse than no
documentation.

- Update `README.md` when setup, scripts, architecture, product scope, or developer workflow
  changes.
- Update `docs/security.md` when trust boundaries, authentication, authorization, sensitive data,
  resource limits, deployment controls, or release-security gates change.
- Update this file when agent constraints, repository conventions, or verification steps change.
- Update local tool documentation when commands, capabilities, limitations, or protocols change.
- Delete or rewrite obsolete guidance instead of leaving contradictory historical instructions.
- If a code change intentionally does not affect documented behavior, avoid meaningless doc churn.

A task that changes documented behavior is not complete until the documentation matches the
repository.

## Preserve validated progress

After completing and validating an in-scope change, commit it and push the current branch so the
work is not lost, unless the user explicitly asks to leave it uncommitted or unpushed.

- Review the diff before committing and include only the completed task's changes.
- Never overwrite, discard, or silently include unrelated user work.
- Use a concise commit message that describes the validated outcome.
- If pushing is unavailable or rejected, keep the local commit and report the exact blocker.
