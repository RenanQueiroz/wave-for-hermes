/**
 * Gateway turn events → Wave turn events.
 *
 * The chat reducer consumes `WaveTurnEvent`s (sequence-numbered, with
 * `turn.started` first). The gateway pushes untyped `{type,payload}` frames
 * with no sequence numbers and no turn identity, so this translator supplies
 * both: it owns a monotonic counter per turn and stamps the Wave-side turn id
 * it was constructed with.
 *
 * The v0.20 extensions are projected narrowly: interim assistant text becomes
 * a sealed segment, tool progress updates one bounded Task preview, and only
 * reviewed lifecycle kinds become Wave-owned activity states. Optional or
 * future gateway events must never break a turn in progress.
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
const MAX_MCP_SERVER_CHARS = 200;
const MAX_SESSION_ID_CHARS = 256;
const MAX_SESSION_TITLE_CHARS = 300;

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

function boundedIdentifier(value: unknown, max = MAX_SESSION_ID_CHARS) {
  if (typeof value !== 'string') return undefined;
  const bounded = value.trim();
  return bounded &&
    bounded.length <= max &&
    !/[\u0000-\u001f\u007f/?#\\]/.test(bounded)
    ? bounded
    : undefined;
}

/**
 * Stateful per turn: `translate` returns zero or more Wave events for each
 * gateway frame, assigning sequence numbers in arrival order.
 */
export class GatewayTurnTranslator {
  private sequence = -1;
  private assistantStarted = false;
  private activeToolName?: string;
  private completed = false;
  private content = '';
  private lastInterimContent?: string;
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
        this.content = `${this.content}${text}`.slice(0, MAX_CONTENT_CHARS);
        events.push({
          ...this.base('assistant.delta'),
          delta: text.slice(0, MAX_DELTA_CHARS),
          messageId: this.messageId,
        } as WaveTurnEvent);
        return events;
      }
      case 'reasoning.delta': {
        // Emission is gated server-side by `show_reasoning`; with Codex
        // providers the commentary channel arrives separately as interim
        // messages, so this carries only the private reasoning trace.
        const text =
          stringField(frame.payload, 'text') ??
          stringField(frame.payload, 'delta');
        if (!text) return [];
        return [
          ...this.ensureAssistantStarted(),
          {
            ...this.base('reasoning.delta'),
            delta: text.slice(0, MAX_DELTA_CHARS),
            messageId: this.messageId,
          } as WaveTurnEvent,
        ];
      }
      case 'message.interim': {
        const text = stringField(frame.payload, 'text')?.trim();
        if (!text) return [];
        const events = [
          ...this.resolvePendingPrompt(),
          ...this.ensureAssistantStarted(),
          {
            ...this.base('assistant.interim'),
            content: text.slice(0, MAX_CONTENT_CHARS),
            messageId: this.messageId,
          } as WaveTurnEvent,
        ];
        // The sealed text was already streamed through message.delta on the
        // normal v0.20 path. A later delta belongs to a fresh segment, and the
        // final completion may replace only that fresh tail.
        this.content = '';
        this.lastInterimContent = text.slice(0, MAX_CONTENT_CHARS);
        return events;
      }
      case 'tool.start': {
        // {tool_id, name, context} — args arrive with tool.complete.
        const toolName = stringField(frame.payload, 'name');
        this.activeToolName = toolName?.slice(0, MAX_TOOL_NAME_CHARS);
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
        const toolName =
          stringField(frame.payload, 'name') ?? this.activeToolName;
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
        this.activeToolName = undefined;
        return events;
      }
      case 'tool.progress': {
        const events = this.resolvePendingPrompt();
        const toolName =
          stringField(frame.payload, 'name') ?? this.activeToolName;
        const toolOutput = toToolDetail(stringField(frame.payload, 'preview'));
        if (!toolName && !toolOutput) return events;
        events.push({
          ...this.base('tool.status'),
          messageId: this.messageId,
          status: 'progress',
          ...(toolName
            ? { toolName: toolName.slice(0, MAX_TOOL_NAME_CHARS) }
            : {}),
          ...(toolOutput ? { toolOutput, toolOutputIsPreview: true } : {}),
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
      case 'mcp.setup.request': {
        // Desktop can install/enable/authorize the requested server. Wave is
        // deliberately not a Hermes administration surface, so this becomes
        // a bounded decline-only prompt. `source: wave` should prevent the
        // tool from being offered; this path keeps an unexpected request from
        // parking the turn for its ten-minute timeout.
        const requestId = boundedIdentifier(frame.payload.request_id, 128);
        const server = stringField(frame.payload, 'server')
          ?.trim()
          .slice(0, MAX_MCP_SERVER_CHARS);
        if (!requestId || !server) return [];
        const events = this.resolvePendingPrompt();
        this.pendingPromptId = requestId;
        const rawAction = stringField(frame.payload, 'action');
        const action =
          rawAction === 'authorize' ||
          rawAction === 'enable' ||
          rawAction === 'install'
            ? rawAction
            : 'configure';
        const reason = stringField(frame.payload, 'reason')?.trim();
        const description = [
          `Hermes wants to ${action} the ${server} MCP server.`,
          reason,
        ]
          .filter(Boolean)
          .join(' ')
          .slice(0, MAX_PROMPT_DESCRIPTION_CHARS);
        events.push({
          ...this.base('prompt.request'),
          allowsFreeText: false,
          choices: [],
          description,
          kind: 'mcp-setup',
          messageId: this.messageId,
          promptId: requestId,
          server,
          type: 'prompt.request',
        } as WaveTurnEvent);
        return events;
      }
      case 'clarify.expire':
      case 'mcp.setup.expire':
      case 'secret.expire':
      case 'sudo.expire': {
        const requestId = boundedIdentifier(frame.payload.request_id, 128);
        return requestId && requestId === this.pendingPromptId
          ? this.resolvePendingPrompt()
          : [];
      }
      case 'session.title': {
        const storedSessionId = boundedIdentifier(frame.payload.session_id);
        const title = stringField(frame.payload, 'title')
          ?.trim()
          .slice(0, MAX_SESSION_TITLE_CHARS);
        if (!storedSessionId || !title) return [];
        return [
          {
            ...this.base('session.title.updated'),
            storedSessionId,
            title,
          } as WaveTurnEvent,
        ];
      }
      case 'message.complete': {
        const content = stringField(frame.payload, 'text');
        const previewWasFinalized = frame.payload.response_previewed === true;
        return this.finish({
          content,
          interrupted: false,
          replacesLastInterim: Boolean(
            content &&
            this.lastInterimContent &&
            this.content.length === 0 &&
            previewWasFinalized &&
            content.startsWith(this.lastInterimContent),
          ),
        });
      }
      case 'message.end':
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
      case 'status.update': {
        const status = waveActivityStatus(frame.payload);
        if (!status) return [];
        return [
          {
            ...this.base('activity.status'),
            status,
          } as WaveTurnEvent,
        ];
      }
      default:
        // session.info (including tools/skills) and future frames have no
        // transcript projection.
        return [];
    }
  }

  /**
   * Any substantive turn frame after a prompt proves the wait ended — answered
   * here, answered by another client, or expired server-side (approvals time
   * out at 60s, clarify at 300s). Ephemeral status updates deliberately do not
   * clear the prompt.
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
  finish(options: {
    content?: string;
    interrupted: boolean;
    replacesLastInterim?: boolean;
  }): WaveTurnEvent[] {
    if (this.completed) return [];
    this.completed = true;
    const events = [
      ...this.resolvePendingPrompt(),
      ...(this.assistantStarted ? [] : this.ensureAssistantStarted()),
    ];
    events.push(
      {
        ...this.base('assistant.completed'),
        content: (options.content ?? this.content).slice(0, MAX_CONTENT_CHARS),
        interrupted: options.interrupted,
        messageId: this.messageId,
        partial: options.interrupted,
        ...(options.replacesLastInterim ? { replacesLastInterim: true } : {}),
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

function waveActivityStatus(
  payload: Record<string, unknown>,
): Extract<WaveTurnEvent, { type: 'activity.status' }>['status'] | undefined {
  const kind = stringField(payload, 'kind')?.trim().toLowerCase();
  const text = stringField(payload, 'text')?.trim();
  if (kind === 'compacting') return 'compacting';
  if (kind === 'compacted') return 'ready';
  if (kind === 'process' && text) return 'process-updated';
  if (kind === 'goal' && text) {
    if (text.startsWith('✓')) return 'goal-complete';
    if (text.startsWith('↻')) return 'goal-continuing';
    if (text.startsWith('⏸')) return 'goal-paused';
    return undefined;
  }
  if (kind === 'status' && text?.toLowerCase() === 'ready') return 'ready';
  return undefined;
}
