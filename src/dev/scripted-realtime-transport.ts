/**
 * Development-only Realtime transport with no WebRTC: the SDP exchange is
 * synthetic and transport events are driven by standard OpenAI-shaped frames
 * teed from the harness sideband socket (`realtime-harness-impl.ts`).
 *
 * It reuses the production `parseRealtimeServerEvent` mapping so a scripted
 * call exercises the same event grammar as a real one; frames that are not
 * transport events (the sideband's own traffic) parse to `undefined` and are
 * dropped, and malformed frames never fail a scripted call.
 */
// Relative imports with extensions: this module is exercised by the node
// test runner, which resolves neither the `@/` alias nor extensionless paths.
import {
  parseRealtimeServerEvent,
  RealtimeTransportError,
  type PreparedRealtimeTransport,
  type PrepareRealtimeTransportOptions,
  type RealtimeTransport,
  type RealtimeTransportEvent,
} from '../services/realtime/realtime-transport.ts';

const HARNESS_SDP_OFFER = 'v=0\r\ns=wave-realtime-harness\r\n';

export class ScriptedRealtimeTransport implements RealtimeTransport {
  private microphoneEnabled = true;
  private onEvent: ((event: RealtimeTransportEvent) => void) | undefined;

  /** Visible for tests and the dev state surface. */
  getMicrophoneEnabled(): boolean {
    return this.microphoneEnabled;
  }

  /**
   * Feed one raw frame from the harness. Only frames that map to transport
   * events reach the controller; `error`-typed results are dropped because a
   * non-transport sideband frame must never end a scripted call.
   */
  deliverFrame(raw: string): void {
    const event = parseRealtimeServerEvent(raw);
    if (!event || event.type === 'error') return;
    this.onEvent?.(event);
  }

  async prepare(
    options: PrepareRealtimeTransportOptions,
  ): Promise<PreparedRealtimeTransport> {
    this.onEvent = options.onEvent;
    return {
      close: () => {
        this.onEvent = undefined;
      },
      connect: async (sdpAnswer: string, _signal: AbortSignal) => {
        if (!sdpAnswer.startsWith('v=')) {
          throw new RealtimeTransportError(
            'The harness returned an invalid SDP answer.',
            { kind: 'protocol' },
          );
        }
        this.onEvent?.({ count: 1, type: 'remote_audio_tracks' });
      },
      sdpOffer: HARNESS_SDP_OFFER,
      setMicrophoneEnabled: (enabled: boolean) => {
        this.microphoneEnabled = enabled;
      },
    };
  }
}
