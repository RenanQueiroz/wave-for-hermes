# Wave security model

Wave is a private native client for a user's Hermes account. This document records the assets,
trust boundaries, abuse cases, implemented controls, and remaining release gates for the mobile
app and its shared protocol schemas. It complements [`architecture.md`](./architecture.md) and the
environment-specific controls owned by Homelab.

## Assets and trust boundaries

The highest-value assets are:

- the user's Hermes gateway credentials (password at sign-in, rotating session tokens
  afterwards);
- the user-owned OpenAI API key, when the user opts into Realtime voice;
- Hermes conversations, attachments, and tool details;
- active OpenAI Realtime calls, microphone audio, and tool dispatch;
- Hermes's ability to perform work through its configured tools.

Trust is deliberately split:

1. The mobile process is an API client of the user's own gateway. It holds the gateway's rotating
   session tokens — and, if the user opts in, their own OpenAI key — in platform secure storage.
   The Hermes API key and the gateway's STT/TTS provider keys never exist on the phone.
2. The Hermes gateway is the production backend. It authenticates the user, owns upstream
   provider credentials, and enforces its own tool safety policy.
3. Hermes and OpenAI payloads are untrusted until the app's transport layer validates and
   normalizes them at the `src/services/gateway` and Realtime boundaries.
4. Nginx and Tailscale are the private production edge. Homelab owns their exact routing, TLS,
   logging, and secret policy.
5. PanelUI and React components render normalized Wave state. They never construct protocol
   messages or execute content-derived behavior.

A signed-in device intentionally has account-level conversation access: it can read, continue,
pin, rename, and delete the same top-level Hermes sessions as any other signed-in client. Sign-in is
therefore equivalent to granting access to that Hermes account, not to one conversation.

### The user-owned OpenAI key

Realtime live voice runs from the app with an OpenAI API key the user supplies in Settings — the
one deliberate exception to "the mobile process never holds an upstream key."

- The key lives only in platform secure storage (`WHEN_UNLOCKED_THIS_DEVICE_ONLY`: never backed
  up, never migrated to another device). Only its presence enters the query cache or UI; it is
  never displayed back, logged, or included in errors.
- It is sent exclusively to `api.openai.com` — as an Authorization header for the SDP exchange,
  the sideband WebSocket, and the one validation call made before saving. It cannot reach the
  gateway or any Wave surface.
- The production bundle scanner refuses key-shaped literals (`sk-…`) and the `OPENAI_API_KEY`
  env-var name in exported bundles, reporting a label rather than the match.
- Model choice is a separate strict versioned device preference, not key material. Only the two
  app-supported ids can reach call setup; missing, corrupt, or retired values become
  `gpt-realtime-2.1-mini`, and the selected id is snapshotted for the call. A setup rejection is
  attempted once and becomes bounded model-setting guidance without parsing or displaying the
  OpenAI response body.
- ask_hermes tool calls from a keyed Realtime call are validated client-side (strict schema,
  trusted session binding, coalescing, serialization, bounded concurrency, response-safe
  delivery), then run as ordinary turns on the gateway connection under the gateway's own
  authentication.
- Revocation story: removing the key in Settings deletes it from secure storage and downgrades
  voice mode to the keyless server-side voice; the key itself should also be revoked at OpenAI
  when a device is lost — which is why Settings recommends a dedicated project-scoped key whose
  revocation cannot affect anything else the user runs.

## Threats and controls

### Credential theft and stale sessions

- The password is sent to the gateway exactly once at sign-in and never stored.
- Gateway session tokens are an access/refresh pair in platform secure storage, device-only,
  never logged, and rotated whenever the gateway refreshes them.
- The gateway's tokens are stateless and signed: signing out deletes them locally but cannot
  revoke them server-side, so their real lifetime is their expiry (12 hours access, 30 days
  refresh) or a rotation of the gateway's signing secret (for example a gateway restart), which
  signs out every client at once. Wave says so in the disconnect flow rather than implying a
  server-side revocation it cannot perform.

Residual risk: copied session tokens carry the account's conversation authority until they
expire or the gateway's secret rotates. Rotating the gateway secret is the operator's kill
switch.

### Protocol expansion, SSRF, and administration access

- The mobile app uses fixed typed client methods and strict identifiers; it cannot select an
  arbitrary Hermes URL, method, header, model, provider, run ID, tool, or endpoint.
- The base-URL policy rejects credentials, queries, and fragments in the configured gateway URL
  and requires HTTPS outside the documented private-transport carve-outs.
- Redirects are refused. The app exposes no generic proxy, upload filesystem, provider
  configuration, skill, model, or job surface.

### Realtime tool abuse and prompt injection

- The Realtime session exposes exactly `ask_hermes({ instruction })`. Its JSON Schema is
  generated from the same strict Zod schema used at dispatch; unknown tools, keys, and
  model-selected session IDs fail closed (the schema has no session field at all).
- The prompt and tool description are fixed Wave-owned values and accept no capability metadata.
  Wave does not fetch or reflect Hermes tools, skills, MCP servers, A2A peers, Agent Cards,
  configuration, or descriptions into OpenAI. The model may preserve a user-explicit execution
  preference inside the ordinary instruction, but cannot invoke that capability directly.
- The orchestrator binds dispatch to the initiating conversation's session through trusted call
  state and refuses tool calls from a call it no longer tracks.
- Per-call tool count (128), outstanding queue size (8), execution serialization, output length,
  and call lifetime are bounded. Duplicate normalized instructions within one initiating user
  turn share one execution.
- Tool results are structured, bounded, and returned only through the originating call's
  sideband, deferred while the user is speaking or a model response is active.
- Wave does not add a second user-approval prompt; Hermes's own tool safety policy remains the
  authority for side effects.

Residual risk: the instruction is user/model-controlled content sent to a capable Hermes agent.
Strict transport validation prevents protocol broadening, but it cannot make a permitted Hermes
tool harmless. Hermes tool policy and deployment isolation remain mandatory.

### Lifecycle races

- Deleting a session with a running turn or an active Realtime call is refused client-side using
  the gateway's own liveness signals (the turn's registered RPC channel and
  `session.active_list`, where `starting`, `working`, and `waiting` are all active), because the
  gateway itself accepts a mid-turn delete and lets the conversation reappear. An unknown status
  is not fabricated as active and cannot override the registered turn channel, which remains the
  primary signal for work Wave started locally.
- Realtime calls are bounded to one per conversation surface, expire client-side after 30
  minutes, and are hung up explicitly on stop, error, backgrounding, and unmount.
- Chat correction accepts one bounded text field with no session/turn identifier or attachment.
  The client binds it to the registered live RPC channel for the displayed conversation and sends
  `session.redirect` exactly once. A raced completion, rejection, malformed response, or network
  ambiguity removes the optimistic correction, restores the draft, reports no success, and never
  retries automatically; liveness and the canonical timeline decide the settled state. Only a
  gateway-accepted correction enters the bounded account-scoped correction journal used to keep
  its ordinary user row after reload. Tool output and content-derived markers can never create a
  journal entry or impersonate the user.

### Resource exhaustion and malformed content

- Shared schemas bound identifiers, text, attachment count, decoded image bytes, text files, tool
  input/output and previews, interim assistant segments, instructions, and tool results; unknown
  fields and unknown event variants fail closed.
- Mobile JSON reads, stream frames, ordered sequences, stream identities, idle time, and total
  time are bounded. Oversized responses are cancelled while streaming.
- Realtime setup, sideband connection, tool execution, and reconnection are separately bounded
  (request timeouts, one grace window plus at most three full re-offers with the shared jitter
  policy).
- Finite retryable reads retry at most twice with bounded exponential jitter; mutations and
  active streams never retry automatically after an ambiguous failure.
- Pin/unpin is one fixed typed PATCH with a boolean body. The UI may project the choice
  optimistically, but rolls it back on failure and reconciles from Hermes; it never retries an
  ambiguous PATCH or treats the optimistic row as server confirmation.

### Sensitive-data disclosure

- Safe errors contain a Wave code, retryability, and a user-safe message; they omit upstream
  bodies, headers, stack traces, URLs, tokens, and provider identifiers.
- The app does not log access tokens, authorization headers, request URLs, network addresses,
  opaque conversation identifiers, or conversation payloads.
- Tool details are bounded and rendered as inert code, never Markdown.
- Hermes lifecycle frames are allowlisted into short Wave-owned ephemeral states. Raw status
  payloads, hidden reasoning, and unreviewed progress fields never enter the render model or
  persisted timeline; the stale-working label is a local time-based presentation hint only.
- Session source identifiers are open-ended untrusted metadata. The gateway boundary collapses
  reviewed identifiers into `chat`, `automation`, or `external` and uses `other` for everything
  else; raw source strings, peer URLs, credentials, Agent Cards, audit paths, and A2A configuration
  never enter the render or persisted contract. Unknown sources stay reachable in Activity/All.
- Realtime transcripts are ephemeral: no raw audio, no partial or final transcripts, and no
  provider identifiers are persisted anywhere. Work delegated through `ask_hermes` lands as
  ordinary turns in canonical Hermes history. A final exact stop utterance is consumed as local
  call control before it enters even the ephemeral transcript state.
- The mobile offline read cache stores normalized session-list/timeline responses and up to 32
  gateway-accepted correction rows per session as one JSON file in the app sandbox (platform
  encryption at rest, no credentials or provider identifiers), expires after seven days, and is
  purged on sign-in and sign-out.
- A cold start whose saved-connection recheck fails for connectivity-shaped reasons degrades to
  reading that local cache with the stored tokens; it grants no new authority. An unauthorized
  recheck never degrades — it returns the device to the connect screen.
- Gateway speech holds no provider key on the device: voice mode, dictation, and message
  playback upload a recording to, or request synthesis from, the user's own gateway, which owns
  the STT and TTS credentials. Each recording lives in the app cache only until its upload
  returns and is deleted immediately afterwards, including on the failure and abandoned-cycle
  paths. The microphone runs only while the user is in voice mode or holding dictation, never in
  the background, and Wave closes the recording session before playing anything back. What the
  user says in gateway voice mode becomes an ordinary conversation turn — it is persisted by
  Hermes exactly like typed text, which is the deliberate difference from ephemeral Realtime
  transcripts.

### Transport and deployment

- Production mobile connections require HTTPS, with two deliberate carve-outs. Plain HTTP is
  accepted when the gateway host is loopback or a Tailscale CGNAT address (`100.64.0.0/10`),
  where the transport is already private and WireGuard-encrypted; bare hosts in this tier
  default to HTTP. Plain HTTP is also accepted for private LAN hosts — RFC 1918 IPv4 literals
  and mDNS `.local` names, neither of which routes beyond the local network — but only when the
  user types `http://` explicitly, because that traffic crosses the LAN unencrypted and the
  session tokens plus conversation content are readable by hosts on the same network (accepted
  2026-08-01 for trusted home networks; mDNS names are unauthenticated, the same trust level as
  a LAN IP). Bare hosts outside the Tailscale/loopback tier always default to HTTPS. Reaching
  LAN hosts requires iOS's local-network permission, declared in `app.json`. `.local` resolution
  is the platform resolver's job — iOS and current Android resolve mDNS names (validated on a
  Pixel 8 Pro on Android 17); a device that cannot falls back to the LAN IP.
- Release builds carry the same carve-outs natively (reviewed 2026-08-02): Android sets
  `android:usesCleartextTraffic="true"` because its network security config cannot scope
  cleartext to IP ranges — the app's URL policy is the scoping enforcement, and no other code
  path issues cleartext requests (OpenAI traffic is HTTPS/WSS only). iOS keeps ATS enabled
  (`NSAllowsArbitraryLoads` false) with only `NSAllowsLocalNetworking` for `.local` hosts —
  Expo's template default, now pinned explicitly in `app.json`; IP literals are exempt from
  ATS by design.
- CORS is not applicable because Wave supports native iOS and Android only.
- The mobile production export is scanned for upstream keys, server-only imports, and forbidden
  protocol strings. Dependency alignment and workspace boundaries are automated, and the
  boundary check fails if a server-side Wave backend reappears.

## Validation status

Deterministic tests cover strict schemas, token rotation and corrupted-record recovery, unknown
fields, stream ordering, reattachment, timeouts, cancellation, Realtime orchestration rules
(unknown tools, malformed arguments, duplicate tool calls, queue limits, serialization,
authorization, abort), reconnection bounds, silence detection, and redacted errors. Production
exports for iOS and Android pass the boundary scanner. Live validation against the private
gateway deployment covers sign-in, streaming, history, rename/delete, prompts, both voice modes,
and Realtime call setup/teardown on the user's own key.

The current dependency review is recorded in [`dependency-security.md`](./dependency-security.md).

Before the first store release, still complete:

- physical-iOS Realtime behavior;
- physical-device speaker, receiver, Bluetooth, and wired-route changes;
- phone/audio interruptions, lock state, and realistic Wi-Fi/cellular/private-network changes;
- signed release-build smoke tests on both platforms.

Security-sensitive changes are incomplete until their deterministic tests, production boundary
scan, documentation, and relevant private-deployment validation agree.
