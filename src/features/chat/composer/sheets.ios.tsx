import {
  BottomSheet,
  Button,
  Group,
  Host,
  HStack,
  Image,
  List,
  Picker,
  ProgressView,
  Section,
  Spacer,
  Text,
  Toggle,
  VStack,
} from '@expo/ui/swift-ui';
import {
  accessibilityIdentifier,
  accessibilityLabel,
  buttonStyle,
  disabled,
  font,
  foregroundStyle,
  frame,
  lineLimit,
  listRowBackground,
  listStyle,
  opacity,
  padding,
  pickerStyle,
  presentationBackground,
  presentationDetents,
  presentationDragIndicator,
  scrollContentBackground,
  tag,
} from '@expo/ui/swift-ui/modifiers';

import { CHAT_COMPOSER_ICONS } from '@/features/chat/composer/icons';
import {
  MODEL_EFFORT_LABELS,
  modelOptionDescription,
} from '@/features/chat/composer/model/picker';
import type { ModelPickerSheetProps } from '@/features/chat/composer/sheets.types';
import { displayModelName } from '@/features/chat/composer/state';
import type { ComposerColors } from '@/features/chat/composer/view.types';
import { modelFamilies } from '@/services/gateway/gateway-models';

export function ModelPickerSheet({
  colorScheme,
  colors,
  model,
}: ModelPickerSheetProps) {
  return (
    <Host
      colorScheme={colorScheme}
      pointerEvents="none"
      seedColor={colors.primary}
      style={{ position: 'absolute' }}>
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
            // Solid app-theme surface: the default sheet material is
            // translucent and lets the composer behind bleed through.
            presentationBackground(colors.background),
          ]}>
          <VStack spacing={0} modifiers={[frame({ maxWidth: Infinity })]}>
            <HStack
              alignment="center"
              spacing={8}
              modifiers={[
                frame({ maxWidth: Infinity }),
                // Enough headroom that the drag indicator never overlays
                // the title's ascenders.
                padding({ bottom: 2, horizontal: 20, top: 18 }),
              ]}>
              <Text
                modifiers={[
                  foregroundStyle(colors.foreground),
                  font({ size: 20, weight: 'bold' }),
                  accessibilityIdentifier('chat-model-picker'),
                ]}>
                Model for this chat
              </Text>
              <Spacer />
              <Button
                onPress={() => void model.refreshModels()}
                modifiers={[
                  buttonStyle('plain'),
                  frame({ height: 32, width: 32 }),
                  accessibilityLabel('Refresh the model list'),
                  accessibilityIdentifier('chat-model-refresh'),
                  disabled(model.refreshing),
                ]}>
                {model.refreshing ? (
                  <ProgressView
                    modifiers={[frame({ height: 17, width: 17 })]}
                  />
                ) : (
                  <Image
                    color={colors.mutedForeground}
                    size={17}
                    systemName={CHAT_COMPOSER_ICONS.refresh}
                  />
                )}
              </Button>
            </HStack>
            <List
              modifiers={[
                listStyle('insetGrouped'),
                scrollContentBackground('hidden'),
              ]}>
              {model.isLoading ? (
                <Section>
                  <HStack
                    alignment="center"
                    spacing={8}
                    modifiers={[listRowBackground(colors.card)]}>
                    <ProgressView
                      modifiers={[frame({ height: 16, width: 16 })]}
                    />
                    <Text
                      modifiers={[
                        foregroundStyle(colors.mutedForeground),
                        font({ size: 15 }),
                        accessibilityIdentifier('chat-model-loading'),
                      ]}>
                      Loading models…
                    </Text>
                  </HStack>
                </Section>
              ) : model.isInitialError ? (
                <SheetMessage
                  colors={colors}
                  destructive
                  testID="chat-model-initial-error"
                  text="Wave could not load the model list. Close and try again."
                />
              ) : model.catalog ? (
                <>
                  {model.showReasoning || model.showFast ? (
                    <Section>
                      {model.showReasoning ? (
                        <Toggle
                          isOn={model.thinkingEnabled}
                          label="Thinking"
                          modifiers={[
                            listRowBackground(colors.card),
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
                            listRowBackground(colors.card),
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
                            listRowBackground(colors.card),
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
                    </Section>
                  ) : null}
                  {model.catalog.providers.length === 0 ? (
                    <SheetMessage
                      colors={colors}
                      testID="chat-model-empty"
                      text="This server lists no switchable models."
                    />
                  ) : (
                    model.catalog.providers.map((provider) => (
                      <Section key={provider.slug} title={provider.name}>
                        {modelFamilies(provider.models).map((family) => {
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
                                listRowBackground(colors.card),
                                opacity(option.unavailable ? 0.45 : 1),
                                accessibilityLabel(`Use model ${option.id}`),
                                accessibilityIdentifier(testID),
                                disabled(
                                  option.unavailable ||
                                    Boolean(model.busyModel),
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
                                      font({ size: 16 }),
                                      lineLimit(1),
                                    ]}>
                                    {displayModelName(option.id)}
                                  </Text>
                                  {description ? (
                                    <Text
                                      modifiers={[
                                        foregroundStyle(colors.mutedForeground),
                                        font({ size: 13 }),
                                        lineLimit(1),
                                      ]}>
                                      {description}
                                    </Text>
                                  ) : null}
                                </VStack>
                                <Spacer />
                                {model.busyModel === option.id ? (
                                  <ProgressView
                                    modifiers={[
                                      frame({ height: 18, width: 18 }),
                                    ]}
                                  />
                                ) : selected ? (
                                  <Image
                                    color={colors.primary}
                                    size={17}
                                    systemName={CHAT_COMPOSER_ICONS.check}
                                  />
                                ) : null}
                              </HStack>
                            </Button>
                          );
                        })}
                      </Section>
                    ))
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
            </List>
          </VStack>
        </Group>
      </BottomSheet>
    </Host>
  );
}

/** A bordered informational or destructive list row. */
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
    <Section>
      <Text
        modifiers={[
          frame({ alignment: 'leading', maxWidth: Infinity }),
          listRowBackground(colors.card),
          foregroundStyle(
            destructive ? colors.destructive : colors.mutedForeground,
          ),
          font({ size: 14 }),
          accessibilityIdentifier(testID),
        ]}>
        {text}
      </Text>
    </Section>
  );
}
