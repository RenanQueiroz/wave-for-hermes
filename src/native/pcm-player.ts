import type { EventSubscription } from 'expo-modules-core';

import WavePcmPlayerModule, {
  type PcmPlaybackCompletion,
  type PcmPlaybackEvent,
  type PcmPlaybackOutcome,
} from '../../modules/wave-pcm-player';
import {
  type PcmFormat,
  validatePcmChunk,
  validatePcmFormat,
} from '@/native/pcm-player-contract';

class PcmStreamPlayer {
  private activeFormat: PcmFormat | undefined;

  async start(format: PcmFormat) {
    validatePcmFormat(format);
    if (this.activeFormat) {
      throw new Error('A PCM playback session is already active.');
    }
    await WavePcmPlayerModule.startAsync(format.sampleRate, format.channels);
    this.activeFormat = format;
  }

  async write(data: Uint8Array) {
    const format = this.activeFormat;
    if (!format) {
      throw new Error('No PCM playback session is active.');
    }
    validatePcmChunk(data, format.channels);
    await WavePcmPlayerModule.writeAsync(data);
  }

  async finish(): Promise<PcmPlaybackCompletion> {
    if (!this.activeFormat) {
      throw new Error('No PCM playback session is active.');
    }
    try {
      return await WavePcmPlayerModule.finishAsync();
    } finally {
      this.activeFormat = undefined;
    }
  }

  async stop() {
    try {
      return await WavePcmPlayerModule.stopAsync();
    } finally {
      this.activeFormat = undefined;
    }
  }

  getStatus() {
    return WavePcmPlayerModule.getStatusAsync();
  }

  subscribe(listener: (event: PcmPlaybackEvent) => void): EventSubscription {
    return WavePcmPlayerModule.addListener(
      'onPlaybackStateChanged',
      (event) => {
        if (event.state === 'idle') this.activeFormat = undefined;
        listener(event);
      },
    );
  }
}

/** One native owner prevents overlapping gateway speech sessions. */
export const pcmStreamPlayer = new PcmStreamPlayer();

export type { PcmPlaybackCompletion, PcmPlaybackEvent, PcmPlaybackOutcome };
