import { Redirect } from 'expo-router';
import {
  Alert,
  Button,
  Card,
  Input,
  LockIcon,
  Typography,
} from 'panelui-native';
import { useState } from 'react';
import { View } from 'react-native';

import { useWaveConnection } from './connection-provider';
import { KeyboardAwareScrollView } from '@/components/keyboard-aware-scroll-view';

type ConnectionField = 'baseUrl' | 'password' | 'username';

interface FieldValidationError {
  field: ConnectionField;
  message: string;
}

export function ConnectionScreen() {
  const { forget, retry, signIn, state } = useWaveConnection();
  const [baseUrl, setBaseUrl] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [validationError, setValidationError] =
    useState<FieldValidationError>();

  if (state.phase === 'connected') {
    return <Redirect href="/new" />;
  }

  const savedConnectionError =
    state.phase === 'error' && state.identity ? state : undefined;
  const signingIn = state.phase === 'signing-in';

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

  return (
    // Keyboard-aware: scrolls the focused field clear of the keyboard, which
    // matters for the lower fields of the sign-in form.
    <KeyboardAwareScrollView
      bottomOffset={24}
      className="flex-1 bg-background"
      contentInsetAdjustmentBehavior="automatic"
      keyboardDismissMode="interactive"
      keyboardShouldPersistTaps="handled"
      contentContainerClassName="mx-auto w-full max-w-xl gap-5 px-5 py-6">
      <View className="gap-2">
        <Typography.Heading type="h2">Your Hermes, in Wave</Typography.Heading>
        <Typography.Paragraph type="lead">
          Sign in to your Hermes agent to chat from this phone.
        </Typography.Paragraph>
      </View>

      {savedConnectionError ? (
        <Card>
          <Card.Header>
            <Card.Title>Saved connection needs attention</Card.Title>
            <Card.Description selectable>
              {savedConnectionError.identity?.baseUrl}
            </Card.Description>
          </Card.Header>
          <Card.Content className="gap-4">
            <ConnectionAlert
              message={savedConnectionError.error.message}
              destructive={!savedConnectionError.error.retryable}
            />
            <Typography.Paragraph muted type="body-sm">
              Signing out removes this device&apos;s session tokens from the
              phone. The gateway invalidates them the next time its token secret
              rotates.
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
              accessibilityLabel="Sign out of the saved gateway"
              testID="connection-disconnect-button"
              onPress={() => void forget()}>
              Sign out on this device
            </Button>
          </Card.Footer>
        </Card>
      ) : (
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
              disabled={signingIn}
              errorMessage={
                validationError?.field === 'baseUrl'
                  ? validationError.message
                  : undefined
              }
              // Android keyboards apply suggestions/correction to plain text
              // fields even with autoCorrect off; the URI input class is what
              // actually disables them (and adds the "/" key).
              keyboardType="url"
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
              disabled={signingIn}
              errorMessage={
                validationError?.field === 'username'
                  ? validationError.message
                  : undefined
              }
              // Usernames are not words: visible-password is the input class
              // Android keyboards reliably leave alone (no suggestions, no
              // correction). iOS ignores it and keeps the default keyboard.
              keyboardType="visible-password"
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
              disabled={signingIn}
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
              loading={signingIn}
              startContent={<LockIcon size={18} />}
              testID="gateway-sign-in-button"
              onPress={submitSignIn}>
              {signingIn ? 'Signing in…' : 'Sign in'}
            </Button>
          </Card.Footer>
        </Card>
      )}

      <Alert variant="info">
        <Alert.Indicator />
        <Alert.Content>
          <Alert.Title>Credentials stay on this phone</Alert.Title>
          <Alert.Description>
            Wave keeps only rotating gateway session tokens in the platform
            secure store. Your password is sent to the gateway once and never
            saved.
          </Alert.Description>
        </Alert.Content>
      </Alert>

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
    </KeyboardAwareScrollView>
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

function clearFieldError(
  error: FieldValidationError | undefined,
  field: ConnectionField,
  setError: (error: FieldValidationError | undefined) => void,
) {
  if (error?.field === field) setError(undefined);
}
