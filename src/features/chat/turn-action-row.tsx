/**
 * The end-of-turn action row under each completed assistant reply:
 * `time-ago · [branch] [copy] [read aloud] [refresh]` — icon-only buttons,
 * ChatGPT-mobile style, rendered only once the turn is sealed. Tapping the
 * timestamp briefly shows the absolute time. Copy takes the reply's raw
 * markdown text through a lazy accessor so streaming re-renders never carry
 * the text as a prop.
 */
import * as Clipboard from 'expo-clipboard';
import { memo, useEffect, useState } from 'react';

import { formatAbsoluteTime, formatTimeAgo } from '@/features/chat/time-ago';
import { NativeTurnActionRow } from '@/features/chat/turn-actions/row';
import type { TurnPlaybackStatus } from '@/features/chat/turn-actions/types';
import { useTheme } from '@/hooks/use-theme';

const TICK_MS = 60_000;
const COPY_FEEDBACK_MS = 1_500;
const ABSOLUTE_TIMEOUT_MS = 4_000;

/** One shared minute tick per mounted row; cheap at virtualized row counts. */
function useMinuteTick(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, []);
  return now;
}

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
  const theme = useTheme();
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
    <NativeTurnActionRow
      busy={busy}
      copied={copied}
      foregroundColor={theme.textSecondary}
      messageId={messageId}
      playbackStatus={playbackStatus}
      seedColor={theme.primary}
      timestamp={
        absolute
          ? formatAbsoluteTime(createdAt, now)
          : formatTimeAgo(createdAt, now)
      }
      onBranch={onBranch ? () => onBranch(messageId) : undefined}
      onCopy={() => {
        const text = getCopyText();
        if (!text) return;
        void Clipboard.setStringAsync(text).then(
          () => setCopied(true),
          () => undefined,
        );
      }}
      onPlay={onPlay ? () => onPlay(messageId) : undefined}
      onRegenerate={onRegenerate ? () => onRegenerate(messageId) : undefined}
      onTimestampPress={() => setAbsolute((current) => !current)}
    />
  );
});
