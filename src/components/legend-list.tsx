import {
  LegendList as BaseLegendList,
  type LegendListRef,
  type LegendListProps,
} from '@legendapp/list/react-native';
import type { ReactNode, Ref } from 'react';
import { withUniwind } from 'uniwind';

/**
 * LegendList with Uniwind class support. `withUniwind` maps `className` and
 * `contentContainerClassName` onto the style props, but its HOC type drops
 * the item generic, so the cast restores it.
 *
 * List items are positioned by the virtualizer, so `gap` classes on the
 * content container do nothing — use `ItemSeparatorComponent` for item gaps.
 * Only pass `recycleItems` on lists whose rows hold no internal state.
 */
export const LegendList = withUniwind(BaseLegendList) as <ItemT>(
  props: LegendListProps<ItemT> & {
    className?: string;
    contentContainerClassName?: string;
    ref?: Ref<LegendListRef>;
  },
) => ReactNode;
