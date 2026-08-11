import { frame, type ModifierConfig } from '@expo/ui/swift-ui/modifiers';

export function turnActionRowModifiers(): ModifierConfig[] {
  return [frame({ maxWidth: Infinity, alignment: 'leading' })];
}
