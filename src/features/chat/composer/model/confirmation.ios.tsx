import { Alert, Button, Text } from '@expo/ui/swift-ui';

import type { NativeModelConfirmationProps } from '@/features/chat/composer/model/confirmation.types';

export function NativeModelConfirmation({
  children,
  isPresented,
  message,
  onCancel,
  onConfirm,
}: NativeModelConfirmationProps) {
  return (
    <Alert
      isPresented={isPresented}
      title="Switch to an expensive model?"
      onIsPresentedChange={(presented) => {
        if (!presented) onCancel();
      }}>
      <Alert.Trigger>{children}</Alert.Trigger>
      <Alert.Message>
        <Text testID="chat-model-confirm-message">{message ?? ''}</Text>
      </Alert.Message>
      <Alert.Actions>
        <Button label="Cancel" role="cancel" onPress={onCancel} />
        <Button
          label="Switch"
          testID="chat-model-confirm"
          onPress={onConfirm}
        />
      </Alert.Actions>
    </Alert>
  );
}
