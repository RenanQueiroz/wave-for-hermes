import { Button, Host, Row, Text } from '@expo/ui';

import {
  NativeIconButton,
  NATIVE_ICON_BUTTON_SIZE,
} from '@/components/native-icon-button';
import { TURN_ACTION_ICONS } from '@/features/chat/turn-actions/icons';
import { turnActionRowModifiers } from '@/features/chat/turn-actions/modifiers';
import type { TurnPlaybackStatus } from '@/features/chat/turn-actions/types';

export function NativeTurnActionRow({
  busy,
  copied,
  foregroundColor,
  messageId,
  onBranch,
  onCopy,
  onPlay,
  onRegenerate,
  onTimestampPress,
  playbackStatus,
  seedColor,
  timestamp,
}: {
  busy: boolean;
  copied: boolean;
  foregroundColor: string;
  messageId: string;
  onBranch?: () => void;
  onCopy(): void;
  onPlay?: () => void;
  onRegenerate?: () => void;
  onTimestampPress(): void;
  playbackStatus: TurnPlaybackStatus;
  seedColor: string;
  timestamp: string;
}) {
  // The explicit first-frame height gives the virtualized RN row a stable
  // native proposal; matchContents keeps SwiftUI/Compose responsible for
  // confirming the visible row height. Without both on iOS, SwiftUI can
  // initially paint above the Host and only correct itself after a press.
  return (
    <Host
      matchContents={{ vertical: true }}
      seedColor={seedColor}
      style={{ height: NATIVE_ICON_BUTTON_SIZE, width: '100%' }}
      testID={`turn-actions-${messageId}`}>
      <Row alignment="center" modifiers={turnActionRowModifiers()} spacing={0}>
        <Button
          testID={`turn-time-${messageId}`}
          variant="text"
          style={{ height: NATIVE_ICON_BUTTON_SIZE, paddingHorizontal: 8 }}
          onPress={onTimestampPress}>
          <Text
            textStyle={{
              color: foregroundColor,
              fontSize: 12,
            }}>
            {timestamp}
          </Text>
        </Button>
        <Text
          style={{ paddingLeft: 4, paddingRight: 4 }}
          textStyle={{ color: foregroundColor, fontSize: 14 }}>
          ·
        </Text>
        {onBranch ? (
          <NativeIconButton
            accessibilityLabel="Branch this conversation into a new chat"
            disabled={busy}
            foregroundColor={foregroundColor}
            icon={TURN_ACTION_ICONS.branch}
            testID={`turn-branch-${messageId}`}
            onPress={onBranch}
          />
        ) : null}
        <NativeIconButton
          accessibilityLabel="Copy this reply"
          foregroundColor={foregroundColor}
          icon={copied ? TURN_ACTION_ICONS.check : TURN_ACTION_ICONS.copy}
          testID={`turn-copy-${messageId}`}
          onPress={onCopy}
        />
        {onPlay ? (
          <NativeIconButton
            accessibilityLabel={
              playbackStatus === 'playing'
                ? 'Stop reading this reply aloud'
                : 'Read this reply aloud'
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
            accessibilityLabel="Regenerate this reply"
            disabled={busy}
            foregroundColor={foregroundColor}
            icon={TURN_ACTION_ICONS.refresh}
            testID={`turn-refresh-${messageId}`}
            onPress={onRegenerate}
          />
        ) : null}
      </Row>
    </Host>
  );
}
