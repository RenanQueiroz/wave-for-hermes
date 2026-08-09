/**
 * Scripted OpenAI-Realtime fake: the subset of the Realtime call surface
 * Wave's `OpenAiRealtimeBackend` + sideband consume, driven by
 * `HarnessRealtimeScript` steps.
 *
 * - `POST /v1/realtime/calls` answers the SDP exchange (multipart form) with
 *   a synthetic answer and a `Location` call id. Only the dev override's
 *   fixed dummy bearer is accepted — a real-looking key is rejected so a
 *   misconfigured device fails loudly instead of leaking.
 * - The sideband socket (`/v1/realtime?call_id=…`) echoes `session.update`
 *   as a full `session.updated` (Wave's tool-surface controller does strict
 *   structural matching), journals `conversation.item.create` and
 *   `response.create`, and plays the scripted model behaviors. Speech and
 *   transcript events double as transport events through the dev override's
 *   single-socket tee.
 * - When the script is exhausted, every `response.create` is answered with
 *   an empty `response.created`/`response.done` pair so the sideband's
 *   response-gating never wedges.
 */
import type { WebSocket } from 'ws';

import type { Journal } from './journal.js';
import type { HarnessRealtimeStep } from './scenario.js';
import type { HarnessState } from './state.js';

const DUMMY_BEARER_PREFIX = 'Bearer sk-wave-harness';
const SDP_ANSWER = 'v=0\r\ns=wave-harness-answer\r\n';
const MAX_JOURNAL_OUTPUT_CHARS = 2_000;

export class OpenAiRealtimeFake {
  private callCounter = 0;
  private readonly issuedCallIds = new Set<string>();

  constructor(
    private readonly options: { journal: Journal; state: HarnessState },
  ) {}

  reset(): void {
    this.issuedCallIds.clear();
  }

  /**
   * Handle the two HTTP endpoints. Returns the response triple, or undefined
   * when the path is not a Realtime route.
   */
  async handleHttp(input: {
    authorization: string | undefined;
    body: Buffer;
    contentType: string | undefined;
    method: string;
    path: string;
  }): Promise<
    | { body: string; headers?: Record<string, string>; status: number }
    | undefined
  > {
    const { journal } = this.options;
    if (input.method === 'POST' && input.path === '/v1/realtime/calls') {
      if (!input.authorization?.startsWith(DUMMY_BEARER_PREFIX)) {
        journal.record('realtime.call.rejected', {
          reason: 'authorization is not the harness dummy bearer',
        });
        return { body: JSON.stringify({ error: 'unauthorized' }), status: 401 };
      }
      const session = await readSessionField(input.body, input.contentType);
      this.callCounter += 1;
      const callId = `harness-call-${this.callCounter}`;
      this.issuedCallIds.add(callId);
      journal.record('realtime.call.start', {
        callId,
        model: typeof session?.model === 'string' ? session.model : '',
        toolNames: toolNames(session),
      });
      return {
        body: SDP_ANSWER,
        headers: {
          'content-type': 'application/sdp',
          location: `/v1/realtime/calls/${callId}`,
        },
        status: 201,
      };
    }
    const hangup = /^\/v1\/realtime\/calls\/([^/]+)\/hangup$/.exec(input.path);
    if (input.method === 'POST' && hangup) {
      journal.record('realtime.call.hangup', { callId: hangup[1] ?? '' });
      return { body: JSON.stringify({ ok: true }), status: 200 };
    }
    return undefined;
  }

  isSidebandPath(path: string): boolean {
    return path === '/v1/realtime';
  }

  hasIssuedCall(callId: string): boolean {
    return this.issuedCallIds.has(callId);
  }

  handleSidebandSocket(ws: WebSocket, callId: string): void {
    const { journal, state } = this.options;
    const script = state.nextRealtimeScript().script ?? [];
    journal.record('realtime.sideband.open', {
      callId,
      scriptedSteps: script.length,
    });

    let counter = 0;
    let functionResults = 0;
    let responseCreates = 0;
    let responsesProduced = 0;
    let scriptRunning = true;
    const waiters: { kind: 'result' | 'response'; wake: () => void }[] = [];

    const send = (event: Record<string, unknown>) => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(event));
    };

    const autoRespond = () => {
      counter += 1;
      const id = `harness-auto-response-${counter}`;
      responsesProduced += 1;
      send({ response: { id }, type: 'response.created' });
      send({ response: { id, output: [] }, type: 'response.done' });
    };

    const wakeWaiters = (kind: 'result' | 'response') => {
      for (let index = waiters.length - 1; index >= 0; index -= 1) {
        if (waiters[index]?.kind === kind) {
          const waiter = waiters.splice(index, 1)[0];
          waiter?.wake();
        }
      }
    };

    ws.on('message', (data) => {
      let event: Record<string, unknown>;
      try {
        const parsed: unknown = JSON.parse(String(data));
        if (typeof parsed !== 'object' || parsed === null) return;
        event = parsed as Record<string, unknown>;
      } catch {
        return;
      }
      if (event.type === 'session.update') {
        const session =
          typeof event.session === 'object' && event.session !== null
            ? (event.session as Record<string, unknown>)
            : {};
        journal.record('realtime.session.update', {
          toolNames: toolNames(session),
        });
        // Full echo: Wave's tool-surface controller acknowledges only a
        // structurally matching snapshot.
        send({ session, type: 'session.updated' });
        return;
      }
      if (event.type === 'conversation.item.create') {
        const item =
          typeof event.item === 'object' && event.item !== null
            ? (event.item as Record<string, unknown>)
            : {};
        journal.record('realtime.item.create', {
          callId: typeof item.call_id === 'string' ? item.call_id : '',
          itemType: typeof item.type === 'string' ? item.type : '',
          output:
            typeof item.output === 'string'
              ? item.output.slice(0, MAX_JOURNAL_OUTPUT_CHARS)
              : '',
        });
        if (item.type === 'function_call_output') {
          functionResults += 1;
          wakeWaiters('result');
        }
        return;
      }
      if (event.type === 'response.create') {
        journal.record('realtime.response.create', {});
        responseCreates += 1;
        wakeWaiters('response');
        // The sideband marks a response in progress as soon as it asks for
        // one; with no script left to answer, close the loop here. During a
        // script, the remaining steps (or the end-of-script flush) answer.
        if (!scriptRunning) autoRespond();
        return;
      }
    });

    const waitFor = (kind: 'result' | 'response', already: () => number) => {
      const seen = already();
      if (seen > 0) return Promise.resolve();
      return new Promise<void>((resolve) => {
        waiters.push({ kind, wake: resolve });
        ws.once('close', resolve);
      });
    };

    const runStep = async (step: HarnessRealtimeStep): Promise<void> => {
      journal.record('realtime.step', { type: step.type });
      switch (step.type) {
        case 'delay':
          await sleep(step.delayMs);
          return;
        case 'user_speech': {
          counter += 1;
          const itemId = step.itemId ?? `harness-user-item-${counter}`;
          send({ type: 'input_audio_buffer.speech_started' });
          await sleep(20);
          send({ type: 'input_audio_buffer.speech_stopped' });
          send({
            item: { id: itemId, role: 'user', type: 'message' },
            type: 'conversation.item.added',
          });
          send({
            transcript: step.transcript,
            type: 'conversation.item.input_audio_transcription.completed',
          });
          return;
        }
        case 'function_call': {
          counter += 1;
          const responseId = `harness-response-${counter}`;
          const callId = step.callId ?? `harness-tool-call-${counter}`;
          responsesProduced += 1;
          send({ response: { id: responseId }, type: 'response.created' });
          send({
            response: {
              id: responseId,
              output: [
                {
                  arguments:
                    typeof step.arguments === 'string'
                      ? step.arguments
                      : JSON.stringify(step.arguments),
                  call_id: callId,
                  name: step.name,
                  type: 'function_call',
                },
              ],
            },
            type: 'response.done',
          });
          return;
        }
        case 'assistant_speech': {
          counter += 1;
          const responseId = `harness-response-${counter}`;
          responsesProduced += 1;
          send({ response: { id: responseId }, type: 'response.created' });
          send({ type: 'output_audio_buffer.started' });
          const midpoint = Math.ceil(step.text.length / 2);
          for (const piece of [
            step.text.slice(0, midpoint),
            step.text.slice(midpoint),
          ]) {
            if (!piece) continue;
            send({
              delta: piece,
              type: 'response.output_audio_transcript.delta',
            });
          }
          send({
            transcript: step.text,
            type: 'response.output_audio_transcript.done',
          });
          send({
            response: { id: responseId, output: [] },
            type: 'response.done',
          });
          send({ type: 'output_audio_buffer.stopped' });
          return;
        }
        case 'wait_function_result': {
          const seenBefore = functionResults;
          await waitFor('result', () => functionResults - seenBefore);
          return;
        }
        case 'wait_response_create': {
          const seenBefore = responseCreates;
          await waitFor('response', () => responseCreates - seenBefore);
          return;
        }
      }
    };

    void (async () => {
      send({ session: {}, type: 'session.created' });
      // Give the client's own post-open machinery a beat before scripted
      // speech starts flowing.
      await sleep(50);
      for (const step of script) {
        if (ws.readyState !== ws.OPEN) break;
        await runStep(step);
      }
      scriptRunning = false;
      // Answer any response.create that arrived during the script but was
      // not covered by a scripted response, so the sideband's gating never
      // stays stuck on responseInProgress.
      while (responseCreates > responsesProduced) autoRespond();
      journal.record('realtime.script.finished', {});
    })();
  }
}

function toolNames(session: Record<string, unknown> | undefined): string {
  const tools = Array.isArray(session?.tools) ? session.tools : [];
  return tools
    .flatMap((tool) =>
      typeof tool === 'object' &&
      tool !== null &&
      typeof (tool as { name?: unknown }).name === 'string'
        ? [(tool as { name: string }).name]
        : [],
    )
    .join(',');
}

async function readSessionField(
  body: Buffer,
  contentType: string | undefined,
): Promise<Record<string, unknown> | undefined> {
  if (!contentType?.includes('multipart/form-data')) return undefined;
  try {
    const request = new Request('http://harness.local/', {
      body: new Uint8Array(body),
      headers: { 'content-type': contentType },
      method: 'POST',
    });
    const form = await request.formData();
    const session = form.get('session');
    if (typeof session !== 'string') return undefined;
    const parsed: unknown = JSON.parse(session);
    return typeof parsed === 'object' && parsed !== null
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
