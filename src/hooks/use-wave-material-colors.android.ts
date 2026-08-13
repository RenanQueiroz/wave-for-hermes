import {
  useMaterialColors,
  type AlertDialogColors,
  type ButtonColors,
  type MaterialColors,
  type SegmentedButtonColors,
  type SwitchColors,
  type TextFieldColors,
} from '@expo/ui/jetpack-compose';
import type { ColorSchemeName } from 'react-native';

import { useTheme } from '@/hooks/use-theme';
import { projectWaveMaterialColors } from '@/hooks/wave-material-colors';

export type { MaterialColors } from '@expo/ui/jetpack-compose';

/**
 * Material You always adds chroma to a seed, including a black, white, or
 * gray seed. Replace every visible Material role with Wave's semantic
 * PanelUI tokens so Android stays monochromatic regardless of wallpaper.
 */
export function useWaveMaterialColors({
  colorScheme,
}: {
  colorScheme?: ColorSchemeName;
} = {}): MaterialColors {
  const theme = useTheme();
  const fallback = useMaterialColors({
    colorScheme,
    seedColor: theme.primary,
  });

  return projectWaveMaterialColors(fallback, theme);
}

export function wavePrimaryButtonColors(colors: MaterialColors): ButtonColors {
  return {
    containerColor: colors.primary,
    contentColor: colors.onPrimary,
    disabledContainerColor: colors.surfaceVariant,
    disabledContentColor: colors.onSurfaceVariant,
  };
}

export function waveDestructiveButtonColors(
  colors: MaterialColors,
): ButtonColors {
  return {
    containerColor: colors.error,
    contentColor: colors.onError,
    disabledContainerColor: colors.surfaceVariant,
    disabledContentColor: colors.onSurfaceVariant,
  };
}

export function waveTonalButtonColors(colors: MaterialColors): ButtonColors {
  return {
    containerColor: colors.secondaryContainer,
    contentColor: colors.onSecondaryContainer,
    disabledContainerColor: colors.surfaceVariant,
    disabledContentColor: colors.onSurfaceVariant,
  };
}

export function waveTextButtonColors(colors: MaterialColors): ButtonColors {
  return {
    containerColor: 'transparent',
    contentColor: colors.primary,
    disabledContainerColor: 'transparent',
    disabledContentColor: colors.onSurfaceVariant,
  };
}

export function waveTextFieldColors(colors: MaterialColors): TextFieldColors {
  return {
    focusedTextColor: colors.onSurface,
    unfocusedTextColor: colors.onSurface,
    disabledTextColor: colors.onSurfaceVariant,
    errorTextColor: colors.error,
    cursorColor: colors.primary,
    errorCursorColor: colors.error,
    focusedIndicatorColor: colors.primary,
    unfocusedIndicatorColor: colors.outline,
    disabledIndicatorColor: colors.outlineVariant,
    errorIndicatorColor: colors.error,
    focusedLabelColor: colors.primary,
    unfocusedLabelColor: colors.onSurfaceVariant,
    disabledLabelColor: colors.onSurfaceVariant,
    errorLabelColor: colors.error,
    focusedPlaceholderColor: colors.onSurfaceVariant,
    unfocusedPlaceholderColor: colors.onSurfaceVariant,
    disabledPlaceholderColor: colors.onSurfaceVariant,
    errorPlaceholderColor: colors.onSurfaceVariant,
    focusedSupportingTextColor: colors.onSurfaceVariant,
    unfocusedSupportingTextColor: colors.onSurfaceVariant,
    disabledSupportingTextColor: colors.onSurfaceVariant,
    errorSupportingTextColor: colors.error,
  };
}

export function waveSwitchColors(colors: MaterialColors): SwitchColors {
  return {
    checkedThumbColor: colors.onPrimary,
    checkedTrackColor: colors.primary,
    checkedBorderColor: colors.primary,
    checkedIconColor: colors.primary,
    uncheckedThumbColor: colors.onSurfaceVariant,
    uncheckedTrackColor: colors.surfaceVariant,
    uncheckedBorderColor: colors.outline,
    uncheckedIconColor: colors.surfaceVariant,
    disabledCheckedThumbColor: colors.onSurfaceVariant,
    disabledCheckedTrackColor: colors.surfaceVariant,
    disabledCheckedBorderColor: colors.outlineVariant,
    disabledCheckedIconColor: colors.surfaceVariant,
    disabledUncheckedThumbColor: colors.onSurfaceVariant,
    disabledUncheckedTrackColor: colors.surfaceVariant,
    disabledUncheckedBorderColor: colors.outlineVariant,
    disabledUncheckedIconColor: colors.surfaceVariant,
  };
}

export function waveSegmentedButtonColors(
  colors: MaterialColors,
): SegmentedButtonColors {
  return {
    activeBorderColor: colors.primary,
    activeContentColor: colors.onPrimaryContainer,
    activeContainerColor: colors.primaryContainer,
    inactiveBorderColor: colors.outline,
    inactiveContentColor: colors.onSurface,
    inactiveContainerColor: 'transparent',
    disabledActiveBorderColor: colors.outlineVariant,
    disabledActiveContentColor: colors.onSurfaceVariant,
    disabledActiveContainerColor: colors.surfaceVariant,
    disabledInactiveBorderColor: colors.outlineVariant,
    disabledInactiveContentColor: colors.onSurfaceVariant,
    disabledInactiveContainerColor: 'transparent',
  };
}

export function waveAlertDialogColors(
  colors: MaterialColors,
): AlertDialogColors {
  return {
    containerColor: colors.surfaceContainerHigh,
    iconContentColor: colors.onSurfaceVariant,
    titleContentColor: colors.onSurface,
    textContentColor: colors.onSurfaceVariant,
  };
}
