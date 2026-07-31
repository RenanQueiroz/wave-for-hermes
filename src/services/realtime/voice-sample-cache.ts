import {
  WaveRealtimeVoiceIdSchema,
  WaveRealtimeVoiceSamplesVersionSchema,
  type WaveRealtimeVoiceId,
} from '@wave/contracts';
import { Directory, File, Paths } from 'expo-file-system';

const ROOT_DIRECTORY_NAME = 'wave-voice-samples';

// Downloaded previews live under one directory per samples version. The
// Gateway changes that version only when its Realtime model changes, so cached
// files never expire on their own; saving a sample prunes every other version.
export class VoiceSampleCache {
  getCachedSampleUri(
    samplesVersion: string,
    voiceId: WaveRealtimeVoiceId,
  ): string | undefined {
    try {
      const file = this.sampleFile(samplesVersion, voiceId);
      return file.exists ? file.uri : undefined;
    } catch {
      return undefined;
    }
  }

  saveSample(
    samplesVersion: string,
    voiceId: WaveRealtimeVoiceId,
    sample: Uint8Array,
  ): string {
    const versionDirectory = this.versionDirectory(samplesVersion);
    this.pruneOtherVersions(versionDirectory.name);
    if (!versionDirectory.exists) {
      versionDirectory.create({ idempotent: true, intermediates: true });
    }
    const file = this.sampleFile(samplesVersion, voiceId);
    file.write(sample);
    return file.uri;
  }

  private pruneOtherVersions(currentVersionDirectoryName: string) {
    try {
      const root = new Directory(Paths.cache, ROOT_DIRECTORY_NAME);
      if (!root.exists) {
        return;
      }
      for (const entry of root.list()) {
        if (entry.name !== currentVersionDirectoryName) {
          entry.delete();
        }
      }
    } catch {
      // Pruning stale versions is best effort; playback still works without it.
    }
  }

  private sampleFile(samplesVersion: string, voiceId: WaveRealtimeVoiceId) {
    return new File(
      this.versionDirectory(samplesVersion),
      `${WaveRealtimeVoiceIdSchema.parse(voiceId)}.wav`,
    );
  }

  private versionDirectory(samplesVersion: string) {
    return new Directory(
      Paths.cache,
      ROOT_DIRECTORY_NAME,
      WaveRealtimeVoiceSamplesVersionSchema.parse(samplesVersion),
    );
  }
}
