import type { ComponentProps, ReactNode } from 'react';
import { KeyboardAwareScrollView as BaseKeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { withUniwind } from 'uniwind';

/**
 * Keyboard-aware ScrollView with Uniwind class support, for screens whose
 * form fields live in the page flow. It scrolls the focused field clear of
 * the keyboard, which per-Input lift avoidance cannot do — lift translates
 * only the focused field, sliding it over the fields above it on a stacked
 * form. `react-native-keyboard-controller` is already mounted app-wide
 * through PanelUIProvider, which this component shares.
 */
export const KeyboardAwareScrollView = withUniwind(
  BaseKeyboardAwareScrollView,
) as (
  props: ComponentProps<typeof BaseKeyboardAwareScrollView> & {
    className?: string;
    contentContainerClassName?: string;
  },
) => ReactNode;
