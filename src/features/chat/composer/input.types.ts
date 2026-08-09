import type { Ref } from 'react';

export interface ChatComposerInputRef {
  blur(): Promise<void>;
  clear(): Promise<void>;
  focus(): Promise<void>;
  setSelection(start: number, end: number): Promise<void>;
  setText(text: string): Promise<void>;
}

export interface NativeComposerState<T> {
  value: T;
}

export interface ChatComposerInputProps {
  accessibilityLabel: string;
  editable: boolean;
  foregroundColor: string;
  mutedColor: string;
  onChangeText(text: string): void;
  onSelectionChange(selection: { end: number; start: number }): void;
  onSubmit(): void;
  placeholder: string;
  primaryColor: string;
  ref?: Ref<ChatComposerInputRef>;
  selection: NativeComposerState<{ end: number; start: number }>;
  text: NativeComposerState<string>;
  testID: string;
}
