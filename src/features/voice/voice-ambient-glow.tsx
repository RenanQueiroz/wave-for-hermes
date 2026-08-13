/**
 * The decorative conversation glow behind the voice screens. The PanelUI
 * Soundwave stays React Native — it has no native counterpart — but its
 * default ambient ink (the info token) all but disappears on a white page.
 * Both themes get the same alpha ramp, so the glow reads equally strong in
 * each; only the ink differs, chosen to contrast with that theme's
 * background. The three-stop gradient densifies the component's default
 * two-stop bloom without changing its peak alpha.
 */
import { Soundwave } from 'panelui-native';
import type { ComponentProps } from 'react';

import { useTheme } from '@/hooks/use-theme';

const GLOW_INK = {
  // A brighter blue against the near-black page.
  dark: '#60a5fa',
  // A deeper blue against the white page.
  light: '#2563eb',
} as const;

type SoundwaveProps = ComponentProps<typeof Soundwave>;

export function VoiceAmbientGlow({
  level,
  state,
  testID,
}: {
  level: SoundwaveProps['level'];
  state: SoundwaveProps['state'];
  testID: string;
}) {
  const theme = useTheme();
  const ink = GLOW_INK[theme.mode];

  return (
    <Soundwave
      color={ink}
      gradient={[ink, ink, ink]}
      level={level}
      state={state}
      testID={testID}
      variant="ambient"
    />
  );
}
