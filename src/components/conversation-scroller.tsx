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
import { useCallback, useRef, useState } from 'react';
import {
  View,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';

import {
  isAtConversationEnd,
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
  /** Height covered by the overlaid composer at the bottom of the transcript. */
  bottomObscuredInset?: number;
  className?: string;
  contentContainerClassName?: string;
  /** Distance of the jump-to-newest button from the bottom edge. */
  jumpButtonBottomOffset?: number;
}

export function ConversationScroller<ItemT>({
  bottomObscuredInset = 0,
  className,
  data,
  jumpButtonBottomOffset = 16,
  onContentSizeChange,
  onLayout,
  onMomentumScrollEnd,
  onScroll,
  onScrollEndDrag,
  ...listProps
}: ConversationScrollerProps<ItemT>) {
  const hasItems = (data?.length ?? 0) > 0;
  const listRef = useRef<LegendListRef>(null);
  const [atEnd, setAtEnd] = useState(true);
  const [nearEnd, setNearEnd] = useState(true);
  const [edgeFades, setEdgeFades] = useState({ end: false, start: false });
  const sawScrollRef = useRef(false);
  const metricsRef = useRef({
    contentHeight: 0,
    endInset: 0,
    offsetY: 0,
    viewportHeight: 0,
  });
  const updateNearEnd = useCallback((next: boolean) => {
    setNearEnd((previous) => (previous === next ? previous : next));
  }, []);
  const updateAtEnd = useCallback((next: boolean) => {
    setAtEnd((previous) => (previous === next ? previous : next));
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
        end:
          contentHeight +
            metricsRef.current.endInset -
            offsetY -
            viewportHeight >
          1,
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
  const alignToEnd = useCallback((animated: boolean) => {
    // Native scroll events are the source of truth for whether the final
    // content is actually visible. Assuming the requested endpoint here can
    // hide the button too early if an iOS-hosted row finishes laying out
    // after the request.
    void listRef.current?.scrollToEnd({ animated });
  }, []);
  const updateFromNativeEvent = useCallback(
    (nativeEvent: NativeScrollEvent) => {
      metricsRef.current = {
        contentHeight: nativeEvent.contentSize.height,
        endInset: nativeEvent.contentInset?.bottom ?? 0,
        offsetY: nativeEvent.contentOffset.y,
        viewportHeight: nativeEvent.layoutMeasurement.height,
      };
      updateAtEnd(isAtConversationEnd(nativeEvent));
      updateNearEnd(isNearConversationEnd(nativeEvent));
      updateEdgeFades(metricsRef.current);
    },
    [updateAtEnd, updateEdgeFades, updateNearEnd],
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
        const metrics = {
          contentInset: { bottom: metricsRef.current.endInset },
          contentOffset: { x: 0, y: metricsRef.current.offsetY },
          contentSize: {
            height: metricsRef.current.contentHeight,
            width: 0,
          },
          layoutMeasurement: { height: viewportHeight, width: 0 },
        };
        updateAtEnd(isAtConversationEnd(metrics));
        updateNearEnd(isNearConversationEnd(metrics));
      }
      onLayout?.(event);
    },
    [onLayout, updateAtEnd, updateEdgeFades, updateNearEnd],
  );
  const trackContentSizeChange = useCallback(
    (width: number, height: number) => {
      metricsRef.current.contentHeight = height;
      updateEdgeFades(metricsRef.current);
      if (height <= metricsRef.current.viewportHeight) {
        updateAtEnd(true);
        updateNearEnd(true);
      } else if (sawScrollRef.current) {
        const metrics = {
          contentInset: { bottom: metricsRef.current.endInset },
          contentOffset: { x: 0, y: metricsRef.current.offsetY },
          contentSize: { height, width },
          layoutMeasurement: {
            height: metricsRef.current.viewportHeight,
            width: 0,
          },
        };
        updateAtEnd(isAtConversationEnd(metrics));
        updateNearEnd(isNearConversationEnd(metrics));
      }
      onContentSizeChange?.(width, height);
    },
    [onContentSizeChange, updateAtEnd, updateEdgeFades, updateNearEnd],
  );
  const jumpToNewest = useCallback(() => {
    // One deliberate reader-initiated scroll. Legend List targets the final
    // measured item and includes its footer, padding, and native content inset.
    alignToEnd(true);
  }, [alignToEnd]);

  return (
    <View className="flex-1">
      <LegendList
        {...listProps}
        ref={listRef}
        alignItemsAtEnd={hasItems}
        className={className ? `flex-1 ${className}` : 'flex-1'}
        data={data}
        initialScrollAtEnd
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
      <ConversationEdgeFade
        edge="end"
        obscuredInset={bottomObscuredInset}
        size={64}
        visible={edgeFades.end}
      />
      {hasItems && !atEnd ? (
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
