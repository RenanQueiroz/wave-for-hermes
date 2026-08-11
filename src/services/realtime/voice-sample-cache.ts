import {
  WaveRealtimeVoiceIdSchema,
  type WaveRealtimeVoiceId,
} from '@wave/contracts';
import { Directory, File, Paths } from 'expo-file-system';

import {
  isWaveRealtimeModelId,
  type WaveRealtimeModelId,
} from './realtime-model-preference-record.ts';

const ROOT_DIRECTORY_NAME = 'wave-voice-samples';
const SAMPLE_FORMAT_VERSION = 1;

/** Cache generated previews by the model that synthesized them. */
export class VoiceSampleCache {
  getCachedSampleUri(
    model: WaveRealtimeModelId,
    voiceId: WaveRealtimeVoiceId,
  ): string | undefined {
    try {
      const file = this.sampleFile(model, voiceId);
      return file.exists ? file.uri : undefined;
    } catch {
      return undefined;
    }
  }

  saveSample(
    model: WaveRealtimeModelId,
    voiceId: WaveRealtimeVoiceId,
    sample: Uint8Array,
  ): string {
    const modelDirectory = this.modelDirectory(model);
    this.pruneOtherModels(modelDirectory.name);
    if (!modelDirectory.exists) {
      modelDirectory.create({ idempotent: true, intermediates: true });
    }
    const file = this.sampleFile(model, voiceId);
    file.write(sample);
    return file.uri;
  }

  private pruneOtherModels(currentDirectoryName: string) {
    try {
      const root = new Directory(Paths.cache, ROOT_DIRECTORY_NAME);
      if (!root.exists) return;
      for (const entry of root.list()) {
        if (entry.name !== currentDirectoryName) entry.delete();
      }
    } catch {
      // Removing stale cache entries is best effort.
    }
  }

  private sampleFile(model: WaveRealtimeModelId, voiceId: WaveRealtimeVoiceId) {
    return new File(
      this.modelDirectory(model),
      `${WaveRealtimeVoiceIdSchema.parse(voiceId)}.wav`,
    );
  }

  private modelDirectory(model: WaveRealtimeModelId) {
    if (!isWaveRealtimeModelId(model)) {
      throw new Error('Invalid Realtime voice sample model.');
    }
    return new Directory(
      Paths.cache,
      ROOT_DIRECTORY_NAME,
      `v${SAMPLE_FORMAT_VERSION}-${model}`,
    );
  }
}
