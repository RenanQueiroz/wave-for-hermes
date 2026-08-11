import {
  BottomSheet,
  Button,
  Group,
  Host,
  HStack,
  Image,
  Picker,
  ScrollView,
  Spacer,
  Text,
  Toggle,
  VStack,
} from '@expo/ui/swift-ui';
import {
  accessibilityIdentifier,
  accessibilityLabel,
  background,
  buttonStyle,
  disabled,
  font,
  foregroundStyle,
  frame,
  lineLimit,
  opacity,
  padding,
  pickerStyle,
  presentationDetents,
  presentationDragIndicator,
  shapes,
  tag,
} from '@expo/ui/swift-ui/modifiers';
import type { SFSymbol } from 'sf-symbols-typescript';

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
  return (
    <Host pointerEvents="none" style={{ position: 'absolute' }}>
      <BottomSheet
        fitToContents
        isPresented={isPresented}
        onDismiss={onDismiss}
        onIsPresentedChange={(presented) => {
          if (!presented) onDismiss();
        }}>
        <Group modifiers={[presentationDragIndicator('visible')]}>
          <HStack
            alignment="center"
            spacing={8}
            modifiers={[
              frame({ maxWidth: Infinity }),
              padding({ bottom: 24, horizontal: 16, top: 8 }),
            ]}>
            <AttachmentSourceButton
              accessibilityLabel="Take a photo"
              colors={colors}
              icon={CHAT_COMPOSER_ICONS.camera}
              label="Camera"
              testID="attachment-source-camera"
              onPress={onTakePhoto}
            />
            <Spacer />
            <AttachmentSourceButton
              accessibilityLabel="Choose a photo"
              colors={colors}
              icon={CHAT_COMPOSER_ICONS.photos}
              label="Photos"
              testID="attachment-source-photos"
              onPress={onPickImage}
            />
            <Spacer />
            <AttachmentSourceButton
              accessibilityLabel="Choose a text file"
              colors={colors}
              icon={CHAT_COMPOSER_ICONS.paperclip}
              label="Files"
              testID="attachment-source-files"
              onPress={onPickFile}
            />
          </HStack>
        </Group>
      </BottomSheet>
    </Host>
  );
}

function AttachmentSourceButton({
  accessibilityLabel: label,
  colors,
  icon,
  label: value,
  onPress,
  testID,
}: {
  accessibilityLabel: string;
  colors: ComposerColors;
  icon: SFSymbol;
  label: string;
  onPress(): void;
  testID: string;
}) {
  return (
    <Button
      onPress={onPress}
      modifiers={[
        buttonStyle('plain'),
        frame({ height: 84, width: 96 }),
        background(
          colors.muted,
          shapes.roundedRectangle({
            cornerRadius: 16,
            roundedCornerStyle: 'continuous',
          }),
        ),
        accessibilityLabel(label),
        accessibilityIdentifier(testID),
      ]}>
      <VStack alignment="center" spacing={8}>
        <Image color={colors.foreground} size={22} systemName={icon} />
        <Text
          modifiers={[
            foregroundStyle(colors.foreground),
            font({ size: 13, weight: 'medium' }),
          ]}>
          {value}
        </Text>
      </VStack>
    </Button>
  );
}

export function ModelPickerSheet({ colors, model }: ModelPickerSheetProps) {
  return (
    <Host pointerEvents="none" style={{ position: 'absolute' }}>
      <BottomSheet
        isPresented={model.open}
        onDismiss={model.closePicker}
        onIsPresentedChange={(presented) => {
          if (!presented) model.closePicker();
        }}>
        <Group
          modifiers={[
            presentationDetents(['medium', 'large']),
            presentationDragIndicator('visible'),
          ]}>
          <ScrollView showsIndicators>
            <VStack
              alignment="leading"
              spacing={2}
              modifiers={[
                frame({ alignment: 'leading', maxWidth: Infinity }),
                padding({ bottom: 24, horizontal: 16, top: 4 }),
              ]}>
              <Text
                modifiers={[
                  foregroundStyle(colors.foreground),
                  font({ size: 20, weight: 'bold' }),
                  padding({ bottom: 8, horizontal: 8 }),
                  accessibilityIdentifier('chat-model-picker'),
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
                    <Toggle
                      isOn={model.thinkingEnabled}
                      label="Thinking"
                      modifiers={[
                        padding({ horizontal: 8, vertical: 6 }),
                        accessibilityIdentifier('chat-model-thinking'),
                        disabled(model.busyControl !== undefined),
                      ]}
                      onIsOnChange={model.setThinking}
                    />
                  ) : null}
                  {model.showFast ? (
                    <Toggle
                      isOn={model.fastEnabled}
                      label="Fast mode"
                      modifiers={[
                        padding({ horizontal: 8, vertical: 6 }),
                        accessibilityIdentifier('chat-model-fast'),
                        disabled(model.busyControl !== undefined),
                      ]}
                      onIsOnChange={model.setFastMode}
                    />
                  ) : null}
                  {model.showReasoning && model.thinkingEnabled ? (
                    <Picker
                      label="Effort"
                      selection={model.selectedReasoning}
                      modifiers={[
                        pickerStyle('menu'),
                        padding({ horizontal: 8, vertical: 6 }),
                        accessibilityIdentifier('chat-model-reasoning'),
                        disabled(model.busyControl !== undefined),
                      ]}
                      onSelectionChange={model.setReasoning}>
                      {model.reasoningEfforts.map((effort) => (
                        <Text key={effort} modifiers={[tag(effort)]}>
                          {MODEL_EFFORT_LABELS[effort]}
                        </Text>
                      ))}
                    </Picker>
                  ) : null}
                  <HStack
                    alignment="center"
                    spacing={8}
                    modifiers={[
                      frame({ maxWidth: Infinity }),
                      padding({ horizontal: 8, vertical: 6 }),
                    ]}>
                    <Text
                      modifiers={[
                        foregroundStyle(colors.mutedForeground),
                        font({ size: 12, weight: 'semibold' }),
                      ]}>
                      Models
                    </Text>
                    <Spacer />
                    <Button
                      onPress={() => void model.refreshModels()}
                      modifiers={[
                        buttonStyle('plain'),
                        frame({ height: 36 }),
                        padding({ horizontal: 8 }),
                        accessibilityLabel('Refresh the model list'),
                        accessibilityIdentifier('chat-model-refresh'),
                        disabled(model.refreshing),
                      ]}>
                      <HStack alignment="center" spacing={5}>
                        <Image
                          color={colors.foreground}
                          size={15}
                          systemName={CHAT_COMPOSER_ICONS.refresh}
                        />
                        <Text
                          modifiers={[
                            foregroundStyle(colors.foreground),
                            font({ size: 13 }),
                          ]}>
                          {model.refreshing ? 'Refreshing…' : 'Refresh'}
                        </Text>
                      </HStack>
                    </Button>
                  </HStack>
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
                        modifiers={[
                          foregroundStyle(colors.mutedForeground),
                          font({ size: 12, weight: 'semibold' }),
                          padding({ horizontal: 8, top: 10 }),
                        ]}>
                        {provider.name}
                      </Text>,
                      ...modelFamilies(provider.models).map((family) => {
                        const option = family.option;
                        const selected =
                          provider.current &&
                          (option.id === model.catalog?.currentModel ||
                            family.fastVariant?.id ===
                              model.catalog?.currentModel);
                        const description = modelOptionDescription(option);
                        const testID = `chat-model-${provider.slug}-${option.id}`;
                        return (
                          <Button
                            key={`${provider.slug}-${option.id}`}
                            onPress={() => {
                              if (selected) {
                                model.closePicker();
                                return;
                              }
                              void model.select({
                                model: option.id,
                                provider: provider.slug,
                              });
                            }}
                            modifiers={[
                              buttonStyle('plain'),
                              frame({
                                alignment: 'leading',
                                maxWidth: Infinity,
                              }),
                              padding({ horizontal: 10, vertical: 8 }),
                              opacity(option.unavailable ? 0.45 : 1),
                              accessibilityLabel(`Use model ${option.id}`),
                              accessibilityIdentifier(testID),
                              disabled(
                                option.unavailable || Boolean(model.busyModel),
                              ),
                            ]}>
                            <HStack
                              alignment="center"
                              spacing={8}
                              modifiers={[frame({ maxWidth: Infinity })]}>
                              <VStack alignment="leading" spacing={2}>
                                <Text
                                  modifiers={[
                                    foregroundStyle(colors.foreground),
                                    font({ size: 14, weight: 'medium' }),
                                    lineLimit(1),
                                  ]}>
                                  {displayModelName(option.id)}
                                </Text>
                                {description ? (
                                  <Text
                                    modifiers={[
                                      foregroundStyle(colors.mutedForeground),
                                      font({ size: 12 }),
                                      lineLimit(1),
                                    ]}>
                                    {description}
                                  </Text>
                                ) : null}
                              </VStack>
                              <Spacer />
                              {model.busyModel === option.id ? (
                                <Text
                                  modifiers={[
                                    foregroundStyle(colors.mutedForeground),
                                    font({ size: 12 }),
                                  ]}>
                                  Switching…
                                </Text>
                              ) : selected ? (
                                <Image
                                  color={colors.primary}
                                  size={18}
                                  systemName={CHAT_COMPOSER_ICONS.check}
                                />
                              ) : null}
                            </HStack>
                          </Button>
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
            </VStack>
          </ScrollView>
        </Group>
      </BottomSheet>
    </Host>
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
      modifiers={[
        frame({ alignment: 'center', maxWidth: Infinity }),
        foregroundStyle(
          destructive ? colors.destructive : colors.mutedForeground,
        ),
        font({ size: 12 }),
        padding({ horizontal: 8, vertical: destructive ? 6 : 2 }),
        accessibilityIdentifier(testID),
      ]}>
      {text}
    </Text>
  );
}
