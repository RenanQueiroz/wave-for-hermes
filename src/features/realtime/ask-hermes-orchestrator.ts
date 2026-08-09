/**
 * Trusted Realtime tool orchestration, steer-by-default.
 *
 * At most one ask execution — the turn owner — runs a gateway turn at a time.
 * A further ask while that owner runs is not queued client-side: it is
 * delivered into the running work immediately through one non-retrying
 * `session.redirect`, acknowledged as `steered` or `queued`, and the combined
 * outcome arrives on the owner's still-pending call. Hermes itself decides
 * whether to fold the instruction in or run it next.
 *
 * A separate correct_hermes lane may redirect only the one owner execution
 * that has explicitly entered its live gateway phase; steered asks never
 * become correction targets. All redirect dispatches — steers and
 * corrections — share one serialized chain, and every dispatch re-checks the
 * same trusted execution immediately before and after its one attempt.
 */
import {
  WaveAskHermesArgumentsSchema,
  WaveAskHermesToolResultSchema,
  WaveCorrectHermesArgumentsSchema,
  WaveCorrectHermesToolResultSchema,
  type WaveAskHermesToolErrorCode,
  type WaveAskHermesToolResult,
  type WaveCorrectHermesToolResult,
  type WaveRealtimeToolResult,
} from '@wave/contracts';

export const ASK_HERMES_TOOL_NAME = 'ask_hermes';
export const CORRECT_HERMES_TOOL_NAME = 'correct_hermes';
export const MAX_TOOL_CALLS_PER_REALTIME_CALL = 128;
/** Bound on in-flight steer deliveries, not a queue of pending work. */
export const MAX_OUTSTANDING_TOOL_CALLS = 8;
export const MAX_OUTSTANDING_CORRECTIONS = 8;
/** One steer re-evaluates at most this many times across owner changes. */
const MAX_STEER_ATTEMPTS = 3;
/** One steer dispatches `session.redirect` at most this many times. */
const MAX_STEER_DISPATCHES = 2;

export interface RealtimeToolCall {
  /** Raw JSON argument string from the model. */
  arguments: string;
  callId: string;
  name: string;
  /** The user item that initiated the response, when known. */
  userItemId?: string;
}

/**
 * The ask executor marks the narrow interval in which its gateway turn is
 * registered and can safely accept `session.redirect`, and may report the
 * turn's sealed interim narration as bounded progress.
 */
export interface HermesExecutionLifecycle {
  activate(): void;
  deactivate(): void;
  /** Sealed interim assistant narration from the running turn, in order. */
  progress?(text: string): void;
}

/** Sealed interim segments forwarded per owner execution. */
export const MAX_PROGRESS_NOTES_PER_EXECUTION = 16;

interface ToolExecution {
  active: boolean;
  callIds: Set<string>;
  progressNotes: number;
  /** Resolves when the owner's redirect lane opens or its turn settles. */
  ready: Promise<void>;
  resolveReady: () => void;
  result?: WaveAskHermesToolResult;
}

export class AskHermesOrchestrator {
  private aborted = false;
  private activeExecution?: ToolExecution;
  private correctionOutstanding = 0;
  private readonly deliver: (
    callId: string,
    result: WaveRealtimeToolResult,
  ) => void;
  private readonly executeAsk: (
    instruction: string,
    signal: AbortSignal,
    lifecycle: HermesExecutionLifecycle,
  ) => Promise<WaveAskHermesToolResult>;
  private readonly executeCorrection?: (
    instruction: string,
    signal: AbortSignal,
  ) => Promise<WaveCorrectHermesToolResult>;
  private readonly executionsByKey = new Map<string, ToolExecution>();
  private readonly handledCallIds = new Set<string>();
  private readonly isAuthorized: () => boolean;
  private readonly onActiveExecutionChange?: (active: boolean) => void;
  private readonly onProgress?: (text: string) => void;
  /** The execution whose gateway turn is currently running. */
  private ownerExecution?: ToolExecution;
  /** One serialized chain for every redirect dispatch (steers, corrections). */
  private redirectQueue: Promise<void> = Promise.resolve();
  private readonly signalController = new AbortController();
  private steerOutstanding = 0;

  constructor(options: {
    deliver(callId: string, result: WaveRealtimeToolResult): void;
    execute(
      instruction: string,
      signal: AbortSignal,
      lifecycle: HermesExecutionLifecycle,
    ): Promise<WaveAskHermesToolResult>;
    executeCorrection?(
      instruction: string,
      signal: AbortSignal,
    ): Promise<WaveCorrectHermesToolResult>;
    isAuthorized(): boolean;
    onActiveExecutionChange?(active: boolean): void;
    onProgress?(text: string): void;
  }) {
    this.deliver = options.deliver;
    this.executeAsk = options.execute;
    this.executeCorrection = options.executeCorrection;
    this.isAuthorized = options.isAuthorized;
    this.onActiveExecutionChange = options.onActiveExecutionChange;
    this.onProgress = options.onProgress;
  }

  /** Stop executing; in-flight work is aborted and nothing more delivers. */
  abort() {
    if (this.aborted) return;
    this.aborted = true;
    if (this.activeExecution) {
      this.activeExecution.active = false;
      this.activeExecution = undefined;
      this.notifyActiveExecution(false);
    }
    this.signalController.abort();
  }

  handleToolCall(toolCall: RealtimeToolCall) {
    if (this.aborted || this.handledCallIds.has(toolCall.callId)) return;

    // One bounded budget covers ask, correct, malformed, and stale calls.
    if (this.handledCallIds.size >= MAX_TOOL_CALLS_PER_REALTIME_CALL) {
      this.deliverResult(
        toolCall.callId,
        toolError(
          'busy',
          'This live voice call reached its tool-call limit.',
          false,
        ),
      );
      return;
    }
    this.handledCallIds.add(toolCall.callId);

    if (toolCall.name === ASK_HERMES_TOOL_NAME) {
      this.handleAsk(toolCall);
      return;
    }
    if (toolCall.name === CORRECT_HERMES_TOOL_NAME) {
      this.handleCorrection(toolCall);
      return;
    }
    this.deliverResult(
      toolCall.callId,
      toolError(
        'unknown_tool',
        'Wave does not support the requested tool.',
        false,
      ),
    );
  }

  private handleAsk(toolCall: RealtimeToolCall) {
    const rawArguments = parseArguments(toolCall.arguments);
    const parsed = WaveAskHermesArgumentsSchema.safeParse(rawArguments);
    if (!parsed.success) {
      this.deliverResult(
        toolCall.callId,
        toolError(
          'invalid_arguments',
          'The ask_hermes arguments were invalid.',
          false,
        ),
      );
      return;
    }
    if (!this.isAuthorized()) {
      this.deliverResult(
        toolCall.callId,
        toolError(
          'unauthorized',
          'This Wave call is no longer authorized for Hermes.',
          false,
        ),
      );
      return;
    }

    // A model retry of the same instruction within one user turn reattaches
    // to the existing execution instead of dispatching duplicate work — for
    // steered instructions that means the same acknowledgement, never a
    // second redirect.
    const executionKey = JSON.stringify([
      toolCall.userItemId ?? `tool:${toolCall.callId}`,
      parsed.data.instruction,
    ]);
    const existing = this.executionsByKey.get(executionKey);
    if (existing) {
      existing.callIds.add(toolCall.callId);
      if (existing.result) {
        this.deliverResult(toolCall.callId, existing.result);
      }
      return;
    }

    const execution = createExecution(toolCall.callId);
    this.executionsByKey.set(executionKey, execution);

    if (!this.ownerExecution) {
      this.startOwnerTurn(execution, parsed.data.instruction);
      return;
    }

    // Busy: no client-side queue. Deliver the instruction into the running
    // Hermes work as a steer, bounded and serialized with corrections.
    if (!this.executeCorrection) {
      this.settleAsk(
        execution,
        toolError(
          'busy',
          'Hermes is already working; try again when it finishes.',
          true,
        ),
      );
      return;
    }
    if (this.steerOutstanding >= MAX_OUTSTANDING_TOOL_CALLS) {
      this.settleAsk(
        execution,
        toolError(
          'busy',
          'This live call has too many Hermes requests in flight.',
          true,
        ),
      );
      return;
    }
    this.steerOutstanding += 1;
    this.redirectQueue = this.redirectQueue.then(async () => {
      try {
        await this.runSteer(execution, parsed.data.instruction);
      } finally {
        this.steerOutstanding -= 1;
      }
    });
  }

  /**
   * Deliver one busy ask into the running work. Re-evaluates across owner
   * changes (bounded), waits for the owner's redirect lane to open, and
   * falls back to becoming the new owner when the turn completed first.
   */
  private async runSteer(
    execution: ToolExecution,
    instruction: string,
    attempt = 0,
    dispatches = 0,
  ): Promise<void> {
    if (this.aborted) {
      this.settleAsk(
        execution,
        toolError('cancelled', 'The live voice call ended.', false),
      );
      return;
    }
    if (attempt >= MAX_STEER_ATTEMPTS || dispatches >= MAX_STEER_DISPATCHES) {
      this.settleAsk(
        execution,
        toolError(
          'busy',
          'Hermes could not accept that request right now; ask again.',
          true,
        ),
      );
      return;
    }
    const owner = this.ownerExecution;
    if (!owner || owner === execution) {
      // The running turn settled before this steer could land; this
      // instruction becomes the new turn owner exactly once.
      this.startOwnerTurn(execution, instruction);
      return;
    }
    await owner.ready;
    if (this.aborted) {
      this.settleAsk(
        execution,
        toolError('cancelled', 'The live voice call ended.', false),
      );
      return;
    }
    if (this.activeExecution !== owner || !owner.active) {
      // The owner finished (or never opened its lane); re-evaluate.
      await this.runSteer(execution, instruction, attempt + 1, dispatches);
      return;
    }

    let outcome: WaveCorrectHermesToolResult;
    try {
      outcome = WaveCorrectHermesToolResultSchema.parse(
        await this.executeCorrection!(
          instruction,
          this.signalController.signal,
        ),
      );
    } catch {
      this.settleAsk(
        execution,
        toolError(
          'upstream_unavailable',
          'Hermes could not accept that request.',
          true,
        ),
      );
      return;
    }
    if (outcome.ok) {
      this.settleAsk(
        execution,
        outcome.status === 'redirected' ? steeredAck() : queuedAck(),
      );
      return;
    }
    if (outcome.status === 'nothing_active') {
      // Completion race: the turn ended as the redirect landed. Re-evaluate —
      // either a new owner exists to steer, or this instruction runs itself.
      await this.runSteer(execution, instruction, attempt + 1, dispatches + 1);
      return;
    }
    this.settleAsk(
      execution,
      toolError('busy', 'Hermes rejected that request.', false),
    );
  }

  /** Run one gateway turn as the owner; its call carries the final answer. */
  private startOwnerTurn(execution: ToolExecution, instruction: string) {
    this.ownerExecution = execution;
    void (async () => {
      const lifecycle = this.createLifecycle(execution);
      let result: WaveAskHermesToolResult;
      try {
        if (this.aborted) {
          result = toolError('cancelled', 'The live voice call ended.', false);
        } else {
          result = WaveAskHermesToolResultSchema.parse(
            await this.executeAsk(
              instruction,
              this.signalController.signal,
              lifecycle,
            ),
          );
        }
      } catch {
        result = toolError(
          'upstream_unavailable',
          'Hermes could not complete the request.',
          true,
        );
      } finally {
        lifecycle.deactivate();
        execution.resolveReady();
        if (this.ownerExecution === execution) {
          this.ownerExecution = undefined;
        }
      }
      this.settleAsk(execution, result);
    })();
  }

  private handleCorrection(toolCall: RealtimeToolCall) {
    const parsed = WaveCorrectHermesArgumentsSchema.safeParse(
      parseArguments(toolCall.arguments),
    );
    if (!parsed.success) {
      this.deliverResult(
        toolCall.callId,
        correctionRejected('The correct_hermes arguments were invalid.'),
      );
      return;
    }
    if (!this.isAuthorized()) {
      this.deliverResult(
        toolCall.callId,
        correctionRejected(
          'This Wave call is no longer authorized for Hermes.',
        ),
      );
      return;
    }
    const target = this.activeExecution;
    if (!target || !target.active || !this.executeCorrection) {
      this.deliverResult(toolCall.callId, nothingActive());
      return;
    }
    if (this.correctionOutstanding >= MAX_OUTSTANDING_CORRECTIONS) {
      this.deliverResult(
        toolCall.callId,
        correctionRejected('Too many corrections are already waiting.', true),
      );
      return;
    }

    this.correctionOutstanding += 1;
    this.redirectQueue = this.redirectQueue.then(async () => {
      let result: WaveCorrectHermesToolResult;
      try {
        if (
          this.aborted ||
          !this.isAuthorized() ||
          this.activeExecution !== target ||
          !target.active
        ) {
          result = nothingActive();
        } else {
          result = WaveCorrectHermesToolResultSchema.parse(
            await this.executeCorrection!(
              parsed.data.instruction,
              this.signalController.signal,
            ),
          );
          // Completion wins a redirect race even if the gateway happened to
          // answer the mutation: stale authority never carries forward.
          if (this.activeExecution !== target || !target.active) {
            result = nothingActive();
          }
        }
      } catch {
        result = correctionRejected('Hermes could not apply that correction.');
      } finally {
        this.correctionOutstanding -= 1;
      }
      this.deliverResult(toolCall.callId, result);
    });
  }

  private createLifecycle(execution: ToolExecution): HermesExecutionLifecycle {
    return {
      activate: () => {
        if (
          this.aborted ||
          execution.active ||
          this.ownerExecution !== execution
        ) {
          return;
        }
        execution.active = true;
        this.activeExecution = execution;
        execution.resolveReady();
        this.notifyActiveExecution(true);
      },
      deactivate: () => {
        if (!execution.active) return;
        execution.active = false;
        if (this.activeExecution === execution) {
          this.activeExecution = undefined;
          this.notifyActiveExecution(false);
        }
      },
      progress: (text: string) => {
        if (
          this.aborted ||
          this.ownerExecution !== execution ||
          execution.progressNotes >= MAX_PROGRESS_NOTES_PER_EXECUTION ||
          !this.onProgress
        ) {
          return;
        }
        execution.progressNotes += 1;
        try {
          this.onProgress(text);
        } catch {
          // Progress is best effort; the turn and its answer are primary.
        }
      },
    };
  }

  private notifyActiveExecution(active: boolean) {
    try {
      this.onActiveExecutionChange?.(active);
    } catch {
      // Advertising is best effort; trusted execution state remains primary.
    }
  }

  private settleAsk(execution: ToolExecution, result: WaveAskHermesToolResult) {
    execution.result = result;
    for (const callId of execution.callIds) {
      this.deliverResult(callId, result);
    }
  }

  private deliverResult(callId: string, result: WaveRealtimeToolResult) {
    if (this.aborted) return;
    this.deliver(callId, result);
  }
}

function createExecution(callId: string): ToolExecution {
  let resolveReady!: () => void;
  const ready = new Promise<void>((resolve) => {
    resolveReady = resolve;
  });
  return {
    active: false,
    callIds: new Set([callId]),
    progressNotes: 0,
    ready,
    resolveReady,
  };
}

function parseArguments(serialized: string): unknown {
  try {
    return JSON.parse(serialized);
  } catch {
    return undefined;
  }
}

function steeredAck(): WaveAskHermesToolResult {
  return WaveAskHermesToolResultSchema.parse({
    note: 'Delivered into the active Hermes work. The combined result arrives with the original request; do not resend this instruction.',
    ok: true,
    status: 'steered',
  });
}

function queuedAck(): WaveAskHermesToolResult {
  return WaveAskHermesToolResultSchema.parse({
    note: 'Hermes queued this to run right after the current work; it runs automatically. Do not resend this instruction.',
    ok: true,
    status: 'queued',
  });
}

function toolError(
  code: WaveAskHermesToolErrorCode,
  message: string,
  retryable: boolean,
): WaveAskHermesToolResult {
  return WaveAskHermesToolResultSchema.parse({
    error: { code, message, retryable },
    ok: false,
  });
}

function nothingActive(): WaveCorrectHermesToolResult {
  return WaveCorrectHermesToolResultSchema.parse({
    message: 'There is no active Hermes work to correct.',
    ok: false,
    retryable: false,
    status: 'nothing_active',
  });
}

function correctionRejected(
  message: string,
  retryable = false,
): WaveCorrectHermesToolResult {
  return WaveCorrectHermesToolResultSchema.parse({
    message,
    ok: false,
    retryable,
    status: 'rejected',
  });
}
