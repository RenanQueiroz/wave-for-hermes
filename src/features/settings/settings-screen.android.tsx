/** Native Android settings, rendered as a continuous Material 3 list. */
import { Host } from '@expo/ui';
import {
  Button,
  Column,
  DropdownMenuItem,
  ExposedDropdownMenu,
  ExposedDropdownMenuBox,
  Icon,
  LazyColumn,
  ListItem,
  OutlinedTextField,
  Surface,
  Switch,
  Text,
  useMaterialColors,
  useNativeState,
} from '@expo/ui/jetpack-compose';
import {
  clickable,
  fillMaxSize,
  fillMaxWidth,
  imePadding,
  menuAnchor,
  padding,
  testID as testIDModifier,
  toggleable,
} from '@expo/ui/jetpack-compose/modifiers';
import { Redirect } from 'expo-router';
import { useEffect, useRef, useState } from 'react';

import type { OpenAiKeyFieldRef } from '@/features/realtime/use-openai-key-settings';
import {
  SETTINGS_APPEARANCE_OPTIONS,
  SETTINGS_COPY,
  SETTINGS_REALTIME_MODEL_OPTIONS,
  SETTINGS_REALTIME_VOICE_OPTIONS,
  useSettingsScreen,
} from '@/features/settings/settings-screen.shared';

interface SettingsOption {
  label: string;
  testID: string;
  value: string;
}

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
        padding(16, 24, 16, 8),
        testIDModifier(testID),
      ]}>
      {children}
    </Text>
  );
}

function SectionFooter({ children }: { children: string }) {
  const colors = useMaterialColors();
  return (
    <Text
      color={colors.onSurfaceVariant}
      style={{ typography: 'bodyMedium' }}
      modifiers={[fillMaxWidth(), padding(16, 8, 16, 16)]}>
      {children}
    </Text>
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

function SettingsSwitchRow({
  description,
  enabled,
  label,
  onChange,
  testID,
  value,
}: {
  description: string;
  enabled: boolean;
  label: string;
  onChange: (value: boolean) => void;
  testID: string;
  value: boolean;
}) {
  const colors = useMaterialColors();
  return (
    <ListItem
      colors={{
        containerColor: colors.background,
        contentColor: colors.onBackground,
        supportingContentColor: colors.onSurfaceVariant,
        trailingContentColor: colors.onSurfaceVariant,
      }}
      modifiers={[
        fillMaxWidth(),
        ...(enabled
          ? [toggleable(value, () => onChange(!value), { role: 'switch' })]
          : []),
      ]}>
      <ListItem.HeadlineContent>
        <Text>{label}</Text>
      </ListItem.HeadlineContent>
      <ListItem.SupportingContent>
        <Text>{description}</Text>
      </ListItem.SupportingContent>
      <ListItem.TrailingContent>
        <Switch
          enabled={enabled}
          value={value}
          modifiers={[testIDModifier(testID)]}
        />
      </ListItem.TrailingContent>
    </ListItem>
  );
}

function SettingsActionRow({
  destructive = false,
  description,
  enabled = true,
  label,
  onPress,
  testID,
}: {
  destructive?: boolean;
  description?: string;
  enabled?: boolean;
  label: string;
  onPress: () => void;
  testID: string;
}) {
  const colors = useMaterialColors();
  return (
    <ListItem
      colors={{
        containerColor: colors.background,
        contentColor: destructive ? colors.error : colors.onBackground,
        supportingContentColor: colors.onSurfaceVariant,
      }}
      modifiers={[
        fillMaxWidth(),
        ...(enabled ? [clickable(onPress)] : []),
        testIDModifier(testID),
      ]}>
      <ListItem.HeadlineContent>
        <Text color={destructive ? colors.error : colors.onBackground}>
          {label}
        </Text>
      </ListItem.HeadlineContent>
      {description ? (
        <ListItem.SupportingContent>
          <Text>{description}</Text>
        </ListItem.SupportingContent>
      ) : null}
    </ListItem>
  );
}

function SettingsDropdown({
  enabled,
  label,
  onSelect,
  options,
  selectedLabel,
  selectedValue,
  testID,
}: {
  enabled: boolean;
  label: string;
  onSelect: (value: string) => void;
  options: readonly SettingsOption[];
  selectedLabel: string;
  selectedValue: string;
  testID: string;
}) {
  const colors = useMaterialColors();
  const selectedText = useNativeState(selectedLabel);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    selectedText.set(selectedLabel);
  }, [selectedLabel, selectedText]);

  return (
    <Column modifiers={[fillMaxWidth(), padding(16, 0, 16, 0)]}>
      <ExposedDropdownMenuBox
        expanded={expanded}
        modifiers={[fillMaxWidth()]}
        onExpandedChange={(nextExpanded) => {
          if (enabled) setExpanded(nextExpanded);
        }}>
        <OutlinedTextField
          enabled={enabled}
          readOnly
          singleLine
          value={selectedText}
          modifiers={[
            fillMaxWidth(),
            menuAnchor('primaryNotEditable', enabled),
            testIDModifier(testID),
          ]}>
          <OutlinedTextField.Label>
            <Text>{label}</Text>
          </OutlinedTextField.Label>
          <OutlinedTextField.TrailingIcon>
            <Icon
              size={24}
              source={require('@expo/material-symbols/arrow_drop_down.xml')}
              tint={colors.onSurfaceVariant}
            />
          </OutlinedTextField.TrailingIcon>
        </OutlinedTextField>
        <ExposedDropdownMenu
          containerColor={colors.surfaceContainer}
          expanded={expanded}
          onDismissRequest={() => setExpanded(false)}>
          {options.map((option) => (
            <DropdownMenuItem
              key={option.value}
              modifiers={[testIDModifier(option.testID)]}
              onClick={() => {
                selectedText.set(option.label);
                setExpanded(false);
                onSelect(option.value);
              }}>
              <DropdownMenuItem.Text>
                <Text>{option.label}</Text>
              </DropdownMenuItem.Text>
              {option.value === selectedValue ? (
                <DropdownMenuItem.TrailingIcon>
                  <Icon
                    size={24}
                    source={require('@expo/material-symbols/check.xml')}
                    tint={colors.primary}
                  />
                </DropdownMenuItem.TrailingIcon>
              ) : null}
            </DropdownMenuItem>
          ))}
        </ExposedDropdownMenu>
      </ExposedDropdownMenuBox>
    </Column>
  );
}

export function SettingsScreen() {
  const keyDraftRef = useRef<OpenAiKeyFieldRef>(null);
  const settings = useSettingsScreen(keyDraftRef);
  const colors = useMaterialColors({
    colorScheme:
      settings.appearance === 'system' ? undefined : settings.appearance,
  });

  if (!settings.connected) {
    return <Redirect href="/" />;
  }

  const forcedColorScheme =
    settings.appearance === 'system' ? undefined : settings.appearance;

  return (
    <Host colorScheme={forcedColorScheme} style={{ flex: 1 }}>
      <Surface color={colors.background} modifiers={[fillMaxSize()]}>
        <LazyColumn
          contentPadding={{ bottom: 32 }}
          modifiers={[fillMaxSize(), imePadding()]}>
          <SectionHeader testID="gateway-connection-card">
            Connection
          </SectionHeader>
          <ListItem
            colors={{
              containerColor: colors.background,
              contentColor: colors.onBackground,
              supportingContentColor: colors.onSurfaceVariant,
            }}
            modifiers={[fillMaxWidth()]}>
            <ListItem.HeadlineContent>
              <Text>{settings.connected.label}</Text>
            </ListItem.HeadlineContent>
            <ListItem.SupportingContent>
              <Text>{settings.connected.baseUrl}</Text>
            </ListItem.SupportingContent>
          </ListItem>
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
              <ListItem
                colors={{
                  containerColor: colors.background,
                  contentColor: colors.onBackground,
                }}
                modifiers={[
                  fillMaxWidth(),
                  testIDModifier('openai-key-present'),
                ]}>
                <ListItem.HeadlineContent>
                  <Text>An OpenAI key is saved on this device.</Text>
                </ListItem.HeadlineContent>
              </ListItem>
              <SettingsSwitchRow
                description={SETTINGS_COPY.realtimePreferenceDescription}
                enabled={!settings.realtimeEnabledPending}
                label="Prefer live voice"
                testID="realtime-enabled-switch"
                value={settings.realtimeEnabled}
                onChange={settings.setRealtimeEnabled}
              />
              <SettingsSwitchRow
                description={SETTINGS_COPY.captionsDescription}
                enabled={settings.captionsHydrated}
                label="Live captions"
                testID="realtime-captions-switch"
                value={settings.captions}
                onChange={settings.setCaptions}
              />
              <SettingsActionRow
                destructive
                enabled={!settings.keyBusy}
                label={settings.removeKeyPending ? 'Removing…' : 'Remove key'}
                testID="openai-key-remove"
                onPress={settings.removeKey}
              />
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

          {settings.showRealtimeOptions ? (
            <>
              <SectionHeader testID="realtime-model-card">
                Live voice model
              </SectionHeader>
              <SettingsDropdown
                enabled={settings.modelHydrated}
                label="Model"
                options={SETTINGS_REALTIME_MODEL_OPTIONS.map((option) => ({
                  label: option.id,
                  testID: option.testID,
                  value: option.id,
                }))}
                selectedLabel={settings.selectedModelLabel}
                selectedValue={settings.model}
                testID="realtime-model-picker"
                onSelect={settings.selectModel}
              />
              {settings.modelSaveError ? (
                <SettingsError testID="realtime-model-error">
                  Wave could not save the Realtime model preference.
                </SettingsError>
              ) : null}
              <SectionFooter>{settings.modelDescription}</SectionFooter>

              <SectionHeader testID="realtime-voice-card">
                Live voice sound
              </SectionHeader>
              <SettingsDropdown
                enabled={settings.voiceHydrated}
                label="Voice"
                options={SETTINGS_REALTIME_VOICE_OPTIONS}
                selectedLabel={settings.selectedVoiceLabel}
                selectedValue={settings.voice}
                testID="realtime-voice-picker"
                onSelect={settings.selectVoice}
              />
              {settings.voiceSaveError ? (
                <SettingsError testID="realtime-voice-error">
                  Wave could not save the voice preference.
                </SettingsError>
              ) : null}
              <SectionFooter>{settings.voiceDescription}</SectionFooter>
            </>
          ) : null}

          <SectionHeader testID="appearance-card">Appearance</SectionHeader>
          <SettingsDropdown
            enabled={settings.appearanceHydrated}
            label="Theme"
            options={SETTINGS_APPEARANCE_OPTIONS}
            selectedLabel={settings.selectedAppearanceLabel}
            selectedValue={settings.appearance}
            testID="theme-appearance-picker"
            onSelect={settings.selectAppearance}
          />
          <SectionFooter>{SETTINGS_COPY.themeFooter}</SectionFooter>

          <SectionHeader testID="legal-card">About</SectionHeader>
          <SettingsActionRow
            description={SETTINGS_COPY.licensesDescription}
            label="Open-source licenses"
            testID="open-source-licenses"
            onPress={settings.openLicenses}
          />
          {settings.showDevelopmentTools ? (
            <SettingsActionRow
              description={SETTINGS_COPY.developmentToolsDescription}
              label="Open development tools"
              testID="open-development-tools"
              onPress={settings.openDevelopmentTools}
            />
          ) : null}
          <SectionFooter>{SETTINGS_COPY.aboutFooter}</SectionFooter>
        </LazyColumn>
      </Surface>
    </Host>
  );
}
