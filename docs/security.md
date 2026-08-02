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

### Voice preview generation

- `GET /v1/realtime/voices/:voiceId/sample` is device-authenticated, rate-limited, and only
  accepts voice IDs present in the Gateway-owned catalog.
- Samples are generated server-side over a short OpenAI Realtime WebSocket session using a fixed
  Wave-owned phrase; no user or model-controlled content is sent upstream, and the standard OpenAI
  key never leaves the Companion.
- Generation is serialized process-wide with an in-process cache, and the sample response is
  bounded (`WAVE_MAX_REALTIME_VOICE_SAMPLE_BYTES`) with connect and total-generation timeouts.
- Clients receive only an opaque model-derived samples version. They cache downloaded samples on
  device keyed by that version and drop other versions, so cached audio is refreshed exactly when
  the Gateway's Realtime model changes and no provider identifier crosses the Wave API.

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

- Fastify and the private production Nginx edge apply the same 6,000,000-byte request-body
  ceiling. The edge also fixes its request-header buffers and bounds incomplete headers to 15
  seconds and incomplete body reads to 30 seconds.
- Fastify applies request timeouts, a global request limit, and stricter pairing/Realtime setup
  limits.
- Shared schemas bound identifiers, text, attachment count, decoded image bytes, text files, SDP,
  tool input/output, transcripts, handoff instructions, and tool results.
- Turn replay buffers are bounded (4,096 frames / 4 MiB per turn, oldest evicted first), retained
  past the terminal event only for the bounded resume window, reattachable only by the device that
  started the turn, and purged on revocation, self-disconnect, session deletion, and shutdown.
- Text streams enforce first-event, idle, and total timeouts. Realtime setup, sideband connection,
  tools, calls, and reconnect behavior are separately bounded.
- Mobile JSON reads, SSE frames, ordered sequences, stream identities, idle time, and total time
  are bounded. Oversized responses are cancelled while streaming.
- Unknown request fields and upstream event variants fail closed.

### Sensitive-data disclosure

- Safe errors contain a Wave code, retryability, user-safe message, and optional Wave request ID;
  they omit upstream bodies, headers, stack traces, URLs, and provider identifiers.
- Operational logs redact credentials and authorization headers. The Companion request serializer
  also omits URLs, network addresses, headers, conversation identifiers, and content while keeping
  the opaque request correlation ID, method/status, and timing. Every response returns the same
  request ID in `X-Wave-Request-Id` and normalized metadata or safe errors. The production edge
  uses a pathless Wave access log.
- Diagnostics exclude credentials, server addresses, device identifiers, and conversation
  content.
- Tool details are bounded and rendered as inert code, never Markdown. The interaction ledger
  stores finalized text and correlation metadata, but no raw audio, partial speech, provider IDs,
  or hidden reasoning.
- The Companion database and its SQLite sidecars are sensitive even though bearer credentials are
  hashed; deployment keeps them on an operator-owned private writable mount.
- The mobile offline read cache stores only normalized session-list and timeline responses as one
  JSON file in the app sandbox (platform encryption at rest, no credentials or provider
  identifiers), expires after seven days, and is purged whenever the device pairs, forgets, or
  disconnects.
- A cold start whose saved-credential recheck fails for connectivity-shaped reasons degrades to
  reading that local cache with the stored device credential; it grants no new authority. An
  unauthorized or incompatible recheck never degrades — it still returns the device to the
  connect screen.
- Gateway sessions (the direct-to-gateway path) hold an access/refresh token pair in platform
  secure storage, device-only, never logged, and rotated whenever the gateway refreshes them.
  The gateway's tokens are stateless and signed: signing out deletes them locally but cannot
  revoke them server-side, so their real lifetime is their expiry (12 hours access, 30 days
  refresh) or a rotation of the gateway's signing secret. Wave says so in the disconnect flow
  rather than implying a server-side revocation it cannot perform.
- Gateway speech holds no provider key on the device: voice mode, dictation, and message playback
  upload a recording to, or request synthesis from, the user's own gateway, which owns the STT and
  TTS credentials. Each recording lives in the app cache only until its upload returns and is
  deleted immediately afterwards, including on the failure and abandoned-cycle paths. The
  microphone runs only while the user is in voice mode or holding dictation, never in the
  background, and Wave closes the recording session before playing anything back. What the user
  says in gateway voice mode becomes an ordinary conversation turn — it is persisted by Hermes
  exactly like typed text, which is the deliberate difference from ephemeral Realtime transcripts.

### Transport and deployment

- Production mobile connections require HTTPS, with two deliberate carve-outs. Plain HTTP is
  accepted when the Companion host is loopback or a Tailscale CGNAT address (`100.64.0.0/10`),
  where the transport is already private and WireGuard-encrypted; bare hosts in this tier default
  to HTTP. Plain HTTP is also accepted for private LAN hosts — RFC 1918 IPv4 literals and mDNS
  `.local` names, neither of which routes beyond the local network — but only when the user types
  `http://` explicitly, because that traffic crosses the LAN unencrypted and the device
  credential plus conversation content are readable by hosts on the same network (accepted
  2026-08-01 for trusted home networks; mDNS names are unauthenticated, the same trust level as
  a LAN IP). Bare hosts outside the Tailscale/loopback tier always default to HTTPS. Reaching
  LAN hosts requires iOS's local-network permission, declared in `app.json`. `.local` resolution
  is the platform resolver's job — iOS and current Android resolve mDNS names (validated on a
  Pixel 8 Pro on Android 17); a device that cannot falls back to the LAN IP. Homelab exposes
  `/wave/` only through private Tailscale HTTPS and Nginx; Companion and Hermes ports remain
  unpublished.
- CORS is disabled because Wave supports native iOS and Android only.
- The Companion container runs non-root with a read-only root filesystem, dropped capabilities,
  a digest-pinned Node 24 Alpine runtime, no runtime package manager, and one dedicated writable
  state directory.
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

Credential-free raw HTTP probes passed on 2026-07-31 against the exact deployed Nginx 1.30.4 and
Node 24.18.0 path. The edge rejected combined `Content-Length`/`Transfer-Encoding`, conflicting
lengths, a 128 KiB header, and a declared 6,000,001-byte body. Incomplete headers closed at 15.0
seconds and incomplete bodies at 30.0 seconds. These probes remain part of normal Homelab Wave
validation.

The 2026-07-31 dependency and container review is recorded in
[`dependency-security.md`](./dependency-security.md). It refreshed compatible
`brace-expansion` backports, retained Expo's supported build-time `xcode -> uuid` chain with an
explicit reachability assessment, found zero Companion production-workspace advisories, and moved
the package-manager-free runtime from Debian slim to Alpine. The rebuilt image was 23.8% smaller
and a checksum-verified Trivy scan found no vulnerabilities at any severity.

Before the first store release, still complete:

- physical-iOS Realtime behavior;
- physical-device speaker, receiver, Bluetooth, and wired-route changes;
- phone/audio interruptions, lock state, and realistic Wi-Fi/cellular/private-network changes;
- signed release-build smoke tests on both platforms.

Security-sensitive changes are incomplete until their deterministic tests, production boundary
scan, documentation, and relevant private-deployment validation agree.
