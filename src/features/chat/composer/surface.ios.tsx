import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import { View, type ViewStyle } from 'react-native';
import { onGeometryChange } from '@expo/ui/swift-ui/modifiers';
import type { ModifierConfig } from '@expo/ui/swift-ui/modifiers';

import type { ChatComposerSurfaceBackgroundProps } from '@/features/chat/composer/surface.types';

const COMPOSER_RADIUS = 28;

export function ChatComposerSurfaceBackground({
  backgroundColor,
  bottomInset,
  colorScheme,
  height,
  horizontalInset,
}: ChatComposerSurfaceBackgroundProps) {
  const style: ViewStyle = {
    borderCurve: 'continuous',
    borderRadius: COMPOSER_RADIUS,
    bottom: bottomInset,
    height,
    left: horizontalInset,
    overflow: 'hidden',
    position: 'absolute',
    right: horizontalInset,
  };

  if (!isLiquidGlassAvailable()) {
    return <View pointerEvents="none" style={[style, { backgroundColor }]} />;
  }

  return (
    <GlassView
      colorScheme={colorScheme}
      glassEffectStyle="regular"
      pointerEvents="none"
      style={style}
    />
  );
}

export function nativeComposerSurfaceModifiers(
  onHeightChange: (height: number) => void,
): ModifierConfig[] {
  return [onGeometryChange(({ height }) => onHeightChange(height))];
}
