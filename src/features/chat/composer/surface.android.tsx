import type { ModifierConfig } from '@expo/ui/jetpack-compose/modifiers';

import type { ChatComposerSurfaceBackgroundProps } from '@/features/chat/composer/surface.types';

export function ChatComposerSurfaceBackground(
  _props: ChatComposerSurfaceBackgroundProps,
) {
  return null;
}

export function nativeComposerSurfaceStyle(backgroundColor: string): {
  backgroundColor: string;
} {
  return { backgroundColor };
}

export function nativeComposerSurfaceModifiers(
  _onHeightChange: (height: number) => void,
): ModifierConfig[] {
  return [];
}
