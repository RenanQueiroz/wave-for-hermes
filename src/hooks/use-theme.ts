import { useThemeMode } from 'panelui-native';
import { useCSSVariable } from 'uniwind';

import { Colors } from '@/constants/theme';

export function useTheme() {
  const { mode } = useThemeMode();
  const fallback = Colors[mode];
  const [
    text,
    background,
    backgroundElement,
    backgroundSelected,
    textSecondary,
    primary,
  ] = useCSSVariable([
    '--color-foreground',
    '--color-background',
    '--color-secondary',
    '--color-accent',
    '--color-muted-foreground',
    '--color-primary',
  ]);

  return {
    text: resolveColor(text, fallback.text),
    background: resolveColor(background, fallback.background),
    backgroundElement: resolveColor(
      backgroundElement,
      fallback.backgroundElement,
    ),
    backgroundSelected: resolveColor(
      backgroundSelected,
      fallback.backgroundSelected,
    ),
    textSecondary: resolveColor(textSecondary, fallback.textSecondary),
    primary: resolveColor(primary, fallback.text),
  };
}

function resolveColor(value: string | number | undefined, fallback: string) {
  return typeof value === 'string' ? value : fallback;
}
