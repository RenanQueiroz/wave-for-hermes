/**
 * Slash commands in the chat composer: autocomplete, token highlight, and
 * dispatch.
 *
 * The suggestion list filters the cached gateway catalog locally (Wave opens
 * one socket per RPC, so per-keystroke `complete.slash` calls would mint a
 * ticket each — the approved command set needs no server-side argument
 * completion). A leading `/` suggests commands and skills; a `/` after
 * whitespace suggests skills only, exactly like Hermes Desktop. Dispatch
 * routes through the registry in `slash-commands.ts`; commands never reach
 * `prompt.submit` or `session.redirect` as raw text.
 *
 * The highlight renders a mirror text behind the input with the input's own
 * text made transparent while a recognized command leads the draft. Both
 * layers use the same explicit font classes and padding, so their metrics
 * agree by construction; the mirror disengages for long drafts, where the
 * multiline input can scroll internally and no overlay can track it.
 */
import { useQuery } from '@tanstack/react-query';
import { Item, Typography, XIcon } from 'panelui-native';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import {
  detectSlashTrigger,
  resolveSlashSubmission,
  type WaveSlashResolution,
} from '@/features/chat/slash-commands';
import type { GatewayClient } from '@/services/gateway/gateway-client';
import type { WaveCommandCatalogEntry } from '@/services/gateway/gateway-commands';
import type { WaveChatClient } from '@/services/wave/wave-chat-client';

const MAX_SUGGESTIONS = 12;
/** Beyond this the multiline input can scroll and the mirror would desync. */
const MAX_HIGHLIGHT_CHARS = 200;

/** Wave-owned rows merged into the catalog suggestions. */
const LOCAL_SUGGESTIONS: WaveCommandCatalogEntry[] = [
  {
    command: '/model',
    description: 'Change the model for this chat',
    kind: 'command',
    usage: 0,
  },
  {
    command: '/compress',
    description: 'Compress this conversation’s context',
    kind: 'command',
    usage: 0,
  },
  {
    command: '/title',
    description: 'Rename this conversation',
    kind: 'command',
    usage: 0,
  },
  {
    command: '/new',
    description: 'Start a new chat',
    kind: 'command',
    usage: 0,
  },
  {
    command: '/resume',
    description: 'Find another conversation',
    kind: 'command',
    usage: 0,
  },
  {
    command: '/stop',
    description: 'Stop the current response',
    kind: 'command',
    usage: 0,
  },
];

export interface SlashCommandRunResult {
  /** Bounded inert command output (never markdown). */
  output?: string;
  title: string;
}

export interface SlashComposerActions {
  onOpenModelPicker(): void;
  onOpenResume(): void;
  onPrefill(text: string): void;
  onSendExpanded(message: string, display: string): void;
  onStopTurn(): void;
  onStartNewChat(): void;
}

export function useSlashComposer({
  actions,
  baseUrl,
  chatClient,
  connectionId,
  gatewayClient,
  sessionId,
}: {
  actions: SlashComposerActions;
  baseUrl: string;
  chatClient: WaveChatClient;
  connectionId: string;
  gatewayClient: GatewayClient | undefined;
  sessionId: string;
}) {
  const [triggerSeen, setTriggerSeen] = useState(false);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<SlashCommandRunResult>();

  const catalogQuery = useQuery({
    enabled: Boolean(gatewayClient) && triggerSeen,
    gcTime: 30 * 60_000,
    queryFn: ({ signal }) => gatewayClient?.getCommandCatalog(signal),
    queryKey: ['wave', connectionId, baseUrl, 'command-catalog'],
    staleTime: 10 * 60_000,
    retry: 1,
  });
  const catalog = catalogQuery.data;

  /** Call whenever the draft or caret moves; returns the open trigger. */
  const observeDraft = useCallback((textBeforeCaret: string) => {
    const trigger = detectSlashTrigger(textBeforeCaret);
    if (trigger) setTriggerSeen(true);
    return trigger;
  }, []);

  const suggestionsFor = useCallback(
    (textBeforeCaret: string): WaveCommandCatalogEntry[] => {
      const trigger = detectSlashTrigger(textBeforeCaret);
      if (!trigger) return [];
      // The argument stage keeps the popover closed: Wave has no server-side
      // argument completion by design.
      if (/\s/.test(trigger.query)) return [];
      const query = trigger.query.toLowerCase();

      const merged = new Map<string, WaveCommandCatalogEntry>();
      if (trigger.kind === 'invocation') {
        for (const entry of LOCAL_SUGGESTIONS) merged.set(entry.command, entry);
      }
      for (const entry of catalog?.entries ?? []) {
        if (trigger.kind === 'inline' && entry.kind !== 'skill') continue;
        // Only rows Wave can actually run become suggestions.
        const resolution = resolveSlashSubmission(entry.command, catalog);
        if (!resolution || resolution.surface.kind === 'unavailable') continue;
        if (!merged.has(entry.command)) merged.set(entry.command, entry);
      }

      return [...merged.values()]
        .filter((entry) =>
          entry.command.slice(1).toLowerCase().startsWith(query),
        )
        .sort((a, b) =>
          a.kind === b.kind
            ? b.usage - a.usage || a.command.localeCompare(b.command)
            : a.kind === 'command'
              ? -1
              : 1,
        )
        .slice(0, MAX_SUGGESTIONS);
    },
    [catalog],
  );

  const run = useCallback(
    async (resolution: WaveSlashResolution) => {
      if (running) return;
      setRunning(true);
      setResult(undefined);
      try {
        switch (resolution.surface.kind) {
          case 'local': {
            switch (resolution.surface.action) {
              case 'model':
                actions.onOpenModelPicker();
                break;
              case 'new':
                actions.onStartNewChat();
                break;
              case 'resume':
                actions.onOpenResume();
                break;
              case 'stop':
                actions.onStopTurn();
                break;
            }
            return;
          }
          case 'title': {
            if (!resolution.arg) {
              setResult({ title: 'Usage: /title <new name>' });
              return;
            }
            await chatClient.updateSession(sessionId, {
              title: resolution.arg,
            });
            setResult({ title: `Renamed to “${resolution.arg}”.` });
            return;
          }
          case 'compress': {
            if (!gatewayClient) return;
            const compressed = await gatewayClient.compressSession(sessionId);
            setResult({
              title: compressed.aborted
                ? 'Compression was aborted.'
                : 'Conversation context compressed.',
            });
            return;
          }
          case 'unavailable': {
            setResult({ title: resolution.surface.reason });
            return;
          }
          case 'execute': {
            if (!gatewayClient) return;
            const command = resolution.arg
              ? `/${resolution.name} ${resolution.arg}`
              : `/${resolution.name}`;
            const directive = await gatewayClient.executeSlashCommand(
              sessionId,
              command,
            );
            if (directive.kind === 'output') {
              setResult({
                output: directive.output || '(no output)',
                title: command,
              });
            } else if (directive.kind === 'prefill') {
              actions.onPrefill(directive.message);
            } else {
              if (directive.notice) setResult({ title: directive.notice });
              actions.onSendExpanded(
                directive.message,
                directive.display ?? command,
              );
            }
            return;
          }
        }
      } catch (error) {
        setResult({
          title:
            error instanceof Error && error.message
              ? error.message
              : 'Hermes could not run that command.',
        });
      } finally {
        setRunning(false);
      }
    },
    [actions, chatClient, gatewayClient, running, sessionId],
  );

  const dismissResult = useCallback(() => setResult(undefined), []);

  return {
    catalog,
    dismissResult,
    observeDraft,
    result,
    run,
    running,
    suggestionsFor,
  };
}

export function SlashSuggestionList({
  onAccept,
  suggestions,
}: {
  onAccept(entry: WaveCommandCatalogEntry): void;
  suggestions: WaveCommandCatalogEntry[];
}) {
  if (suggestions.length === 0) return null;
  return (
    <View
      className="max-h-64 overflow-hidden rounded-2xl border border-border bg-card"
      testID="chat-slash-suggestions">
      <ScrollView keyboardShouldPersistTaps="always">
        {suggestions.map((entry) => (
          <Item
            key={entry.command}
            accessibilityLabel={`Use ${entry.command}`}
            size="sm"
            testID={`chat-slash-suggestion-${entry.command.slice(1)}`}
            onPress={() => onAccept(entry)}>
            <Item.Content>
              <Item.Title numberOfLines={1}>
                {entry.command}
                {entry.kind === 'skill' ? '  ·  skill' : ''}
              </Item.Title>
              {entry.description ? (
                <Item.Description numberOfLines={1}>
                  {entry.description}
                </Item.Description>
              ) : null}
            </Item.Content>
          </Item>
        ))}
      </ScrollView>
    </View>
  );
}

export function SlashCommandResult({
  onDismiss,
  result,
}: {
  onDismiss(): void;
  result: SlashCommandRunResult;
}) {
  return (
    <View
      className="rounded-2xl border border-border bg-card px-3 py-2"
      testID="chat-slash-result">
      <View className="flex-row items-start justify-between gap-2">
        <Typography.Paragraph className="flex-1 text-xs" weight="medium">
          {result.title}
        </Typography.Paragraph>
        <Pressable
          accessibilityLabel="Dismiss command result"
          hitSlop={8}
          testID="chat-slash-result-dismiss"
          onPress={onDismiss}>
          <XIcon size={14} />
        </Pressable>
      </View>
      {result.output ? (
        <ScrollView className="mt-1 max-h-48">
          {/* Command output is inert plain text — never markdown. */}
          <Text
            selectable
            className="font-mono text-[11px] leading-4 text-muted-foreground">
            {result.output}
          </Text>
        </ScrollView>
      ) : null}
    </View>
  );
}

/**
 * The token highlight behind a transparent-text input. Renders only while a
 * recognized command leads a short draft; the caller passes the exact same
 * font classes and horizontal padding it gives the input.
 */
export function SlashHighlightMirror({
  highlightLength,
  paddingLeft,
  paddingRight,
  text,
}: {
  highlightLength: number;
  paddingLeft: number;
  paddingRight: number;
  text: string;
}) {
  if (highlightLength <= 0 || text.length > MAX_HIGHLIGHT_CHARS) return null;
  return (
    <View
      pointerEvents="none"
      className="absolute inset-0"
      style={{ paddingLeft, paddingRight }}
      testID="chat-slash-highlight">
      <Text className="pb-1 pt-3.5 text-base leading-6 text-foreground">
        <Text className="font-semibold text-primary">
          {text.slice(0, highlightLength)}
        </Text>
        {text.slice(highlightLength)}
      </Text>
    </View>
  );
}

export function shouldMirrorHighlight(text: string, highlightLength: number) {
  return highlightLength > 0 && text.length <= MAX_HIGHLIGHT_CHARS;
}
