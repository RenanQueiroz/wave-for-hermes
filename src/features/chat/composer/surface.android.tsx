import type { ModifierConfig } from '@expo/ui/jetpack-compose/modifiers';

import type { ChatComposerSurfaceBackgroundProps } from '@/features/chat/composer/surface.types';

export function ChatComposerSurfaceBackground(
  _props: ChatComposerSurfaceBackgroundProps,
) {
  return null;
}

export function nativeComposerSurfaceModifiers(
  _onHeightChange: (height: number) => void,
): ModifierConfig[] {
  return [];
}
