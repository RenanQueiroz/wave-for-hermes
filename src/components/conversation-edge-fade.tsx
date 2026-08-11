import { LinearGradient } from 'expo-linear-gradient';
import { useEffect } from 'react';
import { StyleSheet } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { useTheme } from '@/hooks/use-theme';

const FADE_DURATION_MS = 120;

export function ConversationEdgeFade({
  edge,
  obscuredInset = 0,
  size = 40,
  visible,
}: {
  edge: 'end' | 'start';
  /** Area beyond the gradient that remains strongly obscured. */
  obscuredInset?: number;
  size?: number;
  visible: boolean;
}) {
  const theme = useTheme();
  const opacity = useSharedValue(visible ? 1 : 0);

  useEffect(() => {
    opacity.value = withTiming(visible ? 1 : 0, {
      duration: FADE_DURATION_MS,
    });
  }, [opacity, visible]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
  }));
  const start = edge === 'start';
  const inset = start ? 0 : Math.max(0, obscuredInset);
  const extent = size + inset;
  const endOpacity = inset > 0 ? 0.78 : 1;
  const colors: [string, string] | [string, string, string] = start
    ? [withAlpha(theme.background, 1), withAlpha(theme.background, 0)]
    : [
        withAlpha(theme.background, 0),
        withAlpha(theme.background, endOpacity),
        withAlpha(theme.background, endOpacity),
      ];
  const locations: [number, number, number] | undefined = start
    ? undefined
    : [0, size / extent, 1];

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        {
          height: extent,
          left: 0,
          position: 'absolute',
          right: 0,
          ...(start ? { top: 0 } : { bottom: 0 }),
        },
        animatedStyle,
      ]}>
      <LinearGradient
        colors={colors}
        end={{ x: 0, y: 1 }}
        locations={locations}
        start={{ x: 0, y: 0 }}
        style={StyleSheet.absoluteFill}
      />
    </Animated.View>
  );
}

/** Keep the transparent stop chromatically matched on Android. */
function withAlpha(color: string, alpha: number): string {
  if (color.startsWith('#')) {
    const hex = color.slice(1);
    const full =
      hex.length === 3
        ? hex
            .split('')
            .map((character) => character + character)
            .join('')
        : hex.slice(0, 6);
    const red = Number.parseInt(full.slice(0, 2), 16);
    const green = Number.parseInt(full.slice(2, 4), 16);
    const blue = Number.parseInt(full.slice(4, 6), 16);
    if (Number.isNaN(red + green + blue)) return color;
    return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
  }

  const channels = color.match(/rgba?\(([^)]+)\)/)?.[1];
  if (channels) {
    const [red, green, blue] = channels.split(',').map((part) => part.trim());
    return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
  }

  return color;
}
