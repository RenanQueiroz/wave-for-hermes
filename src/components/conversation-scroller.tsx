/**
 * Wave's transcript scroller: MessageScroller's principles on Legend List's
 * virtualization. The reader's position is theirs — the list pins to the
 * newest message only while the reader is already within the at-end band,
 * never drags them down mid-read, offers a jump-to-newest button while
 * auto-follow is disengaged, and keeps the viewed message stationary when
 * older history prepends. PanelUI's MessageScroller itself stays banned for
 * unbounded histories because it does not virtualize.
 */
import type {
  LegendListProps,
  LegendListRef,
} from '@legendapp/list/react-native';
import { Button, ChevronDownIcon, ScrollFade } from 'panelui-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';

import {
  isNearConversationEnd,
  MAINTAIN_AT_END_VIEWPORT_FRACTION,
} from '@/components/conversation-scroll';
import { LegendList } from '@/components/legend-list';

type OwnedListProps =
  | 'alignItemsAtEnd'
  | 'initialScrollAtEnd'
  | 'initialScrollIndex'
  | 'maintainScrollAtEnd'
  | 'maintainScrollAtEndThreshold'
  | 'maintainVisibleContentPosition';

export interface ConversationScrollerProps<ItemT> extends Omit<
  LegendListProps<ItemT>,
  OwnedListProps
> {
  className?: string;
  contentContainerClassName?: string;
  /** Edge fade size passed to the surrounding ScrollFade. */
  fadeSize?: number;
  /**
   * Decide the opening anchor from the first non-empty data: return an index
   * to open with that item at the top of the viewport — the reader's own
   * last message rather than the tail of a long response — or undefined to
   * open at the end. Decided once; never re-anchors.
   */
  initialAnchor?: (items: readonly ItemT[]) => number | undefined;
  /** Distance of the jump-to-newest button from the bottom edge. */
  jumpButtonBottomOffset?: number;
}

export function ConversationScroller<ItemT>({
  data,
  fadeSize = 40,
  initialAnchor,
  jumpButtonBottomOffset = 16,
  onScroll,
  ...listProps
}: ConversationScrollerProps<ItemT>) {
  const listRef = useRef<LegendListRef>(null);
  const [nearEnd, setNearEnd] = useState(true);
  const sawScrollRef = useRef(false);
  const trackNearEnd = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      sawScrollRef.current = true;
      const next = isNearConversationEnd(event.nativeEvent);
      setNearEnd((previous) => (previous === next ? previous : next));
      onScroll?.(event);
    },
    [onScroll],
  );
  // The opening position is decided once, from the first non-empty data —
  // usually a commit after mount — and applied imperatively so the anchored
  // and at-end cases cannot race each other (the list deliberately does not
  // get `initialScrollAtEnd`). The programmatic scroll's own events land in
  // trackNearEnd, which disengages auto-follow and shows the jump button
  // for an anchored open; no state is written here directly.
  const anchoredRef = useRef(false);
  useEffect(() => {
    if (anchoredRef.current || sawScrollRef.current) return;
    if (!data || data.length === 0) return;
    anchoredRef.current = true;
    const index = initialAnchor?.(data);
    if (index === undefined) {
      void listRef.current?.scrollToEnd({ animated: false });
      return;
    }
    void listRef.current
      ?.scrollToIndex({ animated: false, index, viewPosition: 0 })
      .then(() => {
        // A non-animated positioning emits no scroll events, so disengage
        // auto-follow once the anchor has settled unless the reader has
        // already scrolled themselves.
        if (!sawScrollRef.current) setNearEnd(false);
      });
  }, [data, initialAnchor]);
  const jumpToNewest = useCallback(() => {
    // One deliberate reader-initiated scroll. Legend List's programmatic
    // scrolls do not surface through onScroll, so the landing re-engages
    // auto-follow explicitly once the animation settles; a reader touch
    // after that emits real events and immediately corrects the state.
    void listRef.current?.scrollToEnd({ animated: true }).then(() => {
      setNearEnd(true);
    });
  }, []);

  return (
    <View className="flex-1">
      <ScrollFade className="flex-1" orientation="vertical" size={fadeSize}>
        <LegendList
          {...listProps}
          ref={listRef}
          alignItemsAtEnd
          data={data}
          maintainScrollAtEnd={nearEnd}
          maintainScrollAtEndThreshold={MAINTAIN_AT_END_VIEWPORT_FRACTION}
          maintainVisibleContentPosition
          onScroll={trackNearEnd}
        />
      </ScrollFade>
      {!nearEnd ? (
        <View
          pointerEvents="box-none"
          className="absolute inset-x-0 items-center"
          style={{ bottom: jumpButtonBottomOffset }}>
          {/* The muted token carries alpha, so over transcript text it goes
              translucent. Layering it on the page background reproduces the
              composer field's gray as a fully opaque floating chip. */}
          <View className="overflow-hidden rounded-full bg-background shadow-lg">
            <Button
              size="icon"
              variant="secondary"
              accessibilityLabel="Jump to the newest message"
              className="rounded-full border border-border bg-muted"
              testID="conversation-jump-to-newest"
              onPress={jumpToNewest}>
              <ChevronDownIcon size={18} />
            </Button>
          </View>
        </View>
      ) : null}
    </View>
  );
}
