/** Native action buttons for the voice screens, rendered in SwiftUI. */
import { Host } from '@expo/ui';
import { Button, HStack, Image, Text, VStack } from '@expo/ui/swift-ui';
import {
  accessibilityIdentifier,
  accessibilityLabel,
  buttonStyle,
  controlSize,
  disabled,
  font,
  foregroundStyle,
  frame,
  lineLimit,
  minimumScaleFactor,
  padding,
  tint,
} from '@expo/ui/swift-ui/modifiers';
import type { SFSymbol } from 'sf-symbols-typescript';

import type {
  VoiceActionIcon,
  VoiceActionSpec,
  VoiceActionsProps,
} from '@/features/voice/voice-screen-ui.types';
import { useTheme } from '@/hooks/use-theme';

const VOICE_ACTION_SYMBOLS = {
  end: 'xmark',
  microphone: 'mic.fill',
  retry: 'arrow.counterclockwise',
  send: 'arrow.up',
  skip: 'chevron.right',
} as const satisfies Record<VoiceActionIcon, SFSymbol>;

export function VoiceActions({ rows }: VoiceActionsProps) {
  const theme = useTheme();

  return (
    <Host
      colorScheme={theme.mode}
      matchContents={{ vertical: true }}
      seedColor={theme.primary}
      style={{ width: '100%' }}>
      <VStack spacing={10}>
        {rows.map((row) => (
          <HStack key={row.map((action) => action.key).join('+')} spacing={8}>
            {row.map((action) => (
              <VoiceActionButton
                action={action}
                compact={row.length > 2}
                key={action.key}
              />
            ))}
          </HStack>
        ))}
      </VStack>
    </Host>
  );
}

function VoiceActionButton({
  action,
  compact,
}: {
  action: VoiceActionSpec;
  compact: boolean;
}) {
  const theme = useTheme();
  // Prominent labels use explicit foreground colors: the near-white dark
  // primary needs primary-foreground for readable contrast (Settings parity),
  // and destructive fills take white — PanelUI's destructive-foreground token
  // is the on-surface red and disappears on the red container, while its own
  // destructive Button hardcodes white for the always-saturated fill.
  const contentColor =
    action.kind === 'primary'
      ? theme.primaryForeground
      : action.kind === 'destructive'
        ? '#ffffff'
        : theme.primary;

  return (
    <Button
      onPress={action.onPress}
      role={action.kind === 'destructive' ? 'destructive' : 'default'}
      modifiers={[
        buttonStyle(
          action.kind === 'outline' ? 'bordered' : 'borderedProminent',
        ),
        // A three-across row (Mute / Send now / End) cannot afford the large
        // control's horizontal padding — labels truncate. Regular control
        // metrics plus label padding keep the same tap-target height.
        controlSize(compact ? 'regular' : 'large'),
        ...(action.kind === 'destructive' ? [tint(theme.destructive)] : []),
        disabled(action.disabled ?? false),
        accessibilityLabel(action.accessibilityLabel),
        accessibilityIdentifier(action.testID),
      ]}>
      <HStack
        alignment="center"
        spacing={compact ? 4 : 6}
        modifiers={[
          frame({ maxWidth: Infinity }),
          ...(compact ? [padding({ vertical: 7 })] : []),
        ]}>
        {action.icon ? (
          <Image
            color={contentColor}
            size={compact ? 13 : 15}
            systemName={VOICE_ACTION_SYMBOLS[action.icon]}
          />
        ) : null}
        <Text
          modifiers={[
            // A three-across row (Mute / Send now / End) leaves little width
            // per label; use the compact metrics and shrink slightly rather
            // than wrapping or truncating.
            font({ size: compact ? 15 : 16, weight: 'semibold' }),
            foregroundStyle(contentColor),
            lineLimit(1),
            minimumScaleFactor(0.75),
          ]}>
          {action.label}
        </Text>
      </HStack>
    </Button>
  );
}
