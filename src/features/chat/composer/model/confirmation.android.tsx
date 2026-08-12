import { AlertDialog, Text, TextButton } from '@expo/ui/jetpack-compose';
import { testID as testIDModifier } from '@expo/ui/jetpack-compose/modifiers';

import type { NativeModelConfirmationProps } from '@/features/chat/composer/model/confirmation.types';
import {
  useWaveMaterialColors,
  waveAlertDialogColors,
  waveTextButtonColors,
} from '@/hooks/use-wave-material-colors';

export function NativeModelConfirmation({
  children,
  isPresented,
  message,
  onCancel,
  onConfirm,
}: NativeModelConfirmationProps) {
  const colors = useWaveMaterialColors();

  return (
    <>
      {children}
      {isPresented ? (
        <AlertDialog
          colors={waveAlertDialogColors(colors)}
          onDismissRequest={onCancel}>
          <AlertDialog.Title>
            <Text>Switch to an expensive model?</Text>
          </AlertDialog.Title>
          <AlertDialog.Text>
            <Text modifiers={[testIDModifier('chat-model-confirm-message')]}>
              {message ?? ''}
            </Text>
          </AlertDialog.Text>
          <AlertDialog.DismissButton>
            <TextButton
              colors={waveTextButtonColors(colors)}
              onClick={onCancel}>
              <Text>Cancel</Text>
            </TextButton>
          </AlertDialog.DismissButton>
          <AlertDialog.ConfirmButton>
            <TextButton
              colors={waveTextButtonColors(colors)}
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
