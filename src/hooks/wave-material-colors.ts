import type { MaterialColors, RgbaHex } from '@expo/ui/jetpack-compose';

export interface WaveMaterialTheme {
  background: string;
  backgroundElement: string;
  backgroundSelected: string;
  border: string;
  card: string;
  destructive: string;
  destructiveForeground: string;
  primary: string;
  primaryForeground: string;
  text: string;
  textSecondary: string;
}

function rgba(value: string): RgbaHex {
  return value as RgbaHex;
}

/** Replace Material's chromatic roles with Wave's semantic app palette. */
export function projectWaveMaterialColors(
  fallback: MaterialColors,
  theme: WaveMaterialTheme,
): MaterialColors {
  const primary = rgba(theme.primary);
  const onPrimary = rgba(theme.primaryForeground);
  const container = rgba(theme.backgroundElement);
  const selected = rgba(theme.backgroundSelected);
  const foreground = rgba(theme.text);
  const mutedForeground = rgba(theme.textSecondary);
  const background = rgba(theme.background);
  const card = rgba(theme.card);
  const border = rgba(theme.border);
  const destructive = rgba(theme.destructive);
  // PanelUI's destructive-foreground token is the *on-surface* red (dark red
  // in light theme, light red in dark theme), not a color for content on a
  // destructive fill — using it there renders red-on-red. PanelUI's own
  // destructive Button hardcodes white content because the destructive fill
  // stays a saturated red in every theme; mirror that. If a theme ever adopts
  // a light error container (Material-style dark pink), this must become
  // theme-dependent instead.
  const onDestructive = rgba('#ffffff');

  return {
    ...fallback,
    primary,
    onPrimary,
    primaryContainer: selected,
    onPrimaryContainer: foreground,
    inversePrimary: onPrimary,
    secondary: foreground,
    onSecondary: background,
    secondaryContainer: container,
    onSecondaryContainer: foreground,
    tertiary: mutedForeground,
    onTertiary: background,
    tertiaryContainer: container,
    onTertiaryContainer: foreground,
    background,
    onBackground: foreground,
    surface: background,
    onSurface: foreground,
    surfaceVariant: container,
    onSurfaceVariant: mutedForeground,
    surfaceTint: primary,
    inverseSurface: foreground,
    inverseOnSurface: background,
    error: destructive,
    onError: onDestructive,
    errorContainer: container,
    onErrorContainer: destructive,
    outline: border,
    outlineVariant: selected,
    surfaceBright: card,
    surfaceDim: background,
    surfaceContainer: container,
    surfaceContainerHigh: selected,
    surfaceContainerHighest: selected,
    surfaceContainerLow: card,
    surfaceContainerLowest: background,
    primaryFixed: primary,
    primaryFixedDim: primary,
    onPrimaryFixed: onPrimary,
    onPrimaryFixedVariant: onPrimary,
    secondaryFixed: foreground,
    secondaryFixedDim: foreground,
    onSecondaryFixed: background,
    onSecondaryFixedVariant: background,
    tertiaryFixed: mutedForeground,
    tertiaryFixedDim: mutedForeground,
    onTertiaryFixed: background,
    onTertiaryFixedVariant: background,
  };
}
