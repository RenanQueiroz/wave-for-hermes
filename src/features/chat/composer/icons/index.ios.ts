import type { SFSymbol } from 'sf-symbols-typescript';

export const CHAT_COMPOSER_ICONS = {
  add: 'plus',
  camera: 'camera.fill',
  check: 'checkmark',
  file: 'doc.text.fill',
  image: 'photo.fill',
  liveVoice: 'waveform',
  microphone: 'mic.fill',
  paperclip: 'paperclip',
  photos: 'photo.on.rectangle.angled',
  refresh: 'arrow.clockwise',
  remove: 'xmark',
  run: 'chevron.right',
  send: 'arrow.up',
  stop: 'stop.fill',
} as const satisfies Record<string, SFSymbol>;
