import { Icon } from '@expo/ui';

/**
 * Composer glyphs stay native on both platforms. `Icon.select` also lets
 * Metro discard the unused platform source from each native bundle.
 */
export const CHAT_COMPOSER_ICONS = {
  add: Icon.select({
    android: import('@expo/material-symbols/add.xml'),
    ios: 'plus',
  }),
  camera: Icon.select({
    android: import('@expo/material-symbols/photo_camera.xml'),
    ios: 'camera.fill',
  }),
  check: Icon.select({
    android: import('@expo/material-symbols/check.xml'),
    ios: 'checkmark',
  }),
  file: Icon.select({
    android: import('@expo/material-symbols/description.xml'),
    ios: 'doc.text.fill',
  }),
  image: Icon.select({
    android: import('@expo/material-symbols/image.xml'),
    ios: 'photo.fill',
  }),
  liveVoice: Icon.select({
    android: import('@expo/material-symbols/graphic_eq.xml'),
    ios: 'waveform',
  }),
  microphone: Icon.select({
    android: import('@expo/material-symbols/mic.xml'),
    ios: 'mic.fill',
  }),
  paperclip: Icon.select({
    android: import('@expo/material-symbols/attach_file.xml'),
    ios: 'paperclip',
  }),
  photos: Icon.select({
    android: import('@expo/material-symbols/photo_library.xml'),
    ios: 'photo.on.rectangle.angled',
  }),
  refresh: Icon.select({
    android: import('@expo/material-symbols/refresh.xml'),
    ios: 'arrow.clockwise',
  }),
  remove: Icon.select({
    android: import('@expo/material-symbols/close.xml'),
    ios: 'xmark',
  }),
  run: Icon.select({
    android: import('@expo/material-symbols/chevron_right.xml'),
    ios: 'chevron.right',
  }),
  send: Icon.select({
    android: import('@expo/material-symbols/arrow_upward.xml'),
    ios: 'arrow.up',
  }),
  stop: Icon.select({
    android: import('@expo/material-symbols/stop.xml'),
    ios: 'stop.fill',
  }),
} as const;
