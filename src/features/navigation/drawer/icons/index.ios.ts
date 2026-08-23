import type { SFSymbol } from 'sf-symbols-typescript';

export const DRAWER_ICONS = {
  delete: 'trash',
  ellipsis: 'ellipsis',
  liveActive: 'circle.fill',
  liveWaiting: 'circle',
  newConversation: 'square.and.pencil',
  pin: 'bookmark',
  pinned: 'bookmark.fill',
  rename: 'pencil',
  search: 'magnifyingglass',
  settings: 'gearshape',
  update: 'square.and.arrow.down',
  sourceAutomation: 'gearshape.fill',
  sourceExternal: 'arrow.up.right',
  sourceOther: 'ellipsis.circle',
  unpin: 'bookmark.slash',
  markRead: 'envelope.open',
  markUnread: 'envelope.badge',
  unread: 'bubble.left.fill',
} as const satisfies Record<string, SFSymbol>;
