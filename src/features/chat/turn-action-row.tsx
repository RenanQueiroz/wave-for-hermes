/**
 * The end-of-turn action row under each completed assistant reply:
 * `time-ago · [branch] [copy] [read aloud] [refresh]` — icon-only buttons,
 * ChatGPT-mobile style, rendered only once the turn is sealed. Tapping the
 * timestamp briefly shows the absolute time. Copy takes the reply's raw
 * markdown text through a lazy accessor so streaming re-renders never carry
 * the text as a prop.
 */
import * as Clipboard from 'expo-clipboard';
import {
  Button,
  CheckIcon,
  CopyIcon,
  PauseIcon,
  PlayIcon,
  RotateCcwIcon,
  ShareNodesIcon,
  Typography,
} from 'panelui-native';
import { memo, useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';

import { formatAbsoluteTime, formatTimeAgo } from '@/features/chat/time-ago';

const TICK_MS = 60_000;
const COPY_FEEDBACK_MS = 1_500;
const ABSOLUTE_TIMEOUT_MS = 4_000;
const ICON_SIZE = 15;

/** One shared minute tick per mounted row; cheap at virtualized row counts. */
function useMinuteTick(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, []);
  return now;
}

export type TurnPlaybackStatus = 'idle' | 'loading' | 'playing';

export const TurnActionRow = memo(function TurnActionRow({
  busy,
  createdAt,
  getCopyText,
  messageId,
  onBranch,
  onPlay,
  onRegenerate,
  playbackStatus,
}: {
  /** A turn is running: branch and refresh stay visible but disabled. */
  busy: boolean;
  createdAt?: string;
  getCopyText(): string;
  messageId: string;
  onBranch?: (messageId: string) => void;
  onPlay?: (messageId: string) => void;
  onRegenerate?: (messageId: string) => void;
  playbackStatus: TurnPlaybackStatus;
}) {
  const now = useMinuteTick();
  const [copied, setCopied] = useState(false);
  const [absolute, setAbsolute] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), COPY_FEEDBACK_MS);
    return () => clearTimeout(timer);
  }, [copied]);
  useEffect(() => {
    if (!absolute) return;
    const timer = setTimeout(() => setAbsolute(false), ABSOLUTE_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [absolute]);

  return (
    <View
      className="-ml-2 flex-row items-center"
      testID={`turn-actions-${messageId}`}>
      <Pressable
        accessibilityLabel="Show the exact time of this reply"
        hitSlop={6}
        className="pl-2"
        testID={`turn-time-${messageId}`}
        onPress={() => setAbsolute((current) => !current)}>
        <Typography.Paragraph muted className="text-xs tabular-nums">
          {absolute
            ? formatAbsoluteTime(createdAt, now)
            : formatTimeAgo(createdAt, now)}
        </Typography.Paragraph>
      </Pressable>
      <Typography.Paragraph muted className="ps-3 pe-1">
        ·
      </Typography.Paragraph>
      {onBranch ? (
        <Button
          size="icon"
          variant="ghost"
          className="h-8 w-8 rounded-full"
          accessibilityLabel="Branch this conversation into a new chat"
          disabled={busy}
          testID={`turn-branch-${messageId}`}
          onPress={() => onBranch(messageId)}>
          <ShareNodesIcon size={ICON_SIZE} />
        </Button>
      ) : null}
      <Button
        size="icon"
        variant="ghost"
        className="h-8 w-8 rounded-full"
        accessibilityLabel="Copy this reply"
        testID={`turn-copy-${messageId}`}
        onPress={() => {
          const text = getCopyText();
          if (!text) return;
          void Clipboard.setStringAsync(text).then(
            () => setCopied(true),
            () => undefined,
          );
        }}>
        {copied ? (
          <CheckIcon size={ICON_SIZE} />
        ) : (
          <CopyIcon size={ICON_SIZE} />
        )}
      </Button>
      {onPlay ? (
        <Button
          size="icon"
          variant="ghost"
          className="h-8 w-8 rounded-full"
          accessibilityLabel={
            playbackStatus === 'playing'
              ? 'Stop reading this reply aloud'
              : 'Read this reply aloud'
          }
          loading={playbackStatus === 'loading'}
          testID={`turn-play-${messageId}`}
          onPress={() => onPlay(messageId)}>
          {playbackStatus === 'playing' ? (
            <PauseIcon size={ICON_SIZE} />
          ) : (
            <PlayIcon size={ICON_SIZE} />
          )}
        </Button>
      ) : null}
      {onRegenerate ? (
        <Button
          size="icon"
          variant="ghost"
          className="h-8 w-8 rounded-full"
          accessibilityLabel="Regenerate this reply"
          disabled={busy}
          testID={`turn-refresh-${messageId}`}
          onPress={() => onRegenerate(messageId)}>
          <RotateCcwIcon size={ICON_SIZE} />
        </Button>
      ) : null}
    </View>
  );
});
