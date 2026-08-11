import { Text, TextField, type TextFieldRef } from '@expo/ui/swift-ui';

import {
  accessibilityIdentifier,
  accessibilityLabel,
  disabled,
  font,
  foregroundStyle,
  frame,
  lineLimit,
  onSubmit,
  padding,
  submitLabel,
  tint,
} from '@expo/ui/swift-ui/modifiers';
import { useImperativeHandle, useRef } from 'react';

import type {
  ChatComposerInputProps,
  ChatComposerInputRef,
} from '@/features/chat/composer/input.types';

export function ChatComposerInput({
  accessibilityLabel: label,
  editable,
  foregroundColor,
  mutedColor,
  onChangeText,
  onSelectionChange,
  onSubmit: submit,
  placeholder,
  primaryColor,
  ref,
  selection,
  text,
  testID,
}: ChatComposerInputProps) {
  const innerRef = useRef<TextFieldRef>(null);

  useImperativeHandle(
    ref,
    (): ChatComposerInputRef => ({
      blur: () => innerRef.current?.blur() ?? Promise.resolve(),
      clear: () => innerRef.current?.clear() ?? Promise.resolve(),
      focus: () => innerRef.current?.focus() ?? Promise.resolve(),
      setSelection: (start, end) =>
        innerRef.current?.setSelection(start, end) ?? Promise.resolve(),
      setText: (next) => innerRef.current?.setText(next) ?? Promise.resolve(),
    }),
    [],
  );

  return (
    <TextField
      ref={innerRef}
      axis="vertical"
      selection={selection as Parameters<typeof TextField>[0]['selection']}
      text={text as Parameters<typeof TextField>[0]['text']}
      testID={testID}
      modifiers={[
        padding({ bottom: 6, leading: 20, top: 14, trailing: 20 }),
        frame({ alignment: 'topLeading', maxWidth: Infinity, minHeight: 48 }),
        lineLimit({ max: 5, min: 1 }),
        font({ size: 16 }),
        foregroundStyle(foregroundColor),
        tint(primaryColor),
        submitLabel('send'),
        onSubmit(submit),
        accessibilityLabel(label),
        accessibilityIdentifier(testID),
        disabled(!editable),
      ]}
      onSelectionChange={onSelectionChange}
      onTextChange={onChangeText}>
      <TextField.Placeholder>
        <Text modifiers={[font({ size: 16 }), foregroundStyle(mutedColor)]}>
          {placeholder}
        </Text>
      </TextField.Placeholder>
    </TextField>
  );
}
