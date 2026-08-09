import {
  accessibilityIdentifier,
  accessibilityLabel,
  frame,
  type ModifierConfig,
} from '@expo/ui/swift-ui/modifiers';

// SwiftUI-specific modifier factories for the shared composer orchestration.

export function nativeFillWidthModifiers(): ModifierConfig[] {
  return [frame({ alignment: 'leading', maxWidth: Infinity })];
}

export function nativeAccessibilityModifiers(
  label: string,
  testID: string,
): ModifierConfig[] {
  return [accessibilityLabel(label), accessibilityIdentifier(testID)];
}

// SwiftUI accessibility identifiers are inherited by descendants. Container
// identifiers would overwrite every field/button identifier below them.
export function nativeContainerTestIDModifiers(
  _testID: string,
): ModifierConfig[] {
  return [];
}
