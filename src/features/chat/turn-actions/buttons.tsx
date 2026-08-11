import { NativeIconButton } from '@/components/native-icon-button';
import { TURN_ACTION_ICONS } from '@/features/chat/turn-actions/icons';
import type { NativeTurnActionButtonsProps } from '@/features/chat/turn-actions/row.types';

/** Shared action semantics; each button resolves to its platform-native tree. */
export function NativeTurnActionButtons({
  busy,
  copied,
  foregroundColor,
  messageId,
  onBranch,
  onCopy,
  onPlay,
  onRegenerate,
  playbackStatus,
}: NativeTurnActionButtonsProps) {
  return (
    <>
      {onBranch ? (
        <NativeIconButton
          accessibilityLabel="Branch conversation from this response"
          disabled={busy}
          foregroundColor={foregroundColor}
          icon={TURN_ACTION_ICONS.branch}
          testID={`turn-branch-${messageId}`}
          onPress={onBranch}
        />
      ) : null}
      <NativeIconButton
        accessibilityLabel={copied ? 'Copied response' : 'Copy response'}
        foregroundColor={foregroundColor}
        icon={copied ? TURN_ACTION_ICONS.check : TURN_ACTION_ICONS.copy}
        testID={`turn-copy-${messageId}`}
        onPress={onCopy}
      />
      {onPlay ? (
        <NativeIconButton
          accessibilityLabel={
            playbackStatus === 'playing'
              ? 'Pause response'
              : playbackStatus === 'loading'
                ? 'Preparing response audio'
                : 'Read response aloud'
          }
          foregroundColor={foregroundColor}
          icon={
            playbackStatus === 'playing'
              ? TURN_ACTION_ICONS.pause
              : TURN_ACTION_ICONS.play
          }
          loading={playbackStatus === 'loading'}
          testID={`turn-play-${messageId}`}
          onPress={onPlay}
        />
      ) : null}
      {onRegenerate ? (
        <NativeIconButton
          accessibilityLabel="Regenerate response"
          disabled={busy}
          foregroundColor={foregroundColor}
          icon={TURN_ACTION_ICONS.refresh}
          testID={`turn-refresh-${messageId}`}
          onPress={onRegenerate}
        />
      ) : null}
    </>
  );
}
