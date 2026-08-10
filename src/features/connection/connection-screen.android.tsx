/** Native Android gateway sign-in, rendered entirely in Jetpack Compose. */
import { Host } from '@expo/ui';
import {
  Button,
  Column,
  Icon,
  LazyColumn,
  OutlinedTextField,
  Row,
  Spacer,
  Surface,
  Text,
  TextButton,
  useMaterialColors,
  type TextFieldRef,
} from '@expo/ui/jetpack-compose';
import {
  fillMaxSize,
  fillMaxWidth,
  imePadding,
  padding,
  testID as testIDModifier,
} from '@expo/ui/jetpack-compose/modifiers';
import { Redirect } from 'expo-router';
import { useRef } from 'react';

import {
  CONNECTION_COPY,
  useConnectionScreen,
} from '@/features/connection/connection-screen.shared';

function ErrorText({ children, testID }: { children: string; testID: string }) {
  const colors = useMaterialColors();
  return (
    <Text
      color={colors.error}
      style={{ typography: 'bodyMedium' }}
      modifiers={[fillMaxWidth(), testIDModifier(testID)]}>
      {children}
    </Text>
  );
}

function FieldError({
  children,
  testID,
}: {
  children: string;
  testID: string;
}) {
  const colors = useMaterialColors();
  return (
    <OutlinedTextField.SupportingText>
      <Text color={colors.error} modifiers={[testIDModifier(testID)]}>
        {children}
      </Text>
    </OutlinedTextField.SupportingText>
  );
}

export function ConnectionScreen() {
  const connection = useConnectionScreen();
  const usernameRef = useRef<TextFieldRef>(null);
  const passwordRef = useRef<TextFieldRef>(null);
  const forcedColorScheme =
    connection.appearance === 'system' ? undefined : connection.appearance;
  const colors = useMaterialColors({ colorScheme: forcedColorScheme });

  if (connection.connected) {
    return <Redirect href="/new" />;
  }

  return (
    <Host colorScheme={forcedColorScheme} style={{ flex: 1 }}>
      <Surface color={colors.background} modifiers={[fillMaxSize()]}>
        <LazyColumn
          contentPadding={{ top: 32, bottom: 32 }}
          modifiers={[fillMaxSize(), imePadding()]}>
          <Column
            verticalArrangement={{ spacedBy: 8 }}
            modifiers={[fillMaxWidth(), padding(24, 48, 24, 24)]}>
            <Text
              color={colors.onBackground}
              style={{ typography: 'headlineMedium' }}
              modifiers={[testIDModifier('connection-title')]}>
              {CONNECTION_COPY.title}
            </Text>
            <Text
              color={colors.onSurfaceVariant}
              style={{ typography: 'bodyLarge' }}
              modifiers={[testIDModifier('connection-subtitle')]}>
              {CONNECTION_COPY.intro}
            </Text>
          </Column>

          {connection.savedConnection ? (
            <Column
              verticalArrangement={{ spacedBy: 12 }}
              modifiers={[fillMaxWidth(), padding(24, 8, 24, 0)]}>
              <Text
                color={colors.primary}
                style={{ typography: 'titleMedium' }}>
                Saved connection needs attention
              </Text>
              <Column verticalArrangement={{ spacedBy: 2 }}>
                <Text
                  color={colors.onBackground}
                  style={{ typography: 'bodyLarge' }}>
                  {connection.savedConnection.label}
                </Text>
                <Text
                  color={colors.onSurfaceVariant}
                  style={{ typography: 'bodyMedium' }}>
                  {connection.savedConnection.baseUrl}
                </Text>
              </Column>
              <ErrorText testID="connection-saved-error">
                {connection.savedConnection.error}
              </ErrorText>
              {connection.savedConnection.retryable ? (
                <Button
                  modifiers={[
                    fillMaxWidth(),
                    testIDModifier('connection-retry-button'),
                  ]}
                  onClick={connection.retryConnection}>
                  <Text>Retry connection</Text>
                </Button>
              ) : null}
              <TextButton
                colors={{ contentColor: colors.error }}
                modifiers={[
                  fillMaxWidth(),
                  testIDModifier('connection-disconnect-button'),
                ]}
                onClick={connection.forgetConnection}>
                <Text>Sign out on this device</Text>
              </TextButton>
              <Text
                color={colors.onSurfaceVariant}
                style={{ typography: 'bodySmall' }}>
                {CONNECTION_COPY.signOutFooter}
              </Text>
            </Column>
          ) : (
            <Column
              verticalArrangement={{ spacedBy: 8 }}
              modifiers={[fillMaxWidth(), padding(24, 8, 24, 0)]}>
              <Text color={colors.primary} style={{ typography: 'titleSmall' }}>
                Sign in to Hermes
              </Text>
              {connection.connectionError ? (
                <ErrorText testID="connection-sign-in-error">
                  {connection.connectionError}
                </ErrorText>
              ) : null}

              <OutlinedTextField
                enabled={!connection.signingIn}
                isError={Boolean(connection.fieldErrors.baseUrl)}
                singleLine
                value={
                  connection.baseUrl as Parameters<
                    typeof OutlinedTextField
                  >[0]['value']
                }
                keyboardActions={{
                  onNext: () => void usernameRef.current?.focus(),
                }}
                keyboardOptions={{
                  autoCorrectEnabled: false,
                  capitalization: 'none',
                  imeAction: 'next',
                  keyboardType: 'uri',
                }}
                modifiers={[
                  fillMaxWidth(),
                  testIDModifier('gateway-url-input'),
                ]}
                onValueChange={
                  connection.fieldErrors.baseUrl
                    ? () => connection.clearFieldError('baseUrl')
                    : undefined
                }>
                <OutlinedTextField.Label>
                  <Text>Gateway URL</Text>
                </OutlinedTextField.Label>
                <OutlinedTextField.Placeholder>
                  <Text>https://…</Text>
                </OutlinedTextField.Placeholder>
                {connection.fieldErrors.baseUrl ? (
                  <FieldError testID="gateway-url-error">
                    {connection.fieldErrors.baseUrl}
                  </FieldError>
                ) : null}
              </OutlinedTextField>

              <OutlinedTextField
                ref={usernameRef}
                enabled={!connection.signingIn}
                isError={Boolean(connection.fieldErrors.username)}
                singleLine
                value={
                  connection.username as Parameters<
                    typeof OutlinedTextField
                  >[0]['value']
                }
                keyboardActions={{
                  onNext: () => void passwordRef.current?.focus(),
                }}
                keyboardOptions={{
                  autoCorrectEnabled: false,
                  capitalization: 'none',
                  imeAction: 'next',
                  keyboardType: 'ascii',
                }}
                modifiers={[
                  fillMaxWidth(),
                  testIDModifier('gateway-username-input'),
                ]}
                onValueChange={
                  connection.fieldErrors.username
                    ? () => connection.clearFieldError('username')
                    : undefined
                }>
                <OutlinedTextField.Label>
                  <Text>Username</Text>
                </OutlinedTextField.Label>
                {connection.fieldErrors.username ? (
                  <FieldError testID="gateway-username-error">
                    {connection.fieldErrors.username}
                  </FieldError>
                ) : null}
              </OutlinedTextField>

              <OutlinedTextField
                ref={passwordRef}
                enabled={!connection.signingIn}
                isError={Boolean(connection.fieldErrors.password)}
                singleLine
                value={
                  connection.password as Parameters<
                    typeof OutlinedTextField
                  >[0]['value']
                }
                visualTransformation="password"
                keyboardActions={{ onGo: connection.submitSignIn }}
                keyboardOptions={{
                  autoCorrectEnabled: false,
                  capitalization: 'none',
                  imeAction: 'go',
                  keyboardType: 'password',
                }}
                modifiers={[
                  fillMaxWidth(),
                  testIDModifier('gateway-password-input'),
                ]}
                onValueChange={
                  connection.fieldErrors.password
                    ? () => connection.clearFieldError('password')
                    : undefined
                }>
                <OutlinedTextField.Label>
                  <Text>Password</Text>
                </OutlinedTextField.Label>
                {connection.fieldErrors.password ? (
                  <FieldError testID="gateway-password-error">
                    {connection.fieldErrors.password}
                  </FieldError>
                ) : null}
              </OutlinedTextField>
              <Spacer modifiers={[fillMaxWidth(), padding(0, 0, 8, 0)]} />
              <Button
                enabled={!connection.signingIn}
                modifiers={[
                  fillMaxWidth(),
                  testIDModifier('gateway-sign-in-button'),
                ]}
                onClick={connection.submitSignIn}>
                <Text>{connection.signingIn ? 'Signing in…' : 'Sign in'}</Text>
              </Button>
              <Row
                horizontalArrangement="start"
                modifiers={[fillMaxWidth(), padding(0, 16, 0, 0)]}>
                <Icon
                  contentDescription="Connection information"
                  size={20}
                  source={require('@expo/material-symbols/info.xml')}
                  tint={colors.onSurfaceVariant}
                  modifiers={[testIDModifier('connection-info-icon')]}
                />
              </Row>
              <Text
                color={colors.onSurfaceVariant}
                style={{ typography: 'bodySmall' }}>
                {CONNECTION_COPY.signInFooter}
              </Text>
            </Column>
          )}
        </LazyColumn>
      </Surface>
    </Host>
  );
}
