import {
  fillMaxWidth,
  type ModifierConfig,
} from '@expo/ui/jetpack-compose/modifiers';

export function turnActionRowModifiers(): ModifierConfig[] {
  return [fillMaxWidth()];
}
