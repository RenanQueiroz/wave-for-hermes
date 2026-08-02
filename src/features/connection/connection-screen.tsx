import * as Device from 'expo-device';
import { Redirect } from 'expo-router';
import {
  Alert,
  Button,
  Card,
  Input,
  LockIcon,
  ShareNodesIcon,
  Typography,
} from 'panelui-native';
import { useMemo, useState } from 'react';
import { ScrollView, Share, View } from 'react-native';

import {
  COMPANION_SETUP_PROMPT,
  COMPANION_SETUP_PROMPT_SHARE_TITLE,
} from './companion-setup-prompt';
import { useWaveConnection } from './connection-provider';

const PAIRING_CODE_LENGTH = 16;
type ConnectionField =
  'baseUrl' | 'deviceName' | 'pairingCode' | 'password' | 'username';

interface FieldValidationError {
  field: ConnectionField;
  message: string;
}

export function ConnectionScreen() {
  const { forget, pair, retry, signIn, state } = useWaveConnection();
  // Signing in to a Hermes gateway is the primary path; pairing with a Wave
  // Companion is kept for devices that have not migrated (see the
  // direct-to-gateway migration in docs/roadmap.md).
  const [mode, setMode] = useState<'gateway' | 'companion'>('gateway');
  const [baseUrl, setBaseUrl] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
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

  const submitSignIn = () => {
    const trimmedUrl = baseUrl.trim();
    const trimmedUsername = username.trim();
    if (!trimmedUrl) {
      setValidationError({
        field: 'baseUrl',
        message: 'Enter the URL of your Hermes gateway.',
      });
      return;
    }
    if (!trimmedUsername) {
      setValidationError({
        field: 'username',
        message: 'Enter your Hermes username.',
      });
      return;
    }
    if (!password) {
      setValidationError({
        field: 'password',
        message: 'Enter your Hermes password.',
      });
      return;
    }
    setValidationError(undefined);
    void signIn({
      baseUrl: trimmedUrl,
      password,
      provider: 'basic',
      username: trimmedUsername,
    });
  };

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
            <Typography.Paragraph muted type="body-sm">
              If the Gateway cannot be reached, forgetting removes this
              credential from the phone only. Revoke the device from the Gateway
              operator tools if it may still be active.
            </Typography.Paragraph>
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
              accessibilityLabel="Forget saved Wave device locally"
              testID="connection-disconnect-button"
              onPress={() => void forget()}>
              Forget this device locally
            </Button>
          </Card.Footer>
        </Card>
      ) : mode === 'gateway' ? (
        <Card>
          <Card.Header>
            <Card.Title>Sign in to Hermes</Card.Title>
            <Card.Description>
              Use the same username and password as the Hermes dashboard.
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
              autoComplete="url"
              autoCorrect={false}
              disabled={pairing}
              errorMessage={
                validationError?.field === 'baseUrl'
                  ? validationError.message
                  : undefined
              }
              label="Hermes gateway URL"
              placeholder="https://hermes.example.internal"
              testID="gateway-url-input"
              value={baseUrl}
              variant="filled"
              onChangeText={(value) => {
                setBaseUrl(value);
                clearFieldError(validationError, 'baseUrl', setValidationError);
              }}
            />
            <Input
              autoCapitalize="none"
              autoComplete="username"
              autoCorrect={false}
              disabled={pairing}
              errorMessage={
                validationError?.field === 'username'
                  ? validationError.message
                  : undefined
              }
              label="Username"
              testID="gateway-username-input"
              value={username}
              variant="filled"
              onChangeText={(value) => {
                setUsername(value);
                clearFieldError(
                  validationError,
                  'username',
                  setValidationError,
                );
              }}
            />
            <Input
              secureTextEntry
              autoCapitalize="none"
              autoComplete="current-password"
              autoCorrect={false}
              disabled={pairing}
              errorMessage={
                validationError?.field === 'password'
                  ? validationError.message
                  : undefined
              }
              label="Password"
              testID="gateway-password-input"
              value={password}
              variant="filled"
              onChangeText={(value) => {
                setPassword(value);
                clearFieldError(
                  validationError,
                  'password',
                  setValidationError,
                );
              }}
              onSubmitEditing={submitSignIn}
            />
          </Card.Content>
          <Card.Footer className="flex-col">
            <Button
              fullWidth
              accessibilityLabel="Sign in to Hermes"
              loading={pairing}
              startContent={<LockIcon size={18} />}
              testID="gateway-sign-in-button"
              onPress={submitSignIn}>
              {pairing ? 'Signing in…' : 'Sign in'}
            </Button>
            <Button
              fullWidth
              variant="ghost"
              accessibilityLabel="Pair with a Wave Companion instead"
              disabled={pairing}
              testID="use-companion-pairing-button"
              onPress={() => {
                setValidationError(undefined);
                setMode('companion');
              }}>
              Use a Wave Companion instead
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
          <Card.Footer className="flex-col">
            <Button
              fullWidth
              accessibilityLabel="Pair this device with Wave Companion"
              loading={pairing}
              startContent={<LockIcon size={18} />}
              testID="pair-device-button"
              onPress={submit}>
              {pairing ? 'Pairing…' : 'Pair device'}
            </Button>
            <Button
              fullWidth
              variant="ghost"
              accessibilityLabel="Sign in to a Hermes gateway instead"
              disabled={pairing}
              testID="use-gateway-sign-in-button"
              onPress={() => {
                setValidationError(undefined);
                setMode('gateway');
              }}>
              Sign in to Hermes instead
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

      <View className="gap-2">
        <Button
          fullWidth
          variant="outline"
          accessibilityLabel="Share the companion setup prompt"
          startContent={<ShareNodesIcon size={18} />}
          testID="share-setup-prompt-button"
          onPress={() =>
            void Share.share({
              message: COMPANION_SETUP_PROMPT,
              title: COMPANION_SETUP_PROMPT_SHARE_TITLE,
            })
          }>
          Share setup prompt
        </Button>
        <Typography.Paragraph type="body-xs" muted align="center">
          No companion yet? Send this prompt to the coding agent on the machine
          that runs Hermes and it will set everything up, then reply with the
          URL and pairing code to enter here.
        </Typography.Paragraph>
      </View>

      <Typography.Paragraph type="body-xs" muted align="center">
        A bare address defaults to HTTPS. Plain HTTP is allowed for localhost
        and Tailscale (100.64.0.0/10) addresses, where the transport is already
        private. Typing http:// explicitly also allows a private LAN address —
        192.168.x.x or a Mac&apos;s name.local — but that traffic crosses your
        network unencrypted. If a name.local address does not resolve on this
        device, use the LAN IP instead.
        {__DEV__
          ? ' Development builds also accept an explicit HTTP URL for trusted local testing.'
          : ''}
      </Typography.Paragraph>
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
