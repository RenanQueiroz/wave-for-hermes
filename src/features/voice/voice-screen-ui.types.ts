/**
 * Shared contracts for the voice screens' platform-native chrome. Both voice
 * modes (gateway voice and Realtime) render their status header, transcript
 * blocks, notices, and action buttons through these components; the PanelUI
 * `Soundwave` glow, the shared `PromptCard`, and the gateway assistant reply's
 * `Response` markdown pipeline deliberately stay React Native.
 */

export type VoiceActionIcon = 'end' | 'microphone' | 'retry' | 'send' | 'skip';

export type VoiceCallGlyph =
  | 'close'
  | 'end'
  | 'microphone'
  | 'microphone-off'
  | 'send'
  | 'skip'
  | 'working';

export interface VoiceCallControlSpec {
  accessibilityLabel: string;
  /** Highlighted state (a muted microphone fills the circle with primary). */
  active?: boolean;
  disabled?: boolean;
  glyph: VoiceCallGlyph;
  key: string;
  /** Short caption rendered under the control, call-UI style. */
  label: string;
  onPress(): void;
  /**
   * `end` renders the platform's hang-up affordance (iOS: red circle in the
   * row; Android: wide destructive pill under the row). `start` renders a
   * primary-filled circle. Default is a neutral circle.
   */
  role?: 'default' | 'end' | 'start';
  testID: string;
}

export interface VoiceCallControlsProps {
  /** Ordered controls for one call cluster. */
  controls: VoiceCallControlSpec[];
}

export interface VoiceActionSpec {
  accessibilityLabel: string;
  disabled?: boolean;
  icon?: VoiceActionIcon;
  key: string;
  kind: 'destructive' | 'outline' | 'primary';
  label: string;
  onPress(): void;
  testID: string;
}

export interface VoiceActionsProps {
  /**
   * Rows of actions. A single-button row renders full width; a multi-button
   * row splits the width evenly between its buttons.
   */
  rows: VoiceActionSpec[][];
}

export interface VoiceNoticeProps {
  description: string;
  destructive?: boolean;
  testID: string;
  title: string;
}

export interface VoiceStatusProps {
  description: string;
  note?: string;
  noteTestID?: string;
  title: string;
}

export interface VoiceTranscriptProps {
  muted?: boolean;
  speaker: string;
  testID: string;
  text: string;
}
