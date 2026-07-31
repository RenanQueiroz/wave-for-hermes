import * as Device from 'expo-device';
import { Redirect } from 'expo-router';
import {
  Alert,
  Button,
  Card,
  Input,
  LockIcon,
  Typography,
} from 'panelui-native';
import { useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';

import { useWaveConnection } from './connection-provider';

const PAIRING_CODE_LENGTH = 16;
type ConnectionField = 'baseUrl' | 'deviceName' | 'pairingCode';

interface FieldValidationError {
  field: ConnectionField;
  message: string;
}

export function ConnectionScreen() {
  const { disconnect, pair, retry, state } = useWaveConnection();
  const [baseUrl, setBaseUrl] = useState('');
  const [deviceName, setDeviceName] = useState(
    () => Device.deviceName ?? Device.modelName ?? 'Wave mobile',
  );
  const [pairingCode, setPairingCode] = useState('');
  const [validationError, setValidationError] =
    useState<FieldValidationError>();
  const code = useMemo(() => pairingCode.replace(/-/g, ''), [pairingCode]);

  if (state.phase === 'connected') {
    return <Redirect href="/new" />;
  }

  const savedConnectionError =
    state.phase === 'error' && state.summary ? state : undefined;
  const pairing = state.phase === 'pairing';

  const submit = () => {
    const trimmedUrl = baseUrl.trim();
    const trimmedName = deviceName.trim();
    if (!trimmedUrl) {
      setValidationError({
        field: 'baseUrl',
        message: 'Enter the private URL for your Wave Companion.',
      });
      return;
    }
    if (!trimmedName) {
      setValidationError({
        field: 'deviceName',
        message: 'Name this device so you can revoke it later.',
      });
      return;
    }
    if (code.length !== PAIRING_CODE_LENGTH) {
      setValidationError({
        field: 'pairingCode',
        message: 'Enter the complete 16-character pairing code.',
      });
      return;
    }
    setValidationError(undefined);
    void pair({
      baseUrl: trimmedUrl,
      code,
      deviceName: trimmedName,
    });
  };

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentInsetAdjustmentBehavior="automatic"
      keyboardDismissMode="interactive"
      keyboardShouldPersistTaps="handled"
      contentContainerClassName="mx-auto w-full max-w-xl gap-5 px-5 py-6">
      <View className="gap-2">
        <Typography.Heading type="h2">Your Hermes, in Wave</Typography.Heading>
        <Typography.Paragraph type="lead">
          Pair this phone with the trusted companion running beside your Hermes
          agent.
        </Typography.Paragraph>
      </View>

      {savedConnectionError ? (
        <Card>
          <Card.Header>
            <Card.Title>Saved connection needs attention</Card.Title>
            <Card.Description selectable>
              {savedConnectionError.summary?.baseUrl}
            </Card.Description>
          </Card.Header>
          <Card.Content className="gap-4">
            <ConnectionAlert
              message={savedConnectionError.error.message}
              destructive={!savedConnectionError.error.retryable}
            />
          </Card.Content>
          <Card.Footer className="flex-col">
            {savedConnectionError.error.retryable ? (
              <Button
                fullWidth
                accessibilityLabel="Retry saved Wave connection"
                testID="connection-retry-button"
                onPress={() => void retry()}>
                Retry connection
              </Button>
            ) : null}
            <Button
              fullWidth
              variant="outline"
              accessibilityLabel="Disconnect saved Wave device"
              testID="connection-disconnect-button"
              onPress={() => void disconnect()}>
              Disconnect and pair again
            </Button>
          </Card.Footer>
        </Card>
      ) : (
        <Card>
          <Card.Header>
            <Card.Title>Connect a device</Card.Title>
            <Card.Description>
              Generate a one-time code on the companion, then enter it here.
            </Card.Description>
          </Card.Header>
          <Card.Content className="gap-4">
            {state.phase === 'error' ? (
              <ConnectionAlert
                message={state.error.message}
                destructive={!state.error.retryable}
              />
            ) : null}
            <Input
              autoCapitalize="none"
              autoComplete="off"
              autoCorrect={false}
              disabled={pairing}
              errorMessage={
                validationError?.field === 'baseUrl'
                  ? validationError.message
                  : undefined
              }
              label="Companion URL"
              placeholder="https://wave.example.internal"
              testID="companion-url-input"
              value={baseUrl}
              variant="filled"
              onChangeText={(value) => {
                setBaseUrl(value);
                clearFieldError(validationError, 'baseUrl', setValidationError);
              }}
            />
            <Input
              autoCorrect={false}
              disabled={pairing}
              errorMessage={
                validationError?.field === 'deviceName'
                  ? validationError.message
                  : undefined
              }
              label="Device name"
              testID="device-name-input"
              value={deviceName}
              variant="filled"
              onChangeText={(value) => {
                setDeviceName(value);
                clearFieldError(
                  validationError,
                  'deviceName',
                  setValidationError,
                );
              }}
            />
            <Input
              autoCapitalize="characters"
              autoComplete="one-time-code"
              autoCorrect={false}
              disabled={pairing}
              errorMessage={
                validationError?.field === 'pairingCode'
                  ? validationError.message
                  : undefined
              }
              label="Pairing code"
              maxLength={19}
              placeholder="XXXX-XXXX-XXXX-XXXX"
              testID="pairing-code-input"
              value={pairingCode}
              variant="filled"
              onChangeText={(value) => {
                setPairingCode(formatPairingCode(value));
                clearFieldError(
                  validationError,
                  'pairingCode',
                  setValidationError,
                );
              }}
              onSubmitEditing={submit}
            />
          </Card.Content>
          <Card.Footer>
            <Button
              fullWidth
              accessibilityLabel="Pair this device with Wave Companion"
              loading={pairing}
              startContent={<LockIcon size={18} />}
              testID="pair-device-button"
              onPress={submit}>
              {pairing ? 'Pairing…' : 'Pair device'}
            </Button>
          </Card.Footer>
        </Card>
      )}

      <Alert variant="info">
        <Alert.Indicator />
        <Alert.Content>
          <Alert.Title>Upstream keys stay on the companion</Alert.Title>
          <Alert.Description>
            Wave stores only this device&apos;s revocable credential in the
            platform secure store.
          </Alert.Description>
        </Alert.Content>
      </Alert>

      {__DEV__ ? (
        <Typography.Paragraph type="body-xs" muted align="center">
          Local development also permits an explicit HTTP companion URL.
          Production builds require HTTPS.
        </Typography.Paragraph>
      ) : null}
    </ScrollView>
  );
}

function ConnectionAlert({
  destructive,
  message,
}: {
  destructive: boolean;
  message: string;
}) {
  return (
    <Alert variant={destructive ? 'destructive' : 'warning'}>
      <Alert.Indicator />
      <Alert.Content>
        <Alert.Title>Connection failed</Alert.Title>
        <Alert.Description selectable>{message}</Alert.Description>
      </Alert.Content>
    </Alert>
  );
}

function formatPairingCode(value: string) {
  const normalized = value
    .toUpperCase()
    .replace(/[^A-Z2-9]/g, '')
    .slice(0, PAIRING_CODE_LENGTH);
  return normalized.match(/.{1,4}/g)?.join('-') ?? normalized;
}

function clearFieldError(
  error: FieldValidationError | undefined,
  field: ConnectionField,
  setError: (error: FieldValidationError | undefined) => void,
) {
  if (error?.field === field) setError(undefined);
}
