import type { ReactNode } from 'react';
import { useMemo } from 'react';
import { useReanimatedKeyboardAnimation } from 'react-native-keyboard-controller';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const KEYBOARD_GAP = 12;

/**
 * The one keyboard-avoidance owner for the native composer island. The
 * hosted SwiftUI/Compose trees explicitly opt out of their own keyboard inset
 * handling, so only this translation can move the composer.
 */
export function ChatComposerDock({ children }: { children: ReactNode }) {
  const insets = useSafeAreaInsets();
  const { height } = useReanimatedKeyboardAnimation();
  const bottomPadding = Math.max(insets.bottom, 12);
  const bottomInset = bottomPadding - KEYBOARD_GAP;
  const baseStyle = useMemo(
    () => ({
      gap: 8,
      paddingBottom: bottomPadding,
      paddingHorizontal: 16,
      paddingTop: 8,
    }),
    [bottomPadding],
  );
  const animatedStyle = useAnimatedStyle(() => {
    const travel = Math.max(Math.abs(height.value) - bottomInset, 0);
    return { transform: [{ translateY: -travel }] };
  }, [bottomInset, height]);

  return (
    <Animated.View style={[baseStyle, animatedStyle]}>{children}</Animated.View>
  );
}
