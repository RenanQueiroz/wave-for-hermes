import type { NativeScrollEvent } from 'react-native';

/**
 * The maintain-at-end band the conversation scroller passes to Legend List.
 * Wider than the library's 10% default because a streaming markdown re-parse
 * can grow the active row by a whole block — table, code fence — in one
 * layout pass, which silently disengaged the pin mid-stream.
 */
export const MAINTAIN_AT_END_VIEWPORT_FRACTION = 0.3;

// Looser than the maintain-at-end band, so near the end the library's fresh
// threshold check stays the binding gate. This band exists to veto the pin
// entirely while the reader is in far-back history, where the library's
// cached threshold flag can go stale mid-momentum and yank the list to the
// newest message when a refetch replaces the data.
const NEAR_END_VIEWPORT_FRACTION = 0.5;

/** Whether a scroll event left the viewport within the pin-to-end band. */
export function isNearConversationEnd({
  contentOffset,
  contentSize,
  layoutMeasurement,
}: Pick<
  NativeScrollEvent,
  'contentOffset' | 'contentSize' | 'layoutMeasurement'
>): boolean {
  const distanceFromEnd =
    contentSize.height - contentOffset.y - layoutMeasurement.height;
  return (
    distanceFromEnd <= layoutMeasurement.height * NEAR_END_VIEWPORT_FRACTION
  );
}
