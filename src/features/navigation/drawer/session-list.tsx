import type { ReactElement, ReactNode } from 'react';
import { useCallback, useRef, useState } from 'react';
import type {
  LayoutChangeEvent,
  NativeScrollEvent,
  NativeSyntheticEvent,
} from 'react-native';
import { View } from 'react-native';

import { ConversationEdgeFade } from '@/components/conversation-edge-fade';
import { LegendList } from '@/components/legend-list';
import type { DrawerSessionListItem } from '@/features/navigation/drawer/content.shared';

const EDGE_EPSILON = 4;

/**
 * The drawer's virtualized session list. Rows are platform-native Hosts, so
 * the list itself stays shared RN code: it owns recycling, paging,
 * pull-to-refresh, and the passive edge fades that replaced PanelUI
 * `ScrollFade` (which cannot infer orientation from a virtualized list).
 */
export function DrawerSessionList({
  extraData,
  isRefetching,
  items,
  listEmpty,
  listHeader,
  onEndReached,
  onRefresh,
  renderItem,
}: {
  extraData: unknown;
  isRefetching: boolean;
  items: DrawerSessionListItem[];
  listEmpty: ReactNode;
  listHeader: ReactNode;
  onEndReached(): void;
  onRefresh(): void;
  renderItem(item: DrawerSessionListItem): ReactElement;
}) {
  const metricsRef = useRef({ contentHeight: 0, layoutHeight: 0, offset: 0 });
  const [edgeFades, setEdgeFades] = useState({ end: false, start: false });
  const updateEdgeFades = useCallback(() => {
    const { contentHeight, layoutHeight, offset } = metricsRef.current;
    const next = {
      end: offset + layoutHeight < contentHeight - EDGE_EPSILON,
      start: offset > EDGE_EPSILON,
    };
    setEdgeFades((current) =>
      current.end === next.end && current.start === next.start ? current : next,
    );
  }, []);
  const handleScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      metricsRef.current.offset = event.nativeEvent.contentOffset.y;
      updateEdgeFades();
    },
    [updateEdgeFades],
  );
  const handleContentSizeChange = useCallback(
    (_width: number, height: number) => {
      metricsRef.current.contentHeight = height;
      updateEdgeFades();
    },
    [updateEdgeFades],
  );
  const handleLayout = useCallback(
    (event: LayoutChangeEvent) => {
      metricsRef.current.layoutHeight = event.nativeEvent.layout.height;
      updateEdgeFades();
    },
    [updateEdgeFades],
  );

  return (
    <View className="flex-1">
      {/* Recycled: mounting a fresh menu-bearing row for every item during a
          fast fling cannot keep up and leaves the viewport blank. Rows reset
          their menu state on recycle, and drawDistance buffers rows beyond
          the viewport. */}
      <LegendList
        recycleItems
        drawDistance={500}
        className="flex-1"
        contentContainerClassName="px-2 pb-3"
        contentInsetAdjustmentBehavior="automatic"
        data={items}
        extraData={extraData}
        getItemType={(item) => item.kind}
        keyExtractor={(item) => item.id}
        ListEmptyComponent={<>{listEmpty}</>}
        ListHeaderComponent={<>{listHeader}</>}
        refreshing={isRefetching}
        renderItem={({ item }) => renderItem(item)}
        scrollEventThrottle={32}
        onContentSizeChange={handleContentSizeChange}
        onEndReached={onEndReached}
        onEndReachedThreshold={0.5}
        onLayout={handleLayout}
        onRefresh={onRefresh}
        onScroll={handleScroll}
      />
      <ConversationEdgeFade edge="start" visible={edgeFades.start} />
      <ConversationEdgeFade edge="end" visible={edgeFades.end} />
    </View>
  );
}
