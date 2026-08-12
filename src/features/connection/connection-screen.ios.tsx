/** Native iOS gateway sign-in, rendered entirely in SwiftUI. */
import { Host } from '@expo/ui';
import {
  Button,
  Form,
  Section,
  SecureField,
  Text,
  TextField,
  VStack,
  type SecureFieldRef,
  type TextFieldRef,
} from '@expo/ui/swift-ui';
import {
  accessibilityIdentifier,
  autocorrectionDisabled,
  buttonStyle,
  controlSize,
  disabled,
  frame,
  font,
  foregroundStyle,
  keyboardType,
  listRowBackground,
  listRowInsets,
  listRowSeparator,
  listSectionSpacing,
  onSubmit,
  submitLabel,
  textContentType,
  textInputAutocapitalization,
} from '@expo/ui/swift-ui/modifiers';
import { Redirect } from 'expo-router';
import { useCallback, useRef } from 'react';

import {
  CONNECTION_COPY,
  useConnectionScreen,
} from '@/features/connection/connection-screen.shared';
import { useTheme } from '@/hooks/use-theme';

const SECONDARY_TEXT = foregroundStyle({
  style: 'secondary',
  type: 'hierarchical',
});

function ErrorText({ children, testID }: { children: string; testID: string }) {
  const theme = useTheme();
  return (
    <Text
      modifiers={[
        foregroundStyle(theme.destructive),
        accessibilityIdentifier(testID),
      ]}>
      {children}
    </Text>
  );
}

export function ConnectionScreen() {
  const connection = useConnectionScreen();
  const theme = useTheme();
  const usernameRef = useRef<TextFieldRef>(null);
  const passwordRef = useRef<SecureFieldRef>(null);
  const focusUsername = useCallback(() => {
    void usernameRef.current?.focus();
  }, []);
  const focusPassword = useCallback(() => {
    void passwordRef.current?.focus();
  }, []);

  if (connection.connected) {
    return <Redirect href="/new" />;
  }

  const forcedColorScheme =
    connection.appearance === 'system' ? undefined : connection.appearance;

  return (
    <Host
      colorScheme={forcedColorScheme}
      seedColor={theme.primary}
      style={{ flex: 1 }}>
      <Form modifiers={[listSectionSpacing('compact')]}>
        <VStack
          alignment="leading"
          spacing={6}
          modifiers={[
            frame({ maxWidth: Infinity, alignment: 'leading' }),
            listRowBackground('clear'),
            listRowSeparator('hidden'),
            listRowInsets({ top: 24, bottom: 12, leading: 20, trailing: 20 }),
          ]}>
          <Text
            modifiers={[
              font({ textStyle: 'title2', weight: 'bold' }),
              accessibilityIdentifier('connection-title'),
            ]}>
            {CONNECTION_COPY.title}
          </Text>
          <Text
            modifiers={[
              SECONDARY_TEXT,
              font({ textStyle: 'body' }),
              accessibilityIdentifier('connection-subtitle'),
            ]}>
            {CONNECTION_COPY.intro}
          </Text>
        </VStack>

        {connection.savedConnection ? (
          <Section
            title="Saved connection needs attention"
            footer={<Text>{CONNECTION_COPY.signOutFooter}</Text>}>
            <VStack alignment="leading" spacing={3}>
              <Text>{connection.savedConnection.label}</Text>
              <Text modifiers={[SECONDARY_TEXT]}>
                {connection.savedConnection.baseUrl}
              </Text>
            </VStack>
            <ErrorText testID="connection-saved-error">
              {connection.savedConnection.error}
            </ErrorText>
            {connection.savedConnection.retryable ? (
              <Button
                label="Retry connection"
                modifiers={[
                  buttonStyle('bordered'),
                  accessibilityIdentifier('connection-retry-button'),
                ]}
                onPress={connection.retryConnection}
              />
            ) : null}
            <Button
              label="Sign out on this device"
              role="destructive"
              modifiers={[
                foregroundStyle(theme.destructive),
                accessibilityIdentifier('connection-disconnect-button'),
              ]}
              onPress={connection.forgetConnection}
            />
          </Section>
        ) : (
          <>
            <Section title="Sign in to Hermes">
              {connection.connectionError ? (
                <ErrorText testID="connection-sign-in-error">
                  {connection.connectionError}
                </ErrorText>
              ) : null}

              <TextField
                placeholder="Gateway URL (https://…)"
                text={
                  connection.baseUrl as Parameters<typeof TextField>[0]['text']
                }
                modifiers={[
                  disabled(connection.signingIn),
                  autocorrectionDisabled(),
                  textInputAutocapitalization('never'),
                  keyboardType('url'),
                  textContentType('URL'),
                  submitLabel('next'),
                  // Expo UI stores this callback as a native submit event; it
                  // does not invoke the ref-reading handler during render.
                  // eslint-disable-next-line react-hooks/refs
                  onSubmit(focusUsername),
                  accessibilityIdentifier('gateway-url-input'),
                ]}
                onTextChange={
                  connection.fieldErrors.baseUrl
                    ? () => connection.clearFieldError('baseUrl')
                    : undefined
                }
              />
              {connection.fieldErrors.baseUrl ? (
                <ErrorText testID="gateway-url-error">
                  {connection.fieldErrors.baseUrl}
                </ErrorText>
              ) : null}

              <TextField
                ref={usernameRef}
                placeholder="Username"
                text={
                  connection.username as Parameters<typeof TextField>[0]['text']
                }
                modifiers={[
                  disabled(connection.signingIn),
                  autocorrectionDisabled(),
                  textInputAutocapitalization('never'),
                  keyboardType('ascii-capable'),
                  textContentType('username'),
                  submitLabel('next'),
                  // Expo UI stores this callback as a native submit event; it
                  // does not invoke the ref-reading handler during render.
                  // eslint-disable-next-line react-hooks/refs
                  onSubmit(focusPassword),
                  accessibilityIdentifier('gateway-username-input'),
                ]}
                onTextChange={
                  connection.fieldErrors.username
                    ? () => connection.clearFieldError('username')
                    : undefined
                }
              />
              {connection.fieldErrors.username ? (
                <ErrorText testID="gateway-username-error">
                  {connection.fieldErrors.username}
                </ErrorText>
              ) : null}

              <SecureField
                ref={passwordRef}
                placeholder="Password"
                text={
                  connection.password as Parameters<
                    typeof SecureField
                  >[0]['text']
                }
                modifiers={[
                  disabled(connection.signingIn),
                  autocorrectionDisabled(),
                  textInputAutocapitalization('never'),
                  textContentType('password'),
                  submitLabel('go'),
                  onSubmit(connection.submitSignIn),
                  accessibilityIdentifier('gateway-password-input'),
                ]}
                onTextChange={
                  connection.fieldErrors.password
                    ? () => connection.clearFieldError('password')
                    : undefined
                }
              />
              {connection.fieldErrors.password ? (
                <ErrorText testID="gateway-password-error">
                  {connection.fieldErrors.password}
                </ErrorText>
              ) : null}
            </Section>

            <Button
              modifiers={[
                buttonStyle('borderedProminent'),
                controlSize('large'),
                disabled(connection.signingIn),
                listRowBackground('clear'),
                listRowSeparator('hidden'),
                listRowInsets({ top: 0, bottom: 4, leading: 0, trailing: 0 }),
                accessibilityIdentifier('gateway-sign-in-button'),
              ]}
              onPress={connection.submitSignIn}>
              <Text
                modifiers={[
                  frame({ maxWidth: Infinity }),
                  foregroundStyle(theme.primaryForeground),
                ]}>
                {connection.signingIn ? 'Signing in…' : 'Sign in'}
              </Text>
            </Button>

            <Text
              modifiers={[
                SECONDARY_TEXT,
                font({ textStyle: 'footnote' }),
                listRowBackground('clear'),
                listRowSeparator('hidden'),
                listRowInsets({
                  top: 12,
                  bottom: 12,
                  leading: 20,
                  trailing: 20,
                }),
              ]}>
              {CONNECTION_COPY.signInFooter}
            </Text>
          </>
        )}
      </Form>
    </Host>
  );
}
