import { NativeModule, requireNativeModule } from 'expo';

import type {
  PcmPlaybackCompletion,
  PcmPlaybackEvent,
  WavePcmPlayerModuleEvents,
} from './WavePcmPlayer.types';

declare class WavePcmPlayerModule extends NativeModule<WavePcmPlayerModuleEvents> {
  finishAsync(): Promise<PcmPlaybackCompletion>;
  getStatusAsync(): Promise<PcmPlaybackEvent>;
  startAsync(sampleRate: number, channels: number): Promise<void>;
  stopAsync(): Promise<PcmPlaybackCompletion>;
  writeAsync(data: Uint8Array): Promise<void>;
}

export default requireNativeModule<WavePcmPlayerModule>('WavePcmPlayer');
