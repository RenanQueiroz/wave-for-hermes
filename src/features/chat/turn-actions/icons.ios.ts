import type { SFSymbol } from 'sf-symbols-typescript';

export const TURN_ACTION_ICONS = {
  branch: 'arrow.triangle.branch',
  check: 'checkmark',
  copy: 'doc.on.doc',
  pause: 'pause.fill',
  play: 'play.fill',
  refresh: 'arrow.clockwise',
} as const satisfies Record<string, SFSymbol>;
