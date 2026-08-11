import type { ReactNode } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { LayoutChangeEvent } from 'react-native';
import {
  useKeyboardState,
  useReanimatedKeyboardAnimation,
} from 'react-native-keyboard-controller';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ChatComposerSurfaceBackground } from '@/features/chat/composer/surface';

const KEYBOARD_GAP = 12;
const HORIZONTAL_INSET = 16;

/**
 * The one keyboard-avoidance owner for the native composer island. The
 * hosted SwiftUI/Compose trees explicitly opt out of their own keyboard inset
 * handling, so only this translation can move the composer.
 */
export function ChatComposerDock({
  children,
  colorScheme,
  onBottomOffsetChange,
  surfaceBackgroundColor,
  surfaceHeight,
}: {
  children: ReactNode;
  colorScheme: 'dark' | 'light';
  onBottomOffsetChange(offset: number): void;
  surfaceBackgroundColor: string;
  surfaceHeight: number;
}) {
  const insets = useSafeAreaInsets();
  const { height } = useReanimatedKeyboardAnimation();
  const keyboardHeight = useKeyboardState((state) =>
    state.isVisible ? state.height : 0,
  );
  const [dockHeight, setDockHeight] = useState(0);
  const bottomPadding = Math.max(insets.bottom, 12);
  const bottomInset = bottomPadding - KEYBOARD_GAP;
  const baseStyle = useMemo(
    () => ({
      gap: 8,
      bottom: 0,
      left: 0,
      paddingBottom: bottomPadding,
      paddingHorizontal: HORIZONTAL_INSET,
      paddingTop: 8,
      position: 'absolute' as const,
      right: 0,
      zIndex: 10,
    }),
    [bottomPadding],
  );
  const animatedStyle = useAnimatedStyle(() => {
    const travel = Math.max(Math.abs(height.value) - bottomInset, 0);
    return { transform: [{ translateY: -travel }] };
  }, [bottomInset, height]);
  const handleLayout = useCallback((event: LayoutChangeEvent) => {
    setDockHeight(event.nativeEvent.layout.height);
  }, []);
  useEffect(() => {
    const keyboardTravel = Math.max(keyboardHeight - bottomInset, 0);
    onBottomOffsetChange(dockHeight + keyboardTravel);
  }, [bottomInset, dockHeight, keyboardHeight, onBottomOffsetChange]);

  return (
    <Animated.View
      pointerEvents="box-none"
      style={[baseStyle, animatedStyle]}
      onLayout={handleLayout}>
      <ChatComposerSurfaceBackground
        backgroundColor={surfaceBackgroundColor}
        bottomInset={bottomPadding}
        colorScheme={colorScheme}
        height={surfaceHeight}
        horizontalInset={HORIZONTAL_INSET}
      />
      {children}
    </Animated.View>
  );
}
