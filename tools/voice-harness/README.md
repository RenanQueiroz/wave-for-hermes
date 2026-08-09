# Wave voice harness

A local fake Hermes gateway for mic-free automated voice testing. It speaks the
gateway protocol Wave's `src/services/gateway` consumes — cookie auth with
rotation on every response, single-use WS tickets, JSON-RPC turns on `/api/ws`,
buffered and clause-streamed speech — and plays scripted scenarios while
journaling everything it observed. It is a test double: no inference, no
outbound networking, no audio capture.

Protocol baseline: Hermes Agent `v2026.8.3` (the deployed gateway image), as
consumed by Wave. A Hermes upgrade that changes wire shapes must update this
package together with `src/services/gateway`.

## Why this exists

Gateway voice mode's STT happens server-side (`POST /api/audio/transcribe`), so
this harness decides what the app "heard" regardless of what the microphone
captured. Combined with the runtime-configurable gateway URL (dev builds accept
plain HTTP on localhost/LAN) and the voice screen's Send-now button — which
force-submits a capture that never crossed the speech threshold
(`use-gateway-voice.ts`, the `submitted` branch of `captureUtterance`) — the
whole gateway-voice loop runs end-to-end on a silent simulator with no app
changes and no human speech.

## Usage

```bash
npm run harness:gateway          # from the repo root; defaults to :8790/:8791
```

Then sign the dev build in through the normal connect screen with any
non-empty username/password:

- iOS simulator: `http://localhost:8790`
- Android emulator: `http://10.0.2.2:8790`

Pre-grant the microphone so the recorder starts (the recording's content is
irrelevant): `xcrun simctl privacy booted grant microphone com.renanqueiroz.wave`
on iOS, or the mobile agent's permissions tool on Android.

Typical driven flow (mobile agent): deep link to a conversation → start
gateway voice → wait for the `listening` phase in the `wave-gateway-voice`
state provider → tap `gateway-voice-secondary-button` (Send now) → the app
uploads the silent capture, the harness returns the next scripted transcript,
the scripted turn streams, and TTS plays through the scripted speech stream.

## Control API (loopback only, default `:8791`)

- `POST /control/scenario` — load a scenario (JSON body, replaces the current one)
- `GET /control/journal` — everything observed so far, in order, bounded
- `POST /control/reset` — clear scenario, journal, sessions, and issued tokens
- `GET /control/status` — gateway URL, session count, active turn count

## Scenario format

Scenarios are data, not code. All fields optional; FIFOs fall back to defaults
when drained.

```jsonc
{
  "transcripts": ["play some jazz", "stop"], // /api/audio/transcribe FIFO
  "turns": [
    // prompt.submit FIFO
    { "reply": "On it.", "replyDelayMs": 50 }, // generated delta frames
    {
      "frames": [
        // or explicit gateway frames
        { "type": "message.start" },
        { "type": "message.delta", "payload": { "text": "Working. " } },
        {
          "type": "message.interim",
          "payload": { "text": "Working.", "already_streamed": true },
        },
        { "type": "tool.start", "payload": { "name": "search" } },
        {
          "type": "tool.complete",
          "payload": { "name": "search", "result": { "output": "done" } },
          "delayMs": 200,
        },
        {
          "type": "message.complete",
          "payload": { "text": "All finished.", "status": "complete" },
        },
      ],
    },
  ],
  "redirects": [
    // session.redirect FIFO
    { "status": "redirected" },
    { "status": "queued" },
    { "status": "rejected" },
    { "errorCode": 4009 }, // JSON-RPC error instead
  ],
  "speech": { "mode": "stream", "sampleRate": 24000, "msPerChar": 15 },
  "transcribe": { "delayMs": 0, "failWith": 503 }, // fault injection
  "audioCapabilities": { "stt": true, "tts": true },
}
```

Defaults: transcripts fall back to a fixed harness sentence, turns echo the
prompt (`You said: …`), redirects answer `redirected`, speech streams PCM.

## Fidelity notes

- Every authenticated response rotates the cookie pair, so Wave's token
  harvesting is exercised on every request. `POST /control/reset` invalidates
  all tokens (the device must sign in again).
- `session.redirect` with accepted status records the correction as a stored
  user row, so timeline reconciliation matches the real gateway's
  `_record_inflight_correction` behavior.
- `session.interrupt` cancels the scripted turn and emits `turn.interrupted`.
- The speak-stream socket answers `start` → binary Int16 LE PCM → `end`
  (or `fallback` in fallback mode) with single-use tickets, matching the
  `speak_stream_ws` contract in `gateway-speech-stream.ts`.
- An empty-text redirect fails with code 4002 before journaling, like the
  real handler.

## Tests

- `npm run check` (in this package): wire-level self-tests over raw HTTP/WS.
- `test/mobile/voice-harness.integration.test.ts` (repo root): the real
  `GatewayClient` against this harness. Those tests skip until the harness is
  built — run `npm run harness:build` once, then plain `npm test` includes
  them.
