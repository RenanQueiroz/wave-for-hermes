# Wave roadmap

Wave already supports authenticated gateway chat, account-wide conversation history, bounded
attachments, inline approval and clarify prompts, offline reading, half-duplex gateway speech, and
opt-in OpenAI Realtime voice with typed `ask_hermes` delegation. Current behavior and completed
work belong in the README and the focused architecture, connectivity, security, and WebRTC
documents; this roadmap tracks only work that remains.

## Now: adopt Hermes v0.20 conversation behavior

[Hermes Agent v0.20](https://github.com/NousResearch/hermes-agent/releases/tag/v2026.8.3) adds
active-turn redirects, richer stream and liveness events, server-owned session organization,
clause-streamed speech, signed outbound webhooks, and Agent-to-Agent support. Wave will adopt the
conversation capabilities that improve a focused mobile client without becoming a Hermes
administration console.

### 1. Establish the compatibility baseline

- Live-probe Wave's authentication, chat, resume, cancellation, prompt, session-list, pin,
  redirect, activity, event-stream, and speech behavior against v0.20.
- Replace v0.19-only assumptions in the gateway adapter with measured behavior and safe
  attempt-and-degrade behavior. Older gateways must continue to support the current feature set.
- Keep Hermes tool, skill, MCP, A2A, system-prompt, and other agent-configuration metadata outside
  Wave's product model and OpenAI prompts. Feature compatibility comes from explicit protocol
  contracts and safe attempt-and-degrade behavior, not agent capability inference.
- Add credential-free protocol fixtures and update [`hermes-connectivity.md`](./hermes-connectivity.md)
  when the v0.20 behavior has been verified rather than inferred from source.

### 2. Correct a running Hermes turn

- While a turn is active, a non-empty text composer becomes a correction action backed by
  `session.redirect`; an empty composer remains Stop.
- Start with text only. Attachments remain unavailable during an active turn until queue semantics
  are deliberately designed.
- Bind the correction to the active turn's trusted live session, render it as an ordinary user
  message, reconcile from Hermes history, and never automatically retry after an ambiguous
  transport failure.

### 3. Preserve narration and bounded live progress

- Preserve `message.interim` narration as sealed assistant segments so final completion cannot
  replace or duplicate it.
- Normalize `tool.progress` and selected lifecycle statuses into bounded Wave-owned activity.
- Show useful live states such as starting, working, and waiting for input while continuing to
  hide provider reasoning, raw protocol payloads, call/run identifiers, and unbounded logs.
- Keep streaming updates confined to memoized active-tail rows so cost stays independent of
  transcript length.

### 4. Organize every user-facing conversation

- Adopt server-owned pins, source metadata, date groups, and richer liveness.
- Keep all user-facing top-level sources discoverable, including A2A and automation-created
  conversations, while separating ordinary Chats from Automations and external activity.
- Represent delegated-agent activity through the existing bounded Task model. Do not expose A2A
  peers, credentials, Agent Cards, audit data, or configuration.

## Next: improve voice latency and correction

### Stream gateway speech safely

Hermes v0.20 can accept assistant deltas over `/api/audio/speak-stream` and return clause-level raw
PCM while the turn is still generating. Wave will first prove a bounded Expo SDK 57-compatible
streaming playback layer on physical iOS and Android, then feed it normalized assistant narration
with buffered `/api/audio/speak` as the fallback.

The first product integration remains half-duplex: Wave closes the recorder before playback and
keeps an explicit interrupt control. Full-duplex gateway voice requires a separate native proof
covering simultaneous capture/playback, echo cancellation, pre-roll capture, phase-aware VAD,
speaker and Bluetooth routing, interruption, and cleanup. If that proof is not reliable, Realtime
remains Wave's full-duplex mode.

### Improve OpenAI Realtime behavior

- Let the user choose from Wave's explicit supported-model list:
  `gpt-realtime-2.1-mini` (the default) or `gpt-realtime-2.1`. Wave will not dynamically fetch a
  model catalog or accept arbitrary model ids; changing the preference applies to the next call.
- Keep `ask_hermes({ instruction })` deliberately generic: it delegates external information,
  private context, files, coding, automation, actions, and specialized workflows while Hermes
  chooses its own configured tools and skills. Do not advertise, classify, summarize, or mirror
  Hermes tools, skills, MCP/A2A metadata, or configuration to OpenAI. Preserve an execution
  preference only when the user explicitly states it.
- Refine the Realtime prompt for unclear audio, background speech and silence, within-utterance
  self-correction, literal values, concise preambles, and tool failures.
- Add deterministic whole-utterance Stop handling without persisting the transcript.
- After chat redirect is stable, deliberately extend the current one-tool contract with a strict
  `correct_hermes({ instruction })` operation. It may target only the one active Hermes execution
  bound to trusted call state, accepts no model-controlled identifiers, is rate-bounded, and never
  retries automatically.
- Use Realtime's dynamic session-update flow to keep the complete tool list at `[ask_hermes]` while
  idle and `[ask_hermes, correct_hermes]` only after one bound Hermes execution becomes active;
  restore the ask-only list when it settles. Serialize updates and confirm `session.updated`, but
  keep controller validation authoritative when an update races or fails.
- Keep the semantics distinct: speech barge-in stops Wave's audio; a change to the current
  deliverable uses `correct_hermes`; distinct work that leaves it unchanged uses `ask_hermes` and
  the bounded queue; ordinary conversation uses neither. Clarify ambiguous add-versus-replace
  intent. A raced completion must not silently become a new request.

Adding `correct_hermes` changes a security-sensitive product contract. Its implementation is not
complete until the shared schema, controller, prompt, tests, [`architecture.md`](./architecture.md),
[`security.md`](./security.md), and `AGENTS.md` agree.

## Later: deliberate native and notification options

### Phone wake word

Hermes's gateway wake-word RPC listens to the microphone attached to the gateway process, not the
phone. A Wave wake word therefore requires a separate on-device native implementation. Evaluate it
foreground-only first with an explicit enabled state, visible microphone ownership, no-network
detection, no retained ambient audio, measured battery cost, and deterministic exclusion with
dictation, gateway voice, and Realtime. Background or lock-screen listening requires a separate
privacy, battery, OS-policy, and store-review decision.

### Completion notifications

Hermes outbound webhooks are useful for Homelab, CI, and automation, but a mobile app cannot receive
an HTTP webhook directly. Push notifications require a trusted APNs/FCM relay or upstream
gateway-native push support. Wave will not expose webhook configuration or recreate a server-side
Wave Companion solely for notifications.

### Measured storage and timeline options

- Move the persisted query cache to `expo-sqlite/kv-store` only if write jank, multi-megabyte cache
  growth, offline content search, or recurring corruption is measured.
- Recycle chat timeline rows by keying Task disclosure state per message only if very long
  conversations show fling gaps despite the current virtualization and draw-distance controls.

## Release gates

The following remain required before calling Realtime voice production-ready or shipping the first
store release:

- physical-iOS microphone, playback, barge-in, and teardown;
- speaker, receiver, Bluetooth, and wired-headset route selection and changes;
- calls and other audio interruptions, lock/background behavior, and reconnection;
- realistic Wi-Fi, cellular, and private-network transitions;
- signed release-build smoke tests on physical iOS and Android;
- the release-security and dependency checks in [`security.md`](./security.md) and
  [`dependency-security.md`](./dependency-security.md).

The detailed native evidence and acceptance criteria remain in
[`webrtc-foundation.md`](./webrtc-foundation.md).

## Explicitly out of scope

Wave does not adopt Desktop's artifact viewer, plugin SDK, shell panes, quick-entry window, Hermes
provider/model/skill administration, webhook settings, A2A peer management, or generic gateway RPC
surface. These features belong to a desktop workbench or server operator, not to Wave's focused
conversation and voice product.
