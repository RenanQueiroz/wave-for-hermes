import { useMemo } from 'react';
import { useCSSVariable } from 'uniwind';

import { useTheme } from '@/hooks/use-theme';
import type { DrawerColors } from '@/features/navigation/drawer/view.types';

function resolveColor(value: string | number | undefined, fallback: string) {
  return typeof value === 'string' ? value : fallback;
}

/** Resolve the drawer's semantic tokens once and pass them into native trees. */
export function useDrawerColors(): DrawerColors {
  const theme = useTheme();
  const [card, destructive, muted] = useCSSVariable([
    '--color-card',
    '--color-destructive',
    '--color-muted',
  ]);
  return useMemo(
    () => ({
      background: theme.background,
      card: resolveColor(card, theme.backgroundElement),
      destructive: resolveColor(destructive, theme.text),
      foreground: theme.text,
      muted: resolveColor(muted, theme.backgroundSelected),
      mutedForeground: theme.textSecondary,
      primary: theme.primary,
    }),
    [card, destructive, muted, theme],
  );
}
