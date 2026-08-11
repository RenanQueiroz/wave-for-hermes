import type { TurnPlaybackStatus } from '@/features/chat/turn-actions/types';

export interface NativeTurnActionRowProps {
  busy: boolean;
  copied: boolean;
  foregroundColor: string;
  messageId: string;
  onBranch?: () => void;
  onCopy: () => void;
  onPlay?: () => void;
  onRegenerate?: () => void;
  onTimestampPress: () => void;
  playbackStatus: TurnPlaybackStatus;
  seedColor: string;
  timestamp: string;
}

export type NativeTurnActionButtonsProps = Pick<
  NativeTurnActionRowProps,
  | 'busy'
  | 'copied'
  | 'foregroundColor'
  | 'messageId'
  | 'onBranch'
  | 'onCopy'
  | 'onPlay'
  | 'onRegenerate'
  | 'playbackStatus'
>;
