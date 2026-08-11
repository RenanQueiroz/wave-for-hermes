import { Icon } from '@expo/ui';

export const TURN_ACTION_ICONS = {
  branch: Icon.select({
    android: import('@expo/material-symbols/fork_right.xml'),
    ios: 'arrow.triangle.branch',
  }),
  check: Icon.select({
    android: import('@expo/material-symbols/check.xml'),
    ios: 'checkmark',
  }),
  copy: Icon.select({
    android: import('@expo/material-symbols/content_copy.xml'),
    ios: 'doc.on.doc',
  }),
  pause: Icon.select({
    android: import('@expo/material-symbols/pause.xml'),
    ios: 'pause.fill',
  }),
  play: Icon.select({
    android: import('@expo/material-symbols/play_arrow.xml'),
    ios: 'play.fill',
  }),
  refresh: Icon.select({
    android: import('@expo/material-symbols/refresh.xml'),
    ios: 'arrow.clockwise',
  }),
} as const;
