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
  size,
  testID as testIDModifier,
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
  working: require('@expo/material-symbols/hourglass_empty.xml'),
};

const CIRCLE_SIZE = 64;

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
        verticalArrangement={{ spacedBy: 20 }}
        modifiers={[fillMaxWidth()]}>
        {circleControls.length > 0 ? (
          <Row horizontalArrangement={{ spacedBy: 28 }} verticalAlignment="top">
            {circleControls.map((control) => (
              <VoiceCallCircle control={control} key={control.key} />
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
              fillMaxWidth(0.62),
              height(56),
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

function VoiceCallCircle({ control }: { control: VoiceCallControlSpec }) {
  const theme = useTheme();
  const prominent =
    control.role === 'start' || (control.active ?? false) === true;

  return (
    <Column horizontalAlignment="center" verticalArrangement={{ spacedBy: 8 }}>
      <FilledIconButton
        colors={{
          containerColor: prominent ? theme.primary : theme.backgroundElement,
          contentColor: prominent ? theme.primaryForeground : theme.text,
          disabledContainerColor: theme.backgroundElement,
          disabledContentColor: theme.textSecondary,
        }}
        enabled={!control.disabled}
        modifiers={[
          size(CIRCLE_SIZE, CIRCLE_SIZE),
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
