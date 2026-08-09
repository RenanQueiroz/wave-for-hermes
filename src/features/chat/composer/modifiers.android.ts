import { fillMaxWidth, testID } from '@expo/ui/jetpack-compose/modifiers';
import type { ModifierConfig } from '@expo/ui/jetpack-compose/modifiers';

export function nativeFillWidthModifiers(): ModifierConfig[] {
  return [fillMaxWidth()];
}

// The universal Icon supplies Android's contentDescription and the native
// button carries the test tag. Compose's SDK 57 semantics modifier does not
// yet expose a content-description field.
export function nativeAccessibilityModifiers(
  _label: string,
  _testID: string,
): ModifierConfig[] {
  return [];
}

export function nativeContainerTestIDModifiers(
  value: string,
): ModifierConfig[] {
  return [testID(value)];
}
