import {
  Column,
  DropdownMenu,
  DropdownMenuItem,
  FilledTonalButton,
  Host,
  Icon,
  LazyColumn,
  ModalBottomSheet,
  Row,
  Shape,
  Spacer,
  Switch,
  Text,
  TextButton,
} from '@expo/ui/jetpack-compose';
import {
  alpha,
  fillMaxWidth,
  height,
  padding,
  testID as testIDModifier,
  weight,
  width,
} from '@expo/ui/jetpack-compose/modifiers';
import { useState } from 'react';
import type { ImageSourcePropType } from 'react-native';

import { CHAT_COMPOSER_ICONS } from '@/features/chat/composer/icons';
import {
  MODEL_EFFORT_LABELS,
  modelOptionDescription,
} from '@/features/chat/composer/model/picker';
import type {
  AttachmentSourceSheetProps,
  ModelPickerSheetProps,
} from '@/features/chat/composer/sheets.types';
import { displayModelName } from '@/features/chat/composer/state';
import type { ComposerColors } from '@/features/chat/composer/view.types';
import { modelFamilies } from '@/services/gateway/gateway-models';

export function AttachmentSourceSheet({
  colors,
  isPresented,
  onDismiss,
  onPickFile,
  onPickImage,
  onTakePhoto,
}: AttachmentSourceSheetProps) {
  if (!isPresented) return null;

  return (
    <Host pointerEvents="none" style={{ position: 'absolute' }}>
      <ModalBottomSheet
        contentColor={colors.foreground}
        containerColor={colors.background}
        showDragHandle
        skipPartiallyExpanded
        modifiers={[testIDModifier('chat-attachment-sheet')]}
        onDismissRequest={onDismiss}>
        <Row
          verticalAlignment="center"
          horizontalArrangement="spaceEvenly"
          modifiers={[fillMaxWidth(), padding(16, 8, 16, 24)]}>
          <AttachmentSourceButton
            accessibilityLabel="Take a photo"
            colors={colors}
            icon={CHAT_COMPOSER_ICONS.camera as ImageSourcePropType}
            label="Camera"
            testID="attachment-source-camera"
            onPress={onTakePhoto}
          />
          <AttachmentSourceButton
            accessibilityLabel="Choose a photo"
            colors={colors}
            icon={CHAT_COMPOSER_ICONS.photos as ImageSourcePropType}
            label="Photos"
            testID="attachment-source-photos"
            onPress={onPickImage}
          />
          <AttachmentSourceButton
            accessibilityLabel="Choose a text file"
            colors={colors}
            icon={CHAT_COMPOSER_ICONS.paperclip as ImageSourcePropType}
            label="Files"
            testID="attachment-source-files"
            onPress={onPickFile}
          />
        </Row>
      </ModalBottomSheet>
    </Host>
  );
}

function AttachmentSourceButton({
  accessibilityLabel,
  colors,
  icon,
  label,
  onPress,
  testID,
}: {
  accessibilityLabel: string;
  colors: ComposerColors;
  icon: ImageSourcePropType;
  label: string;
  onPress(): void;
  testID: string;
}) {
  return (
    <FilledTonalButton
      colors={{
        containerColor: colors.muted,
        contentColor: colors.foreground,
      }}
      contentPadding={{ bottom: 8, end: 8, start: 8, top: 8 }}
      shape={Shape.RoundedCorner({
        cornerRadii: {
          bottomEnd: 16,
          bottomStart: 16,
          topEnd: 16,
          topStart: 16,
        },
      })}
      modifiers={[width(96), height(84), testIDModifier(testID)]}
      onClick={onPress}>
      <Column
        horizontalAlignment="center"
        verticalArrangement={{ spacedBy: 8 }}>
        <Icon
          contentDescription={accessibilityLabel}
          source={icon}
          size={22}
          tint={colors.foreground}
        />
        <Text
          color={colors.foreground}
          style={{ fontSize: 13, fontWeight: '500' }}>
          {label}
        </Text>
      </Column>
    </FilledTonalButton>
  );
}

export function ModelPickerSheet({ colors, model }: ModelPickerSheetProps) {
  const [effortMenuOpen, setEffortMenuOpen] = useState(false);
  if (!model.open) return null;

  return (
    <Host pointerEvents="none" style={{ position: 'absolute' }}>
      <ModalBottomSheet
        contentColor={colors.foreground}
        containerColor={colors.background}
        initialFullyExpanded={false}
        showDragHandle
        skipPartiallyExpanded={false}
        sheetGesturesEnabled
        modifiers={[testIDModifier('chat-model-sheet')]}
        onDismissRequest={model.closePicker}>
        <LazyColumn
          contentPadding={{ bottom: 24, end: 16, start: 16, top: 4 }}
          horizontalAlignment="start"
          verticalArrangement={{ spacedBy: 2 }}
          modifiers={[fillMaxWidth()]}>
          <Text
            color={colors.foreground}
            style={{ fontSize: 20, fontWeight: '700' }}
            modifiers={[
              padding(8, 0, 8, 8),
              testIDModifier('chat-model-picker'),
            ]}>
            Model for this chat
          </Text>
          {model.isLoading ? (
            <SheetMessage
              colors={colors}
              testID="chat-model-loading"
              text="Loading models…"
            />
          ) : model.isInitialError ? (
            <SheetMessage
              colors={colors}
              destructive
              testID="chat-model-initial-error"
              text="Wave could not load the model list. Close and try again."
            />
          ) : model.catalog ? (
            <>
              {model.showReasoning ? (
                <SwitchRow
                  disabled={model.busyControl !== undefined}
                  label="Thinking"
                  testID="chat-model-thinking"
                  value={model.thinkingEnabled}
                  onValueChange={model.setThinking}
                />
              ) : null}
              {model.showFast ? (
                <SwitchRow
                  disabled={model.busyControl !== undefined}
                  label="Fast mode"
                  testID="chat-model-fast"
                  value={model.fastEnabled}
                  onValueChange={model.setFastMode}
                />
              ) : null}
              {model.showReasoning && model.thinkingEnabled ? (
                <Row
                  verticalAlignment="center"
                  modifiers={[
                    fillMaxWidth(),
                    padding(8, 6, 8, 6),
                    testIDModifier('chat-model-reasoning-row'),
                  ]}>
                  <Text
                    color={colors.foreground}
                    style={{ fontSize: 14, fontWeight: '600' }}>
                    Effort
                  </Text>
                  <Spacer modifiers={[weight(1)]} />
                  <DropdownMenu
                    color={colors.card}
                    expanded={effortMenuOpen}
                    onDismissRequest={() => setEffortMenuOpen(false)}>
                    <DropdownMenu.Trigger>
                      <TextButton
                        enabled={model.busyControl === undefined}
                        colors={{ contentColor: colors.foreground }}
                        modifiers={[testIDModifier('chat-model-reasoning')]}
                        onClick={() => setEffortMenuOpen(true)}>
                        <Text
                          color={colors.foreground}
                          style={{ fontSize: 14 }}>
                          {MODEL_EFFORT_LABELS[model.selectedReasoning]}
                        </Text>
                      </TextButton>
                    </DropdownMenu.Trigger>
                    <DropdownMenu.Items>
                      {model.reasoningEfforts.map((effort) => (
                        <DropdownMenuItem
                          key={effort}
                          elementColors={{ textColor: colors.foreground }}
                          onClick={() => {
                            setEffortMenuOpen(false);
                            model.setReasoning(effort);
                          }}>
                          <DropdownMenuItem.Text>
                            <Text color={colors.foreground}>
                              {MODEL_EFFORT_LABELS[effort]}
                            </Text>
                          </DropdownMenuItem.Text>
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenu.Items>
                  </DropdownMenu>
                </Row>
              ) : null}
              <Row
                verticalAlignment="center"
                modifiers={[fillMaxWidth(), padding(8, 6, 8, 6)]}>
                <Text
                  color={colors.mutedForeground}
                  style={{ fontSize: 12, fontWeight: '600' }}>
                  Models
                </Text>
                <Spacer modifiers={[weight(1)]} />
                <TextButton
                  enabled={!model.refreshing}
                  colors={{ contentColor: colors.foreground }}
                  contentPadding={{ bottom: 0, end: 8, start: 8, top: 0 }}
                  modifiers={[height(36), testIDModifier('chat-model-refresh')]}
                  onClick={() => void model.refreshModels()}>
                  <Row
                    verticalAlignment="center"
                    horizontalArrangement={{ spacedBy: 5 }}>
                    <Icon
                      contentDescription="Refresh"
                      source={
                        CHAT_COMPOSER_ICONS.refresh as ImageSourcePropType
                      }
                      size={15}
                      tint={colors.foreground}
                    />
                    <Text color={colors.foreground} style={{ fontSize: 13 }}>
                      {model.refreshing ? 'Refreshing…' : 'Refresh'}
                    </Text>
                  </Row>
                </TextButton>
              </Row>
              {model.catalog.providers.length === 0 ? (
                <SheetMessage
                  colors={colors}
                  testID="chat-model-empty"
                  text="This server lists no switchable models."
                />
              ) : (
                model.catalog.providers.flatMap((provider) => [
                  <Text
                    key={`${provider.slug}-header`}
                    color={colors.mutedForeground}
                    style={{ fontSize: 12, fontWeight: '600' }}
                    modifiers={[padding(8, 10, 8, 0)]}>
                    {provider.name}
                  </Text>,
                  ...modelFamilies(provider.models).map((family) => {
                    const option = family.option;
                    const selected =
                      provider.current &&
                      (option.id === model.catalog?.currentModel ||
                        family.fastVariant?.id === model.catalog?.currentModel);
                    const description = modelOptionDescription(option);
                    const testID = `chat-model-${provider.slug}-${option.id}`;
                    return (
                      <TextButton
                        key={`${provider.slug}-${option.id}`}
                        enabled={!option.unavailable && !model.busyModel}
                        colors={{ contentColor: colors.foreground }}
                        contentPadding={{
                          bottom: 8,
                          end: 10,
                          start: 10,
                          top: 8,
                        }}
                        modifiers={[
                          fillMaxWidth(),
                          alpha(option.unavailable ? 0.45 : 1),
                          testIDModifier(testID),
                        ]}
                        onClick={() => {
                          if (selected) {
                            model.closePicker();
                            return;
                          }
                          void model.select({
                            model: option.id,
                            provider: provider.slug,
                          });
                        }}>
                        <Row
                          verticalAlignment="center"
                          modifiers={[fillMaxWidth()]}>
                          <Column
                            horizontalAlignment="start"
                            verticalArrangement={{ spacedBy: 2 }}>
                            <Text
                              color={colors.foreground}
                              maxLines={1}
                              overflow="ellipsis"
                              style={{ fontSize: 14, fontWeight: '500' }}>
                              {displayModelName(option.id)}
                            </Text>
                            {description ? (
                              <Text
                                color={colors.mutedForeground}
                                maxLines={1}
                                overflow="ellipsis"
                                style={{ fontSize: 12 }}>
                                {description}
                              </Text>
                            ) : null}
                          </Column>
                          <Spacer modifiers={[weight(1)]} />
                          {model.busyModel === option.id ? (
                            <Text
                              color={colors.mutedForeground}
                              style={{ fontSize: 12 }}>
                              Switching…
                            </Text>
                          ) : selected ? (
                            <Icon
                              contentDescription="Selected"
                              source={
                                CHAT_COMPOSER_ICONS.check as ImageSourcePropType
                              }
                              size={18}
                              tint={colors.primary}
                            />
                          ) : null}
                        </Row>
                      </TextButton>
                    );
                  }),
                ])
              )}
            </>
          ) : null}
          {model.error ? (
            <SheetMessage
              colors={colors}
              destructive
              testID="chat-model-error"
              text={model.error}
            />
          ) : null}
        </LazyColumn>
      </ModalBottomSheet>
    </Host>
  );
}

function SwitchRow({
  disabled,
  label,
  onValueChange,
  testID,
  value,
}: {
  disabled: boolean;
  label: string;
  onValueChange(value: boolean): void;
  testID: string;
  value: boolean;
}) {
  return (
    <Row
      verticalAlignment="center"
      modifiers={[fillMaxWidth(), padding(8, 6, 8, 6)]}>
      <Text style={{ fontSize: 14 }}>{label}</Text>
      <Spacer modifiers={[weight(1)]} />
      <Switch
        enabled={!disabled}
        value={value}
        modifiers={[testIDModifier(testID)]}
        onCheckedChange={onValueChange}
      />
    </Row>
  );
}

function SheetMessage({
  colors,
  destructive,
  testID,
  text,
}: {
  colors: ComposerColors;
  destructive?: boolean;
  testID: string;
  text: string;
}) {
  return (
    <Text
      color={destructive ? colors.destructive : colors.mutedForeground}
      style={{ fontSize: 12, textAlign: 'center' }}
      modifiers={[
        fillMaxWidth(),
        padding(8, destructive ? 6 : 2, 8, destructive ? 6 : 2),
        testIDModifier(testID),
      ]}>
      {text}
    </Text>
  );
}
