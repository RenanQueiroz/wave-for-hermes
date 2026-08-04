/**
 * Gateway turn events → Wave turn events.
 *
 * The chat reducer consumes `WaveTurnEvent`s (sequence-numbered, with
 * `turn.started` first). The gateway pushes untyped `{type,payload}` frames
 * with no sequence numbers and no turn identity, so this translator supplies
 * both: it owns a monotonic counter per turn and stamps the Wave-side turn id
 * it was constructed with.
 *
 * The v0.19/v0.20 baseline includes the original chat lifecycle plus optional
 * `message.interim`, `tool.progress`, and `status.update` frames. Until a frame
 * has a reviewed Wave-owned projection, it is ignored rather than surfaced;
 * optional or future gateway events must never break a turn in progress.
 */
import type { WaveTurnEvent } from '@wave/contracts';

import { toToolDetail } from './gateway-normalize.ts';

const MAX_DELTA_CHARS = 32_000;
const MAX_CONTENT_CHARS = 1_000_000;
const MAX_TOOL_NAME_CHARS = 100;
const MAX_ERROR_CHARS = 300;
const MAX_PROMPT_DESCRIPTION_CHARS = 300;
const MAX_PROMPT_QUESTION_CHARS = 2_000;
const MAX_PROMPT_CHOICES = 8;
const MAX_PROMPT_CHOICE_CHARS = 100;

/** The gateway's canonical approval responses when a frame omits them. */
const DEFAULT_APPROVAL_CHOICES = ['once', 'session', 'always', 'deny'];

export interface GatewayTurnFrame {
  payload: Record<string, unknown>;
  type: string;
}

export interface GatewayTurnTranslatorOptions {
  messageId: string;
  now?: () => Date;
  sessionId: string;
  turnId: string;
}

function stringField(payload: Record<string, unknown>, key: string) {
  const value = payload[key];
  return typeof value === 'string' ? value : undefined;
}

/**
 * Stateful per turn: `translate` returns zero or more Wave events for each
 * gateway frame, assigning sequence numbers in arrival order.
 */
export class GatewayTurnTranslator {
  private sequence = -1;
  private assistantStarted = false;
  private completed = false;
  private content = '';
  /** The prompt currently blocking the turn, until any later frame proves it settled. */
  private pendingPromptId?: string;
  private readonly messageId: string;
  private readonly now: () => Date;
  private readonly sessionId: string;
  private readonly turnId: string;

  constructor(options: GatewayTurnTranslatorOptions) {
    this.messageId = options.messageId;
    this.now = options.now ?? (() => new Date());
    this.sessionId = options.sessionId;
    this.turnId = options.turnId;
  }

  /** The `turn.started` event Wave expects before anything else. */
  start(): WaveTurnEvent {
    return this.base('turn.started') as WaveTurnEvent;
  }

  translate(frame: GatewayTurnFrame): WaveTurnEvent[] {
    if (this.completed) return [];
    switch (frame.type) {
      case 'message.start':
        return this.ensureAssistantStarted();
      case 'message.delta': {
        const text = stringField(frame.payload, 'text');
        if (!text) return [];
        const events = [
          ...this.resolvePendingPrompt(),
          ...this.ensureAssistantStarted(),
        ];
        this.content += text;
        events.push({
          ...this.base('assistant.delta'),
          delta: text.slice(0, MAX_DELTA_CHARS),
          messageId: this.messageId,
        } as WaveTurnEvent);
        return events;
      }
      case 'tool.start': {
        // {tool_id, name, context} — args arrive with tool.complete.
        const toolName = stringField(frame.payload, 'name');
        return [
          {
            ...this.base('tool.status'),
            messageId: this.messageId,
            status: 'started',
            ...(toolName
              ? { toolName: toolName.slice(0, MAX_TOOL_NAME_CHARS) }
              : {}),
          } as WaveTurnEvent,
        ];
      }
      case 'tool.complete': {
        // {tool_id, name, args, duration_s, result:{output, exit_code, error}}
        // (verified live). A truthy result.error is the failure signal — a
        // denied or timed-out approval lands here as a BLOCKED error.
        const events = this.resolvePendingPrompt();
        const toolName = stringField(frame.payload, 'name');
        const result = frame.payload.result;
        const resultRecord =
          typeof result === 'object' && result !== null
            ? (result as Record<string, unknown>)
            : undefined;
        const errorText =
          typeof resultRecord?.error === 'string' && resultRecord.error
            ? resultRecord.error
            : undefined;
        const output =
          typeof resultRecord?.output === 'string' && resultRecord.output
            ? resultRecord.output
            : undefined;
        const toolInput = toToolDetail(frame.payload.args);
        const toolOutput = toToolDetail(errorText ?? output ?? result);
        events.push({
          ...this.base('tool.status'),
          messageId: this.messageId,
          status: errorText ? 'failed' : 'completed',
          ...(toolName
            ? { toolName: toolName.slice(0, MAX_TOOL_NAME_CHARS) }
            : {}),
          ...(toolInput ? { toolInput } : {}),
          ...(toolOutput ? { toolOutput } : {}),
        } as WaveTurnEvent);
        return events;
      }
      case 'approval.request': {
        // {command, pattern_key(s), description, allow_permanent, choices}
        // (verified live). No request_id: approval.respond resolves the
        // session's oldest pending approval, so the prompt id is local.
        const events = this.resolvePendingPrompt();
        const promptId = `approval-${this.turnId}-${this.sequence + 1}`;
        this.pendingPromptId = promptId;
        const command = toToolDetail(stringField(frame.payload, 'command'));
        const description = stringField(frame.payload, 'description');
        events.push({
          ...this.base('prompt.request'),
          allowsFreeText: false,
          choices: this.promptChoices(frame.payload, DEFAULT_APPROVAL_CHOICES),
          ...(command ? { command } : {}),
          ...(description
            ? {
                description: description.slice(0, MAX_PROMPT_DESCRIPTION_CHARS),
              }
            : {}),
          kind: 'approval',
          messageId: this.messageId,
          promptId,
          type: 'prompt.request',
        } as WaveTurnEvent);
        return events;
      }
      case 'clarify.request':
      case 'secret.request':
      case 'sudo.request': {
        // clarify: {question, choices, request_id} (verified live);
        // secret/sudo: same _block mechanism, request_id-keyed. Without the
        // request_id no response can be correlated, so such a frame is noise.
        const requestId = stringField(frame.payload, 'request_id');
        if (!requestId) return [];
        const events = this.resolvePendingPrompt();
        this.pendingPromptId = requestId;
        const kind =
          frame.type === 'clarify.request'
            ? ('clarify' as const)
            : frame.type === 'secret.request'
              ? ('secret' as const)
              : ('sudo' as const);
        const question =
          stringField(frame.payload, 'question') ??
          stringField(frame.payload, 'prompt');
        events.push({
          ...this.base('prompt.request'),
          allowsFreeText: kind === 'clarify',
          choices:
            kind === 'clarify' ? this.promptChoices(frame.payload, []) : [],
          kind,
          messageId: this.messageId,
          promptId: requestId,
          ...(question
            ? { question: question.slice(0, MAX_PROMPT_QUESTION_CHARS) }
            : {}),
          type: 'prompt.request',
        } as WaveTurnEvent);
        return events;
      }
      case 'message.end':
      case 'message.complete':
      case 'turn.end':
        // message.complete is canonical on the measured baseline; the others
        // remain harmless aliases for compatible gateways.
        return this.finish({ interrupted: false });
      case 'turn.interrupted':
        return this.finish({ interrupted: true });
      case 'turn.error': {
        this.completed = true;
        const message =
          stringField(frame.payload, 'message') ??
          stringField(frame.payload, 'error') ??
          'Hermes could not complete this turn.';
        return [
          ...this.resolvePendingPrompt(),
          {
            ...this.base('turn.error'),
            error: {
              code: 'upstream_unavailable',
              message: message.slice(0, MAX_ERROR_CHARS),
              retryable: true,
            },
          } as WaveTurnEvent,
        ];
      }
      default:
        // session.info (including tools/skills), thinking/reasoning details,
        // message.interim, tool.progress, status.update, session.title, and any
        // future frame have no Stage 0 transcript projection.
        return [];
    }
  }

  /**
   * Any frame after a prompt proves the wait ended — answered here, answered
   * by another client, or expired server-side (approvals time out at 60s,
   * clarify at 300s) — so the prompt UI must clear.
   */
  private resolvePendingPrompt(): WaveTurnEvent[] {
    const promptId = this.pendingPromptId;
    if (!promptId) return [];
    this.pendingPromptId = undefined;
    return [
      {
        ...this.base('prompt.resolved'),
        promptId,
      } as WaveTurnEvent,
    ];
  }

  private promptChoices(
    payload: Record<string, unknown>,
    fallback: string[],
  ): string[] {
    const raw = payload.choices;
    const values = Array.isArray(raw)
      ? raw.flatMap((choice) =>
          typeof choice === 'string' && choice.trim()
            ? [choice.trim().slice(0, MAX_PROMPT_CHOICE_CHARS)]
            : [],
        )
      : [];
    return (values.length > 0 ? values : fallback).slice(0, MAX_PROMPT_CHOICES);
  }

  /** Terminal events for a turn that ended without an explicit end frame. */
  finish(options: { interrupted: boolean }): WaveTurnEvent[] {
    if (this.completed) return [];
    this.completed = true;
    const events = [
      ...this.resolvePendingPrompt(),
      ...(this.assistantStarted ? [] : this.ensureAssistantStarted()),
    ];
    events.push(
      {
        ...this.base('assistant.completed'),
        content: this.content.slice(0, MAX_CONTENT_CHARS),
        interrupted: options.interrupted,
        messageId: this.messageId,
        partial: options.interrupted,
      } as WaveTurnEvent,
      {
        ...this.base('turn.completed'),
        completed: !options.interrupted,
      } as WaveTurnEvent,
    );
    return events;
  }

  private ensureAssistantStarted(): WaveTurnEvent[] {
    if (this.assistantStarted) return [];
    this.assistantStarted = true;
    return [
      {
        ...this.base('assistant.started'),
        messageId: this.messageId,
      } as WaveTurnEvent,
    ];
  }

  private base(type: WaveTurnEvent['type']) {
    this.sequence += 1;
    return {
      apiVersion: 'v1' as const,
      eventId: `${this.turnId}-${this.sequence}`,
      sequence: this.sequence,
      sessionId: this.sessionId,
      timestamp: this.now().toISOString(),
      turnId: this.turnId,
      type,
    };
  }
}
