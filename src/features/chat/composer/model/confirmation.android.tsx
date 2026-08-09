import { AlertDialog, Text, TextButton } from '@expo/ui/jetpack-compose';
import { testID as testIDModifier } from '@expo/ui/jetpack-compose/modifiers';

import type { NativeModelConfirmationProps } from '@/features/chat/composer/model/confirmation.types';

export function NativeModelConfirmation({
  children,
  isPresented,
  message,
  onCancel,
  onConfirm,
}: NativeModelConfirmationProps) {
  return (
    <>
      {children}
      {isPresented ? (
        <AlertDialog onDismissRequest={onCancel}>
          <AlertDialog.Title>
            <Text>Switch to an expensive model?</Text>
          </AlertDialog.Title>
          <AlertDialog.Text>
            <Text modifiers={[testIDModifier('chat-model-confirm-message')]}>
              {message ?? ''}
            </Text>
          </AlertDialog.Text>
          <AlertDialog.DismissButton>
            <TextButton onClick={onCancel}>
              <Text>Cancel</Text>
            </TextButton>
          </AlertDialog.DismissButton>
          <AlertDialog.ConfirmButton>
            <TextButton
              modifiers={[testIDModifier('chat-model-confirm')]}
              onClick={onConfirm}>
              <Text>Switch</Text>
            </TextButton>
          </AlertDialog.ConfirmButton>
        </AlertDialog>
      ) : null}
    </>
  );
}
