/**
 * Call-style controls for the voice screens, rendered in SwiftUI: circular
 * glyph buttons with captions beneath, mirroring the iOS Phone app. The end
 * control is the red hang-up circle in the same row.
 */
import { Host } from '@expo/ui';
import { Button, HStack, Image, Text, VStack } from '@expo/ui/swift-ui';
import {
  accessibilityIdentifier,
  accessibilityLabel,
  background,
  buttonStyle,
  disabled,
  font,
  foregroundStyle,
  frame,
  lineLimit,
  opacity,
  shapes,
} from '@expo/ui/swift-ui/modifiers';
import type { SFSymbol } from 'sf-symbols-typescript';

import type {
  VoiceCallControlSpec,
  VoiceCallControlsProps,
  VoiceCallGlyph,
} from '@/features/voice/voice-screen-ui.types';
import { useTheme } from '@/hooks/use-theme';

const VOICE_CALL_SYMBOLS = {
  close: 'xmark',
  end: 'phone.down.fill',
  microphone: 'mic.fill',
  'microphone-off': 'mic.slash.fill',
  send: 'arrow.up',
  skip: 'chevron.right',
  // The composer's live-voice glyph, so starting voice reads as the same
  // action it does in chat.
  wave: 'waveform',
  working: 'hourglass',
} as const satisfies Record<VoiceCallGlyph, SFSymbol>;

const CIRCLE_SIZE = 64;

// PanelUI has no on-destructive token (destructive-foreground is the
// on-surface red). Its destructive Button hardcodes white content because the
// destructive fill stays a saturated red in every theme — mirrored here, like
// the system call UI's white hang-up glyph. Becomes theme-dependent if a
// theme ever adopts a light error container.
const ON_DESTRUCTIVE = '#ffffff';

export function VoiceCallControls({ controls }: VoiceCallControlsProps) {
  const theme = useTheme();

  return (
    <Host
      colorScheme={theme.mode}
      matchContents={{ vertical: true }}
      seedColor={theme.primary}
      style={{ width: '100%' }}>
      <HStack alignment="top" spacing={0}>
        {controls.map((control) => (
          <VoiceCallControlButton control={control} key={control.key} />
        ))}
      </HStack>
    </Host>
  );
}

function VoiceCallControlButton({
  control,
}: {
  control: VoiceCallControlSpec;
}) {
  const theme = useTheme();
  const prominent =
    control.role === 'start' || (control.active ?? false) === true;
  const circleColor =
    control.role === 'end'
      ? theme.destructive
      : prominent
        ? theme.primary
        : theme.backgroundElement;
  const glyphColor =
    control.role === 'end'
      ? ON_DESTRUCTIVE
      : prominent
        ? theme.primaryForeground
        : theme.text;

  return (
    <Button
      onPress={control.onPress}
      role={control.role === 'end' ? 'destructive' : 'default'}
      modifiers={[
        buttonStyle('plain'),
        frame({ maxWidth: Infinity }),
        disabled(control.disabled ?? false),
        opacity(control.disabled ? 0.4 : 1),
        accessibilityLabel(control.accessibilityLabel),
        accessibilityIdentifier(control.testID),
      ]}>
      <VStack alignment="center" spacing={8}>
        <Image
          color={glyphColor}
          size={24}
          systemName={VOICE_CALL_SYMBOLS[control.glyph]}
          modifiers={[
            frame({ height: CIRCLE_SIZE, width: CIRCLE_SIZE }),
            background(circleColor, shapes.circle()),
          ]}
        />
        <Text
          modifiers={[
            font({ size: 13 }),
            foregroundStyle(theme.text),
            lineLimit(1),
          ]}>
          {control.label}
        </Text>
      </VStack>
    </Button>
  );
}
