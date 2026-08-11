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
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';

import {
  isNearConversationEnd,
  MAINTAIN_AT_END_VIEWPORT_FRACTION,
} from '@/components/conversation-scroll';
import { ConversationEdgeFade } from '@/components/conversation-edge-fade';
import { ConversationJumpButton } from '@/components/conversation-jump-button';
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
  className,
  data,
  initialAnchor,
  jumpButtonBottomOffset = 16,
  onContentSizeChange,
  onLayout,
  onMomentumScrollEnd,
  onScroll,
  onScrollEndDrag,
  ...listProps
}: ConversationScrollerProps<ItemT>) {
  const listRef = useRef<LegendListRef>(null);
  const [nearEnd, setNearEnd] = useState(true);
  const [edgeFades, setEdgeFades] = useState({ end: false, start: false });
  const nearEndRef = useRef(true);
  const sawScrollRef = useRef(false);
  const metricsRef = useRef({
    contentHeight: 0,
    offsetY: 0,
    viewportHeight: 0,
  });
  const updateNearEnd = useCallback((next: boolean) => {
    nearEndRef.current = next;
    setNearEnd((previous) => (previous === next ? previous : next));
  }, []);
  const updateEdgeFades = useCallback(
    ({
      contentHeight,
      offsetY,
      viewportHeight,
    }: {
      contentHeight: number;
      offsetY: number;
      viewportHeight: number;
    }) => {
      const next = {
        end: contentHeight - offsetY - viewportHeight > 1,
        start: offsetY > 1,
      };
      setEdgeFades((current) =>
        current.end === next.end && current.start === next.start
          ? current
          : next,
      );
    },
    [],
  );
  const updateFromNativeEvent = useCallback(
    (nativeEvent: NativeScrollEvent) => {
      metricsRef.current = {
        contentHeight: nativeEvent.contentSize.height,
        offsetY: nativeEvent.contentOffset.y,
        viewportHeight: nativeEvent.layoutMeasurement.height,
      };
      updateNearEnd(isNearConversationEnd(nativeEvent));
      updateEdgeFades(metricsRef.current);
    },
    [updateEdgeFades, updateNearEnd],
  );
  const trackNearEnd = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      sawScrollRef.current = true;
      updateFromNativeEvent(event.nativeEvent);
      onScroll?.(event);
    },
    [onScroll, updateFromNativeEvent],
  );
  const trackScrollEndDrag = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      updateFromNativeEvent(event.nativeEvent);
      onScrollEndDrag?.(event);
    },
    [onScrollEndDrag, updateFromNativeEvent],
  );
  const trackMomentumScrollEnd = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      updateFromNativeEvent(event.nativeEvent);
      onMomentumScrollEnd?.(event);
    },
    [onMomentumScrollEnd, updateFromNativeEvent],
  );
  const trackLayout = useCallback(
    (event: LayoutChangeEvent) => {
      const viewportHeight = event.nativeEvent.layout.height;
      metricsRef.current.viewportHeight = viewportHeight;
      updateEdgeFades(metricsRef.current);
      if (
        sawScrollRef.current ||
        metricsRef.current.contentHeight <= viewportHeight
      ) {
        updateNearEnd(
          isNearConversationEnd({
            contentOffset: { x: 0, y: metricsRef.current.offsetY },
            contentSize: {
              height: metricsRef.current.contentHeight,
              width: 0,
            },
            layoutMeasurement: { height: viewportHeight, width: 0 },
          }),
        );
      }
      onLayout?.(event);
    },
    [onLayout, updateEdgeFades, updateNearEnd],
  );
  const trackContentSizeChange = useCallback(
    (width: number, height: number) => {
      metricsRef.current.contentHeight = height;
      updateEdgeFades(metricsRef.current);
      if (height <= metricsRef.current.viewportHeight) updateNearEnd(true);
      else if (!nearEndRef.current) updateNearEnd(false);
      onContentSizeChange?.(width, height);
    },
    [onContentSizeChange, updateEdgeFades, updateNearEnd],
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
      void listRef.current?.scrollToEnd({ animated: false }).then(() => {
        const metrics = metricsRef.current;
        metrics.offsetY = Math.max(
          metrics.contentHeight - metrics.viewportHeight,
          0,
        );
        updateEdgeFades(metrics);
      });
      return;
    }
    void listRef.current
      ?.scrollToIndex({ animated: false, index, viewPosition: 0 })
      .then(() => {
        // A non-animated positioning emits no scroll events, so disengage
        // auto-follow once the anchor has settled unless the reader has
        // already scrolled themselves.
        if (!sawScrollRef.current) updateNearEnd(false);
      });
  }, [data, initialAnchor, updateEdgeFades, updateNearEnd]);
  const jumpToNewest = useCallback(() => {
    // One deliberate reader-initiated scroll. Legend List's programmatic
    // scrolls do not surface through onScroll, so the landing re-engages
    // auto-follow explicitly once the animation settles; a reader touch
    // after that emits real events and immediately corrects the state.
    void listRef.current?.scrollToEnd({ animated: true }).then(() => {
      updateNearEnd(true);
      const metrics = metricsRef.current;
      metrics.offsetY = Math.max(
        metrics.contentHeight - metrics.viewportHeight,
        0,
      );
      updateEdgeFades(metrics);
    });
  }, [updateEdgeFades, updateNearEnd]);

  return (
    <View className="flex-1">
      <LegendList
        {...listProps}
        ref={listRef}
        alignItemsAtEnd
        className={className ? `flex-1 ${className}` : 'flex-1'}
        data={data}
        maintainScrollAtEnd={nearEnd}
        maintainScrollAtEndThreshold={MAINTAIN_AT_END_VIEWPORT_FRACTION}
        maintainVisibleContentPosition
        scrollEventThrottle={16}
        onContentSizeChange={trackContentSizeChange}
        onLayout={trackLayout}
        onMomentumScrollEnd={trackMomentumScrollEnd}
        onScroll={trackNearEnd}
        onScrollEndDrag={trackScrollEndDrag}
      />
      <ConversationEdgeFade edge="start" visible={edgeFades.start} />
      <ConversationEdgeFade edge="end" visible={edgeFades.end} />
      {!nearEnd ? (
        <View
          pointerEvents="box-none"
          className="absolute inset-x-0 items-center"
          style={{ bottom: jumpButtonBottomOffset }}>
          <ConversationJumpButton onPress={jumpToNewest} />
        </View>
      ) : null}
    </View>
  );
}
