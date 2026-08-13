/** Native action buttons for the voice screens, rendered in Jetpack Compose. */
import { Host } from '@expo/ui';
import {
  Button,
  Column,
  Icon,
  OutlinedButton,
  Row,
  Text,
} from '@expo/ui/jetpack-compose';
import {
  fillMaxWidth,
  padding,
  testID as testIDModifier,
  weight,
} from '@expo/ui/jetpack-compose/modifiers';

import type {
  VoiceActionIcon,
  VoiceActionSpec,
  VoiceActionsProps,
} from '@/features/voice/voice-screen-ui.types';
import {
  useWaveMaterialColors,
  waveDestructiveButtonColors,
  wavePrimaryButtonColors,
  waveTextButtonColors,
  type MaterialColors,
} from '@/hooks/use-wave-material-colors';
import { useTheme } from '@/hooks/use-theme';

const VOICE_ACTION_ICONS: Record<VoiceActionIcon, number> = {
  end: require('@expo/material-symbols/close.xml'),
  microphone: require('@expo/material-symbols/mic.xml'),
  retry: require('@expo/material-symbols/rotate_left.xml'),
  send: require('@expo/material-symbols/arrow_upward.xml'),
  skip: require('@expo/material-symbols/chevron_right.xml'),
};

export function VoiceActions({ rows }: VoiceActionsProps) {
  const theme = useTheme();
  const colors = useWaveMaterialColors();

  return (
    <Host
      colorScheme={theme.mode}
      matchContents={{ vertical: true }}
      seedColor={theme.primary}
      style={{ width: '100%' }}>
      <Column
        verticalArrangement={{ spacedBy: 8 }}
        modifiers={[fillMaxWidth()]}>
        {rows.map((row) => (
          <Row
            horizontalArrangement={{ spacedBy: 8 }}
            key={row.map((action) => action.key).join('+')}
            modifiers={[fillMaxWidth()]}>
            {row.map((action) => (
              <VoiceActionButton
                action={action}
                colors={colors}
                key={action.key}
              />
            ))}
          </Row>
        ))}
      </Column>
    </Host>
  );
}

function VoiceActionButton({
  action,
  colors,
}: {
  action: VoiceActionSpec;
  colors: MaterialColors;
}) {
  const ButtonComponent = action.kind === 'outline' ? OutlinedButton : Button;
  const buttonColors =
    action.kind === 'primary'
      ? wavePrimaryButtonColors(colors)
      : action.kind === 'destructive'
        ? waveDestructiveButtonColors(colors)
        : waveTextButtonColors(colors);

  return (
    <ButtonComponent
      colors={buttonColors}
      // Material 3 icon-button metrics: tighter start inset before the icon.
      contentPadding={action.icon ? { end: 24, start: 16 } : undefined}
      enabled={!action.disabled}
      modifiers={[weight(1), testIDModifier(action.testID)]}
      onClick={action.onPress}>
      {action.icon ? (
        <Icon
          size={20}
          source={VOICE_ACTION_ICONS[action.icon]}
          modifiers={[padding(0, 0, 8, 0)]}
        />
      ) : null}
      <Text>{action.label}</Text>
    </ButtonComponent>
  );
}
