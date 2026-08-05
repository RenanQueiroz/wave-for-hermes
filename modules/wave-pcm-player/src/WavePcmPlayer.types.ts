export type PcmPlaybackState = 'buffering' | 'draining' | 'idle' | 'playing';

export type PcmPlaybackOutcome =
  | 'backgrounded'
  | 'destroyed'
  | 'drained'
  | 'failed'
  | 'interrupted'
  | 'stopped';

export interface PcmPlaybackCompletion {
  outcome: PcmPlaybackOutcome;
  playedFrames: number;
  writtenFrames: number;
}

export interface PcmPlaybackEvent {
  channels: number;
  playedFrames: number;
  queuedDurationMs: number;
  reason?: PcmPlaybackOutcome;
  sampleRate: number;
  state: PcmPlaybackState;
  writtenFrames: number;
}

export type WavePcmPlayerModuleEvents = {
  onPlaybackStateChanged: (event: PcmPlaybackEvent) => void;
};
