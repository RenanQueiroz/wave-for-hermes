import {
  BasicTextField,
  Box,
  Text,
  type BasicTextFieldRef,
} from '@expo/ui/jetpack-compose';
import {
  defaultMinSize,
  fillMaxWidth,
  padding,
  testID as testIDModifier,
} from '@expo/ui/jetpack-compose/modifiers';
import { useImperativeHandle, useRef } from 'react';

import type {
  ChatComposerInputProps,
  ChatComposerInputRef,
} from '@/features/chat/composer/input.types';

export function ChatComposerInput({
  editable,
  foregroundColor,
  mutedColor,
  onChangeText,
  onSelectionChange,
  onSubmit,
  placeholder,
  primaryColor,
  ref,
  selection,
  text,
  testID,
}: ChatComposerInputProps) {
  const innerRef = useRef<BasicTextFieldRef>(null);

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
    <BasicTextField
      ref={innerRef}
      cursorColor={primaryColor}
      keyboardActions={{ onSend: onSubmit }}
      keyboardOptions={{
        autoCorrectEnabled: true,
        capitalization: 'sentences',
        imeAction: 'send',
        keyboardType: 'text',
      }}
      maxLines={5}
      minLines={1}
      readOnly={!editable}
      selection={selection as Parameters<typeof BasicTextField>[0]['selection']}
      singleLine={false}
      textStyle={{ color: foregroundColor, fontSize: 16, lineHeight: 24 }}
      value={text as Parameters<typeof BasicTextField>[0]['value']}
      modifiers={[
        fillMaxWidth(),
        defaultMinSize({ minHeight: 48 }),
        padding(20, 14, 20, 6),
        testIDModifier(testID),
      ]}
      onSelectionChange={onSelectionChange}
      onValueChange={onChangeText}>
      <BasicTextField.DecorationBox>
        <Box modifiers={[fillMaxWidth()]} contentAlignment="topStart">
          <BasicTextField.Placeholder>
            <Text
              color={mutedColor}
              modifiers={[fillMaxWidth()]}
              style={{ fontSize: 16, lineHeight: 24 }}>
              {placeholder}
            </Text>
          </BasicTextField.Placeholder>
          <BasicTextField.InnerTextField />
        </Box>
      </BasicTextField.DecorationBox>
    </BasicTextField>
  );
}
