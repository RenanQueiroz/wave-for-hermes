/** Native Android settings, rendered as a continuous Material 3 list. */
import { Host } from '@expo/ui';
import {
  AlertDialog,
  Button,
  Column,
  FilledTonalButton,
  Icon,
  LazyColumn,
  OutlinedTextField,
  Row,
  Surface,
  Text,
  TextButton,
  useMaterialColors,
} from '@expo/ui/jetpack-compose';
import {
  fillMaxSize,
  fillMaxWidth,
  imePadding,
  padding,
  testID as testIDModifier,
} from '@expo/ui/jetpack-compose/modifiers';
import { Redirect } from 'expo-router';
import { useRef, useState } from 'react';
import { useCSSVariable } from 'uniwind';

import type { OpenAiKeyFieldRef } from '@/features/realtime/use-openai-key-settings';
import {
  SettingsListGroup,
  SettingsListItem,
} from '@/features/settings/settings-list-item';
import {
  SETTINGS_COPY,
  useSettingsScreen,
} from '@/features/settings/settings-screen.shared';

type NativeColor = NonNullable<Parameters<typeof Surface>[0]['color']>;

function SectionHeader({
  children,
  testID,
}: {
  children: string;
  testID: string;
}) {
  const colors = useMaterialColors();
  return (
    <Text
      color={colors.primary}
      style={{ typography: 'titleSmall' }}
      modifiers={[
        fillMaxWidth(),
        padding(24, 24, 24, 8),
        testIDModifier(testID),
      ]}>
      {children}
    </Text>
  );
}

function SectionFooter({ children }: { children: string }) {
  const colors = useMaterialColors();
  return (
    <Column
      verticalArrangement={{ spacedBy: 8 }}
      modifiers={[fillMaxWidth(), padding(24, 16, 24, 16)]}>
      <Row horizontalArrangement="start" modifiers={[fillMaxWidth()]}>
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
        style={{ typography: 'bodyMedium' }}
        modifiers={[fillMaxWidth(), padding(4, 0, 0, 0)]}>
        {children}
      </Text>
    </Column>
  );
}

function SettingsError({
  children,
  testID,
}: {
  children: string;
  testID: string;
}) {
  const colors = useMaterialColors();
  return (
    <Text
      color={colors.error}
      style={{ typography: 'bodyMedium' }}
      modifiers={[
        fillMaxWidth(),
        padding(16, 8, 16, 8),
        testIDModifier(testID),
      ]}>
      {children}
    </Text>
  );
}

export function SettingsScreen() {
  const keyDraftRef = useRef<OpenAiKeyFieldRef>(null);
  const [disconnectOpen, setDisconnectOpen] = useState(false);
  const settings = useSettingsScreen(keyDraftRef);
  const background = useCSSVariable('--color-background');
  const colors = useMaterialColors({
    colorScheme:
      settings.appearance === 'system' ? undefined : settings.appearance,
  });

  if (!settings.connected) {
    return <Redirect href="/" />;
  }

  const forcedColorScheme =
    settings.appearance === 'system' ? undefined : settings.appearance;
  const pageBackground: NativeColor =
    typeof background === 'string' ? background : colors.background;

  return (
    <Host colorScheme={forcedColorScheme} style={{ flex: 1 }}>
      <Surface color={pageBackground} modifiers={[fillMaxSize()]}>
        <LazyColumn
          contentPadding={{ bottom: 32 }}
          modifiers={[fillMaxSize(), imePadding()]}>
          <SectionHeader testID="gateway-connection-card">
            Connection
          </SectionHeader>
          <SettingsListGroup>
            <SettingsListItem
              description={settings.connected.baseUrl}
              label={settings.connected.label}
            />
            <SettingsListItem
              destructive
              description={SETTINGS_COPY.disconnectDescription}
              enabled={!settings.disconnecting}
              label="Disconnect"
              testID="settings-disconnect-button"
              onPress={() => setDisconnectOpen(true)}
            />
          </SettingsListGroup>
          <SectionFooter>{SETTINGS_COPY.connectionFooter}</SectionFooter>

          <SectionHeader testID="openai-key-card">
            Live voice (Realtime)
          </SectionHeader>
          {settings.keyPresent ? (
            <>
              {settings.keyError ? (
                <SettingsError testID="openai-key-error">
                  {settings.keyError}
                </SettingsError>
              ) : null}
              <SettingsListGroup>
                <SettingsListItem
                  label="An OpenAI key is saved on this device."
                  testID="openai-key-present"
                />
                <SettingsListItem
                  description={SETTINGS_COPY.realtimePreferenceDescription}
                  enabled={!settings.realtimeEnabledPending}
                  label="Prefer live voice"
                  type="switch"
                  testID="realtime-enabled-switch"
                  value={settings.realtimeEnabled}
                  onValueChange={settings.setRealtimeEnabled}
                />
                <SettingsListItem
                  description={SETTINGS_COPY.captionsDescription}
                  enabled={settings.captionsHydrated}
                  label="Live captions"
                  type="switch"
                  testID="realtime-captions-switch"
                  value={settings.captions}
                  onValueChange={settings.setCaptions}
                />
                <SettingsListItem
                  description={settings.selectedModelLabel}
                  enabled={settings.modelHydrated}
                  label="Live voice model"
                  testID="realtime-model-picker"
                  onPress={settings.openModelSettings}
                />
                <SettingsListItem
                  description={settings.selectedVoiceLabel}
                  enabled={settings.voiceHydrated}
                  label="Live voice sound"
                  testID="realtime-voice-picker"
                  onPress={settings.openVoiceSettings}
                />
                <SettingsListItem
                  destructive
                  enabled={!settings.keyBusy}
                  label={settings.removeKeyPending ? 'Removing…' : 'Remove key'}
                  testID="openai-key-remove"
                  onPress={settings.removeKey}
                />
              </SettingsListGroup>
            </>
          ) : (
            <Column
              verticalArrangement={{ spacedBy: 12 }}
              modifiers={[fillMaxWidth(), padding(16, 0, 16, 0)]}>
              <OutlinedTextField
                ref={keyDraftRef}
                enabled={!settings.keyBusy}
                isError={Boolean(settings.keyError)}
                singleLine
                value={
                  settings.keyDraft as Parameters<
                    typeof OutlinedTextField
                  >[0]['value']
                }
                visualTransformation="password"
                keyboardActions={{ onDone: settings.saveKey }}
                keyboardOptions={{
                  autoCorrectEnabled: false,
                  capitalization: 'none',
                  imeAction: 'done',
                  keyboardType: 'ascii',
                }}
                modifiers={[fillMaxWidth(), testIDModifier('openai-key-input')]}
                onValueChange={settings.updateKeyDraft}>
                <OutlinedTextField.Label>
                  <Text>OpenAI API key</Text>
                </OutlinedTextField.Label>
                <OutlinedTextField.Placeholder>
                  <Text>sk-…</Text>
                </OutlinedTextField.Placeholder>
                {settings.keyError ? (
                  <OutlinedTextField.SupportingText>
                    <Text
                      color={colors.error}
                      modifiers={[testIDModifier('openai-key-error')]}>
                      {settings.keyError}
                    </Text>
                  </OutlinedTextField.SupportingText>
                ) : null}
              </OutlinedTextField>
              <Button
                enabled={settings.canSaveKey}
                modifiers={[testIDModifier('openai-key-save')]}
                onClick={settings.saveKey}>
                <Text>
                  {settings.saveKeyPending
                    ? 'Validating…'
                    : 'Validate and save'}
                </Text>
              </Button>
            </Column>
          )}
          <SectionFooter>{SETTINGS_COPY.realtimeFooter}</SectionFooter>

          <SectionHeader testID="appearance-card">Appearance</SectionHeader>
          <SettingsListGroup>
            <SettingsListItem
              description={settings.selectedAppearanceLabel}
              enabled={settings.appearanceHydrated}
              label="Theme"
              testID="theme-appearance-picker"
              onPress={settings.openAppearanceSettings}
            />
          </SettingsListGroup>

          <SectionHeader testID="legal-card">About</SectionHeader>
          <SettingsListGroup>
            <SettingsListItem
              description={SETTINGS_COPY.licensesDescription}
              label="Open-source licenses"
              testID="open-source-licenses"
              onPress={settings.openLicenses}
            />
            {settings.showDevelopmentTools ? (
              <SettingsListItem
                description={SETTINGS_COPY.developmentToolsDescription}
                label="Open development tools"
                testID="open-development-tools"
                onPress={settings.openDevelopmentTools}
              />
            ) : null}
          </SettingsListGroup>
        </LazyColumn>
      </Surface>
      {disconnectOpen ? (
        <AlertDialog
          properties={{
            dismissOnBackPress: !settings.disconnecting,
            dismissOnClickOutside: !settings.disconnecting,
          }}
          onDismissRequest={() => {
            if (!settings.disconnecting) setDisconnectOpen(false);
          }}>
          <AlertDialog.Title>
            <Text style={{ typography: 'headlineSmall' }}>
              Disconnect this device?
            </Text>
          </AlertDialog.Title>
          <AlertDialog.Text>
            <Text style={{ typography: 'bodyMedium' }}>
              {SETTINGS_COPY.disconnectAlertMessage}
            </Text>
          </AlertDialog.Text>
          <AlertDialog.DismissButton>
            <TextButton
              enabled={!settings.disconnecting}
              onClick={() => setDisconnectOpen(false)}>
              <Text>Cancel</Text>
            </TextButton>
          </AlertDialog.DismissButton>
          <AlertDialog.ConfirmButton>
            <FilledTonalButton
              enabled={!settings.disconnecting}
              colors={{ contentColor: colors.error }}
              modifiers={[testIDModifier('disconnect-device-confirm')]}
              onClick={() => {
                setDisconnectOpen(false);
                settings.disconnect();
              }}>
              <Text>Disconnect</Text>
            </FilledTonalButton>
          </AlertDialog.ConfirmButton>
        </AlertDialog>
      ) : null}
    </Host>
  );
}
