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
    primaryForeground,
    destructive,
    destructiveForeground,
    border,
    card,
    muted,
  ] = useCSSVariable([
    '--color-foreground',
    '--color-background',
    '--color-secondary',
    '--color-accent',
    '--color-muted-foreground',
    '--color-primary',
    '--color-primary-foreground',
    '--color-destructive',
    '--color-destructive-foreground',
    '--color-border',
    '--color-card',
    '--color-muted',
  ]);

  return {
    mode,
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
    primaryForeground: resolveColor(primaryForeground, fallback.background),
    destructive: resolveColor(
      destructive,
      mode === 'dark' ? '#f15757' : '#ef4444',
    ),
    destructiveForeground: resolveColor(
      destructiveForeground,
      fallback.background,
    ),
    border: resolveColor(border, fallback.backgroundSelected),
    card: resolveColor(card, fallback.backgroundElement),
    muted: resolveColor(muted, fallback.backgroundElement),
  };
}

function resolveColor(value: string | number | undefined, fallback: string) {
  return typeof value === 'string' ? value : fallback;
}
