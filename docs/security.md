# Wave security model

Wave is a private native client for a user's Hermes account. This document records the assets,
trust boundaries, abuse cases, implemented controls, and remaining release gates for the mobile
app, Wave Companion, and shared protocol. It complements
[`architecture.md`](./architecture.md) and the environment-specific controls owned by Homelab.

## Assets and trust boundaries

The highest-value assets are:

- the standard OpenAI API key and Hermes API Server key;
- paired-device credentials and the Companion authorization database;
- Hermes conversations, attachments, tool details, and finalized Wave voice transcripts;
- active OpenAI Realtime calls, microphone audio, and server-side tool dispatch;
- Hermes's ability to perform work through its configured tools.

Trust is deliberately split:

1. The mobile process is an untrusted API client. It may hold one revocable device credential in
   platform secure storage, but it never receives either upstream API key.
2. The Wave Companion is the only production backend. It authenticates devices, validates Wave
   schemas, normalizes upstream data, and owns Realtime call and tool state.
3. Hermes and OpenAI are upstream services. Their payloads are untrusted until the Companion
   validates and normalizes them.
4. Nginx and Tailscale are the private production edge. Homelab owns their exact routing, TLS,
   logging, container, and secret policy.
5. PanelUI and React components render normalized Wave state. They never construct protocol
   messages or execute content-derived behavior.

A paired device intentionally has account-level conversation access: it can read, continue,
rename, and delete the same top-level Hermes sessions as another paired device. Pairing is
therefore equivalent to granting access to that Wave Gateway account, not to one conversation.

## Threats and controls

### Credential theft and stale devices

- Device credentials are random 256-bit bearer values stored with
  `WHEN_UNLOCKED_THIS_DEVICE_ONLY`; only SHA-256 verifiers are persisted by the Companion.
- Pairing codes contain 80 random bits, expire, are single-use, and are redeemed atomically under
  a stricter rate limit.
- Connected **Disconnect** calls authenticated `DELETE /v1/device`, which can revoke only the
  caller. The same Companion process cancels that device's active text and Realtime work before
  the app clears local secure state.
- A local-only forget action is labeled as such and warns that operator revocation may still be
  required when the Gateway is unreachable.
- Operator listing and revocation never print credential values.

Residual risk: a copied device credential has the paired account's conversation authority until
the user or operator revokes it. Wave does not currently rotate active device credentials.

### Pairing replay and brute force

- A pairing code can be consumed once and is deleted from effective use after expiry.
- Pairing redemption has a five-attempt-per-minute process-local limiter in addition to the global
  request limit.
- Invalid, expired, consumed, and unknown codes return the same safe authorization failure.

Residual risk: process-local limits assume one Companion replica. Multi-replica deployment
requires a shared limiter and coordinated authorization state before it is supported.

### Protocol expansion, SSRF, and administration access

- The mobile app uses fixed `WaveBackendClient` methods and strict identifiers; it cannot select a
  Hermes/OpenAI URL, method, header, model, provider, run ID, tool, or arbitrary endpoint.
- Companion configuration rejects credentials, queries, and fragments in the Hermes URL and
  requires HTTPS unless private HTTP is explicitly enabled by the operator.
- Redirects are refused by the mobile client. The Companion exposes no generic proxy, upload
  filesystem, provider configuration, skill, model, or job mutation route.
- Read-only operational surfaces require their own strict Wave schema and explicit adapter.

### Realtime tool abuse and prompt injection

- The Realtime session exposes exactly `ask_hermes({ instruction })`. Its JSON Schema is generated
  from the same strict Zod schema used at dispatch; unknown tools, keys, and model-selected session
  IDs fail closed.
- The Companion binds the Hermes session to authenticated call state and reauthorizes the device
  before every dispatch.
- Per-call tool count, outstanding queue size, execution time, output length, and call lifetime are
  bounded. Duplicate normalized instructions within one user item share one execution.
- Tool results are structured, bounded, and returned only through the originating provider call.
- Wave does not add a second user-approval prompt; Hermes's own tool safety policy remains the
  authority for side effects.

Residual risk: the instruction is user/model-controlled content sent to a capable Hermes agent.
Strict transport validation prevents protocol broadening, but it cannot make a permitted Hermes
tool harmless. Hermes tool policy and deployment isolation remain mandatory.

### Cross-device and lifecycle races

- Account-wide session visibility is intentional and covered by cross-device tests.
- Text turns are limited per device and session. Realtime calls are limited per device, session,
  and process.
- Session deletion reserves both text and Realtime registries before the upstream delete and
  rejects deletion while work is active.
- Self-revocation aborts admitted work. A text turn rechecks authorization after session lookup,
  and a Realtime setup that finishes after concurrent revocation closes its provider call and
  fails.
- Server shutdown aborts all text work and closes all Realtime calls. Late completions cannot
  revive released call state.

### Resource exhaustion and malformed content

- Fastify applies a 6,000,000-byte request-body ceiling, request timeouts, a global request limit,
  and stricter pairing/Realtime setup limits.
- Shared schemas bound identifiers, text, attachment count, decoded image bytes, text files, SDP,
  tool input/output, transcripts, handoff instructions, and tool results.
- Text streams enforce first-event, idle, and total timeouts. Realtime setup, sideband connection,
  tools, calls, and reconnect behavior are separately bounded.
- Mobile JSON reads, SSE frames, ordered sequences, stream identities, idle time, and total time
  are bounded. Oversized responses are cancelled while streaming.
- Unknown request fields and upstream event variants fail closed.

### Sensitive-data disclosure

- Safe errors contain a Wave code, retryability, user-safe message, and optional Wave request ID;
  they omit upstream bodies, headers, stack traces, URLs, and provider identifiers.
- Operational logs redact credentials and authorization headers. The production edge uses a
  pathless Wave access log so session and turn identifiers are omitted.
- Diagnostics exclude credentials, server addresses, device identifiers, and conversation
  content.
- Tool details are bounded and rendered as inert code, never Markdown. The interaction ledger
  stores finalized text and correlation metadata, but no raw audio, partial speech, provider IDs,
  or hidden reasoning.
- The Companion database and its SQLite sidecars are sensitive even though bearer credentials are
  hashed; deployment keeps them on an operator-owned private writable mount.

### Transport and deployment

- Production mobile connections require HTTPS. Homelab exposes `/wave/` only through private
  Tailscale HTTPS and Nginx; Companion and Hermes ports remain unpublished.
- CORS is disabled because Wave supports native iOS and Android only.
- The Companion container runs non-root with a read-only root filesystem, dropped capabilities,
  a digest-pinned Node base image, and one dedicated writable state directory.
- The mobile production export is scanned for upstream keys, server-only imports, and forbidden
  protocol strings. Dependency alignment and workspace boundaries are automated.

## Validation status

Deterministic tests cover strict schemas, one-time pairing, credential revocation, cross-device
visibility, unknown fields, oversized requests and responses, stream ordering, disconnects,
timeouts, cancellation, session-deletion exclusion, Realtime authorization, unknown tools,
malformed arguments, duplicate tool calls, queue limits, late completion, shutdown, and redacted
errors. Production exports for iOS and Android pass the boundary scanner. The pinned Homelab
deployment validates private ingress, unauthenticated rejection, device lifecycle, streaming,
history, cancellation, and Realtime cleanup.

Before the first store release, still complete:

- physical-iOS Realtime behavior;
- physical-device speaker, receiver, Bluetooth, and wired-route changes;
- phone/audio interruptions, lock state, and realistic Wi-Fi/cellular/private-network changes;
- signed release-build smoke tests on both platforms;
- edge-level ambiguous `Content-Length`/`Transfer-Encoding`, oversized-header, and slow-client
  probes against the exact production Nginx and Node versions; and
- dependency and container vulnerability review with Expo-compatible remediation decisions rather
  than automatic incompatible upgrades.

Security-sensitive changes are incomplete until their deterministic tests, production boundary
scan, documentation, and relevant private-deployment validation agree.
