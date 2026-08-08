/**
 * Gateway sign-in as a native form (SwiftUI `Form` / Material 3 list via
 * `@expo/ui`). The form owns its own scrolling and keyboard insets. Field
 * drafts live in `useNativeState` so typing never round-trips through the JS
 * thread; values are read once at submit time.
 */
import {
  Button,
  FieldGroup,
  Host,
  Text,
  TextInput,
  useNativeState,
  type TextInputRef,
} from '@expo/ui';
import { Redirect } from 'expo-router';
import { Typography } from 'panelui-native';
import { useRef, useState } from 'react';
import { View } from 'react-native';

import { useWaveConnection } from './connection-provider';
import { FormFooterText, FormRow } from '@/components/form-row';
import { useDestructiveColor } from '@/hooks/use-theme';

type ConnectionField = 'baseUrl' | 'password' | 'username';

interface FieldValidationError {
  field: ConnectionField;
  message: string;
}

const HTTP_POLICY_TEXT =
  'A bare address defaults to HTTPS. Plain HTTP is allowed for localhost ' +
  'and Tailscale (100.64.0.0/10) addresses, where the transport is already ' +
  'private. Typing http:// explicitly also allows a private LAN address — ' +
  "192.168.x.x or a Mac's name.local — but that traffic crosses your " +
  'network unencrypted. If a name.local address does not resolve on this ' +
  'device, use the LAN IP instead.' +
  (__DEV__
    ? ' Development builds also accept an explicit HTTP URL for trusted local testing.'
    : '');

export function ConnectionScreen() {
  const { forget, retry, signIn, state } = useWaveConnection();
  const baseUrl = useNativeState('');
  const username = useNativeState('');
  const password = useNativeState('');
  const usernameRef = useRef<TextInputRef>(null);
  const passwordRef = useRef<TextInputRef>(null);
  const [validationError, setValidationError] =
    useState<FieldValidationError>();
  const destructive = useDestructiveColor();

  if (state.phase === 'connected') {
    return <Redirect href="/new" />;
  }

  const savedConnectionError =
    state.phase === 'error' && state.identity ? state : undefined;
  const signingIn = state.phase === 'signing-in';

  const submitSignIn = () => {
    const trimmedUrl = baseUrl.value.trim();
    const trimmedUsername = username.value.trim();
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
    if (!password.value) {
      setValidationError({
        field: 'password',
        message: 'Enter your Hermes password.',
      });
      return;
    }
    setValidationError(undefined);
    void signIn({
      baseUrl: trimmedUrl,
      password: password.value,
      provider: 'basic',
      username: trimmedUsername,
    });
  };

  const fieldError = (field: ConnectionField) =>
    validationError?.field === field ? (
      <Text textStyle={{ color: destructive }}>{validationError.message}</Text>
    ) : null;
  const clearFieldError = (field: ConnectionField) => {
    if (validationError?.field === field) setValidationError(undefined);
  };

  return (
    <View className="flex-1 bg-background">
      <View className="gap-2 px-5 pb-1 pt-6">
        <Typography.Heading type="h2">Your Hermes, in Wave</Typography.Heading>
        <Typography.Paragraph type="lead">
          Sign in to your Hermes agent to chat from this phone.
        </Typography.Paragraph>
      </View>

      <Host style={{ flex: 1 }}>
        <FieldGroup>
          {savedConnectionError ? (
            <FieldGroup.Section title="Saved connection needs attention">
              <FormRow supportingText={savedConnectionError.identity?.baseUrl}>
                {savedConnectionError.identity?.label ?? 'Saved gateway'}
              </FormRow>
              <Text textStyle={{ color: destructive }}>
                {`Connection failed: ${savedConnectionError.error.message}`}
              </Text>
              {savedConnectionError.error.retryable ? (
                <Button
                  label="Retry connection"
                  testID="connection-retry-button"
                  variant="text"
                  onPress={() => void retry()}
                />
              ) : null}
              <Button
                testID="connection-disconnect-button"
                variant="text"
                onPress={() => void forget()}>
                <Text textStyle={{ color: destructive }}>
                  Sign out on this device
                </Text>
              </Button>
              <FieldGroup.SectionFooter>
                <FormFooterText>
                  Signing out removes this device&apos;s session tokens from the
                  phone. The gateway invalidates them the next time its token
                  secret rotates.
                </FormFooterText>
              </FieldGroup.SectionFooter>
            </FieldGroup.Section>
          ) : (
            <FieldGroup.Section title="Sign in to Hermes">
              {state.phase === 'error' ? (
                <Text textStyle={{ color: destructive }}>
                  {`Connection failed: ${state.error.message}`}
                </Text>
              ) : null}
              <TextInput
                autoCapitalize="none"
                autoCorrect={false}
                editable={!signingIn}
                // Android keyboards apply suggestions/correction to plain
                // text fields even with autoCorrect off; the URI input class
                // is what actually disables them (and adds the "/" key).
                keyboardType="url"
                placeholder="Gateway URL (https://…)"
                returnKeyType="next"
                testID="gateway-url-input"
                value={baseUrl}
                onChangeText={() => clearFieldError('baseUrl')}
                onSubmitEditing={() => usernameRef.current?.focus()}
              />
              {fieldError('baseUrl')}
              <TextInput
                ref={usernameRef}
                autoCapitalize="none"
                autoCorrect={false}
                editable={!signingIn}
                // Usernames are not words: visible-password is the input
                // class Android keyboards reliably leave alone (no
                // suggestions, no correction). iOS falls back to the default
                // keyboard.
                keyboardType="visible-password"
                placeholder="Username"
                returnKeyType="next"
                testID="gateway-username-input"
                value={username}
                onChangeText={() => clearFieldError('username')}
                onSubmitEditing={() => passwordRef.current?.focus()}
              />
              {fieldError('username')}
              <TextInput
                ref={passwordRef}
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
                editable={!signingIn}
                placeholder="Password"
                returnKeyType="go"
                testID="gateway-password-input"
                value={password}
                onChangeText={() => clearFieldError('password')}
                onSubmitEditing={submitSignIn}
              />
              {fieldError('password')}
              <Button
                disabled={signingIn}
                label={signingIn ? 'Signing in…' : 'Sign in'}
                testID="gateway-sign-in-button"
                variant="text"
                onPress={submitSignIn}
              />
              <FieldGroup.SectionFooter>
                <FormFooterText>
                  {'Use the same username and password as the Hermes ' +
                    'dashboard.\n\nCredentials stay on this phone: Wave keeps ' +
                    'only rotating gateway session tokens in the platform ' +
                    'secure store. Your password is sent to the gateway once ' +
                    `and never saved.\n\n${HTTP_POLICY_TEXT}`}
                </FormFooterText>
              </FieldGroup.SectionFooter>
            </FieldGroup.Section>
          )}
        </FieldGroup>
      </Host>
    </View>
  );
}
