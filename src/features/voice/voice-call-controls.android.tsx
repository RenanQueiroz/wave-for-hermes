/**
 * Call-style controls for the voice screens, rendered in Jetpack Compose:
 * a row of circular glyph buttons with captions beneath, and the hang-up
 * control as the wide destructive pill under the row, mirroring the Google
 * Phone app.
 */
import { Host } from '@expo/ui';
import {
  Button,
  Column,
  FilledIconButton,
  Icon,
  Row,
  Text,
} from '@expo/ui/jetpack-compose';
import {
  fillMaxWidth,
  height,
  testID as testIDModifier,
  weight,
} from '@expo/ui/jetpack-compose/modifiers';

import type {
  VoiceCallControlSpec,
  VoiceCallControlsProps,
  VoiceCallGlyph,
} from '@/features/voice/voice-screen-ui.types';
import { useTheme } from '@/hooks/use-theme';

const VOICE_CALL_ICONS: Record<VoiceCallGlyph, number> = {
  close: require('@expo/material-symbols/close.xml'),
  end: require('@expo/material-symbols/call_end.xml'),
  microphone: require('@expo/material-symbols/mic.xml'),
  'microphone-off': require('@expo/material-symbols/mic_off.xml'),
  send: require('@expo/material-symbols/arrow_upward.xml'),
  skip: require('@expo/material-symbols/chevron_right.xml'),
  // The composer's live-voice glyph, so starting voice reads as the same
  // action it does in chat.
  wave: require('@expo/material-symbols/graphic_eq.xml'),
  working: require('@expo/material-symbols/hourglass_empty.xml'),
};

// Google Phone's pill language, adapted to Wave's two supporting controls:
// with only two (not the Phone app's four) fixed-width pills would leave dead
// space at the edges, so the supporting row splits the full content width
// evenly and the hang-up pill spans all of it. Every button shares one height.
const PILL_HEIGHT = 64;
const PILL_GAP = 12;

// PanelUI has no on-destructive token (destructive-foreground is the
// on-surface red). Its destructive Button hardcodes white content because the
// destructive fill stays a saturated red in every theme — mirrored here, like
// the system call UI's white hang-up glyph. Becomes theme-dependent if a
// theme ever adopts a light error container.
const ON_DESTRUCTIVE = '#ffffff';

export function VoiceCallControls({ controls }: VoiceCallControlsProps) {
  const theme = useTheme();
  const circleControls = controls.filter((control) => control.role !== 'end');
  const endControl = controls.find((control) => control.role === 'end');

  return (
    <Host
      colorScheme={theme.mode}
      matchContents={{ vertical: true }}
      seedColor={theme.primary}
      style={{ width: '100%' }}>
      <Column
        horizontalAlignment="center"
        verticalArrangement={{ spacedBy: 16 }}
        modifiers={[fillMaxWidth()]}>
        {circleControls.length > 0 ? (
          <Row
            horizontalArrangement={{ spacedBy: PILL_GAP }}
            verticalAlignment="top"
            modifiers={[fillMaxWidth()]}>
            {circleControls.map((control) => (
              <VoiceCallPill control={control} key={control.key} />
            ))}
          </Row>
        ) : null}
        {endControl ? (
          <Button
            colors={{
              containerColor: theme.destructive,
              contentColor: ON_DESTRUCTIVE,
              disabledContainerColor: theme.backgroundElement,
              disabledContentColor: theme.textSecondary,
            }}
            enabled={!endControl.disabled}
            modifiers={[
              fillMaxWidth(),
              height(PILL_HEIGHT),
              testIDModifier(endControl.testID),
            ]}
            onClick={endControl.onPress}>
            <Icon
              contentDescription={endControl.accessibilityLabel}
              size={26}
              source={VOICE_CALL_ICONS[endControl.glyph]}
            />
          </Button>
        ) : null}
      </Column>
    </Host>
  );
}

function VoiceCallPill({ control }: { control: VoiceCallControlSpec }) {
  const theme = useTheme();
  const prominent =
    control.role === 'start' || (control.active ?? false) === true;

  return (
    <Column
      horizontalAlignment="center"
      verticalArrangement={{ spacedBy: 8 }}
      modifiers={[weight(1)]}>
      <FilledIconButton
        colors={{
          containerColor: prominent ? theme.primary : theme.backgroundElement,
          contentColor: prominent ? theme.primaryForeground : theme.text,
          disabledContainerColor: theme.backgroundElement,
          disabledContentColor: theme.textSecondary,
        }}
        enabled={!control.disabled}
        modifiers={[
          fillMaxWidth(),
          height(PILL_HEIGHT),
          testIDModifier(control.testID),
        ]}
        onClick={control.onPress}>
        <Icon
          contentDescription={control.accessibilityLabel}
          size={26}
          source={VOICE_CALL_ICONS[control.glyph]}
        />
      </FilledIconButton>
      <Text
        color={control.disabled ? theme.textSecondary : theme.text}
        style={{ textAlign: 'center', typography: 'bodyMedium' }}>
        {control.label}
      </Text>
    </Column>
  );
}
