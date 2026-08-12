import {
  CircularProgressIndicator,
  Column,
  DropdownMenu,
  DropdownMenuItem,
  Host,
  Icon,
  IconButton,
  ListItem,
  ModalBottomSheet,
  Row,
  Spacer,
  Switch,
  Text,
  type SwitchColors,
} from '@expo/ui/jetpack-compose';
import {
  Shapes,
  alpha,
  clickable,
  clip,
  fillMaxWidth,
  padding,
  selectable,
  size,
  testID as testIDModifier,
  toggleable,
  verticalScroll,
  weight,
} from '@expo/ui/jetpack-compose/modifiers';
import { useState, type ReactElement, type ReactNode } from 'react';
import type { ImageSourcePropType } from 'react-native';
import { useCSSVariable } from 'uniwind';

import { useTheme } from '@/hooks/use-theme';
import {
  useWaveMaterialColors,
  waveSwitchColors,
} from '@/hooks/use-wave-material-colors';

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
  const [effortMenuOpen, setEffortMenuOpen] = useState(false);
  const rowSurface = useSheetRowSurface();
  const nativeColors = useWaveMaterialColors({ colorScheme });
  if (!model.open) return null;

  const rowPalette = sheetRowPalette(colors, rowSurface);

  return (
    <Host
      colorScheme={colorScheme}
      pointerEvents="none"
      seedColor={colors.primary}
      style={{ position: 'absolute' }}>
      <ModalBottomSheet
        contentColor={colors.foreground}
        containerColor={colors.background}
        initialFullyExpanded={false}
        showDragHandle
        skipPartiallyExpanded={false}
        sheetGesturesEnabled
        modifiers={[testIDModifier('chat-model-sheet')]}
        onDismissRequest={model.closePicker}>
        {/* A plain scrollable Column: LazyColumn inside ModalBottomSheet
            swallows every pointer event before it reaches JS (device-verified
            on Pixel 8 Pro), and the model catalog is bounded anyway. */}
        <Column
          horizontalAlignment="start"
          verticalArrangement={{ spacedBy: 0 }}
          modifiers={[
            fillMaxWidth(),
            verticalScroll(),
            padding(16, 0, 16, 24),
          ]}>
          <Row
            verticalAlignment="center"
            modifiers={[fillMaxWidth(), padding(4, 0, 0, 8)]}>
            <Text
              color={colors.foreground}
              style={{ typography: 'titleLarge' }}
              modifiers={[testIDModifier('chat-model-picker')]}>
              Model for this chat
            </Text>
            <Spacer modifiers={[weight(1)]} />
            {model.refreshing ? (
              <Row
                verticalAlignment="center"
                modifiers={[size(40, 40), padding(11, 11, 11, 11)]}>
                <CircularProgressIndicator
                  color={colors.mutedForeground}
                  strokeWidth={2}
                  modifiers={[size(18, 18)]}
                />
              </Row>
            ) : (
              <IconButton
                colors={{ contentColor: colors.mutedForeground }}
                modifiers={[size(40, 40), testIDModifier('chat-model-refresh')]}
                onClick={() => void model.refreshModels()}>
                <Icon
                  contentDescription="Refresh the model list"
                  source={CHAT_COMPOSER_ICONS.refresh as ImageSourcePropType}
                  size={18}
                  tint={colors.mutedForeground}
                />
              </IconButton>
            )}
          </Row>
          {model.isLoading ? (
            <Row
              verticalAlignment="center"
              horizontalArrangement={{ spacedBy: 8 }}
              modifiers={[fillMaxWidth(), padding(4, 8, 4, 8)]}>
              <CircularProgressIndicator
                color={colors.mutedForeground}
                strokeWidth={2}
                modifiers={[size(16, 16)]}
              />
              <Text
                color={colors.mutedForeground}
                style={{ typography: 'bodyMedium' }}
                modifiers={[testIDModifier('chat-model-loading')]}>
                Loading models…
              </Text>
            </Row>
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
                <Column
                  verticalArrangement={{ spacedBy: SHEET_ROW_SEGMENT_GAP }}
                  modifiers={[fillMaxWidth(), padding(0, 0, 0, 12)]}>
                  {[
                    model.showReasoning ? (
                      <SheetSwitchRow
                        controlColors={waveSwitchColors(nativeColors)}
                        key="thinking"
                        disabled={model.busyControl !== undefined}
                        label="Thinking"
                        labelColor={colors.foreground}
                        palette={rowPalette}
                        testID="chat-model-thinking"
                        value={model.thinkingEnabled}
                        onValueChange={model.setThinking}
                      />
                    ) : null,
                    model.showFast ? (
                      <SheetSwitchRow
                        controlColors={waveSwitchColors(nativeColors)}
                        key="fast"
                        disabled={model.busyControl !== undefined}
                        label="Fast mode"
                        labelColor={colors.foreground}
                        palette={rowPalette}
                        testID="chat-model-fast"
                        value={model.fastEnabled}
                        onValueChange={model.setFastMode}
                      />
                    ) : null,
                    model.showReasoning && model.thinkingEnabled ? (
                      <ListItem
                        key="effort"
                        colors={rowPalette}
                        modifiers={[
                          fillMaxWidth(),
                          ...(model.busyControl === undefined
                            ? [clickable(() => setEffortMenuOpen(true))]
                            : []),
                          testIDModifier('chat-model-reasoning-row'),
                        ]}>
                        <ListItem.HeadlineContent>
                          <Text
                            color={colors.foreground}
                            style={{ typography: 'titleMedium' }}
                            modifiers={[padding(4, 8, 0, 8)]}>
                            Effort
                          </Text>
                        </ListItem.HeadlineContent>
                        <ListItem.TrailingContent>
                          <DropdownMenu
                            color={colors.card}
                            expanded={effortMenuOpen}
                            onDismissRequest={() => setEffortMenuOpen(false)}>
                            <DropdownMenu.Trigger>
                              <Row
                                verticalAlignment="center"
                                modifiers={[
                                  padding(0, 8, 4, 8),
                                  testIDModifier('chat-model-reasoning'),
                                ]}>
                                <Text
                                  color={colors.mutedForeground}
                                  style={{ typography: 'bodyLarge' }}>
                                  {MODEL_EFFORT_LABELS[model.selectedReasoning]}
                                </Text>
                              </Row>
                            </DropdownMenu.Trigger>
                            <DropdownMenu.Items>
                              {model.reasoningEfforts.map((effort) => (
                                <DropdownMenuItem
                                  key={effort}
                                  elementColors={{
                                    textColor: colors.foreground,
                                  }}
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
                        </ListItem.TrailingContent>
                      </ListItem>
                    ) : null,
                  ]
                    .filter((row): row is ReactElement => row !== null)
                    .map((row, index, rows) =>
                      positionSheetRow(row, index, rows.length),
                    )}
                </Column>
              ) : null}
              {model.catalog.providers.length === 0 ? (
                <SheetMessage
                  colors={colors}
                  testID="chat-model-empty"
                  text="This server lists no switchable models."
                />
              ) : (
                model.catalog.providers.map((provider) => {
                  const families = modelFamilies(provider.models);
                  return (
                    <Column
                      key={provider.slug}
                      verticalArrangement={{ spacedBy: SHEET_ROW_SEGMENT_GAP }}
                      modifiers={[fillMaxWidth(), padding(0, 0, 0, 12)]}>
                      <Text
                        color={colors.mutedForeground}
                        style={{ typography: 'labelMedium' }}
                        modifiers={[padding(16, 2, 16, 6)]}>
                        {provider.name}
                      </Text>
                      {families.map((family, index) => {
                        const option = family.option;
                        const selected = Boolean(
                          provider.current &&
                          (option.id === model.catalog?.currentModel ||
                            family.fastVariant?.id ===
                              model.catalog?.currentModel),
                        );
                        const description = modelOptionDescription(option);
                        const testID = `chat-model-${provider.slug}-${option.id}`;
                        const interactive =
                          !option.unavailable && !model.busyModel;
                        return (
                          <ListItem
                            key={`${provider.slug}-${option.id}`}
                            colors={rowPalette}
                            modifiers={[
                              fillMaxWidth(),
                              clip(
                                sheetRowShape(
                                  rowPosition(index, families.length),
                                ),
                              ),
                              alpha(option.unavailable ? 0.45 : 1),
                              ...(interactive
                                ? [
                                    selectable(
                                      selected,
                                      () => {
                                        if (selected) {
                                          model.closePicker();
                                          return;
                                        }
                                        void model.select({
                                          model: option.id,
                                          provider: provider.slug,
                                        });
                                      },
                                      'radioButton',
                                    ),
                                  ]
                                : []),
                              testIDModifier(testID),
                            ]}>
                            <ListItem.HeadlineContent>
                              <Column
                                verticalArrangement={{ spacedBy: 2 }}
                                modifiers={[padding(4, 8, 0, 8)]}>
                                <Text
                                  color={colors.foreground}
                                  maxLines={1}
                                  overflow="ellipsis"
                                  style={{ typography: 'titleMedium' }}>
                                  {displayModelName(option.id)}
                                </Text>
                                {description ? (
                                  <Text
                                    color={colors.mutedForeground}
                                    maxLines={1}
                                    overflow="ellipsis"
                                    style={{ typography: 'bodyMedium' }}>
                                    {description}
                                  </Text>
                                ) : null}
                              </Column>
                            </ListItem.HeadlineContent>
                            <ListItem.TrailingContent>
                              <Row modifiers={[padding(0, 0, 4, 0)]}>
                                {model.busyModel === option.id ? (
                                  <CircularProgressIndicator
                                    color={colors.mutedForeground}
                                    strokeWidth={2}
                                    modifiers={[size(20, 20)]}
                                  />
                                ) : option.unavailable ? (
                                  <Row modifiers={[size(20, 20)]} />
                                ) : (
                                  <Icon
                                    contentDescription={
                                      selected
                                        ? 'Selected model'
                                        : 'Unselected model'
                                    }
                                    size={24}
                                    source={
                                      selected
                                        ? (require('@expo/material-symbols/radio_button_checked.xml') as ImageSourcePropType)
                                        : (require('@expo/material-symbols/radio_button_unchecked.xml') as ImageSourcePropType)
                                    }
                                    tint={
                                      selected
                                        ? colors.primary
                                        : colors.mutedForeground
                                    }
                                  />
                                )}
                              </Row>
                            </ListItem.TrailingContent>
                          </ListItem>
                        );
                      })}
                    </Column>
                  );
                })
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
        </Column>
      </ModalBottomSheet>
    </Host>
  );
}

type SheetRowPosition = 'first' | 'last' | 'middle' | 'only';
type SheetRowPalette = NonNullable<Parameters<typeof ListItem>[0]['colors']>;

// Mirrors the validated Android settings-row language
// (settings-list-item.android.tsx): segmented rounded corners, a 2dp gap,
// and rows on the shared PanelUI surface token instead of the page background.
const SHEET_ROW_INNER_CORNER_RADIUS = 4;
const SHEET_ROW_OUTER_CORNER_RADIUS = 16;
const SHEET_ROW_SEGMENT_GAP = 2;
const SHEET_ROW_SURFACE_TOKEN = '--color-surface-tertiary';

function useSheetRowSurface(): string {
  const theme = useTheme();
  const [surface] = useCSSVariable([SHEET_ROW_SURFACE_TOKEN]);
  return typeof surface === 'string' ? surface : theme.backgroundElement;
}

function sheetRowPalette(
  colors: ComposerColors,
  surface: string,
): SheetRowPalette {
  return {
    containerColor: surface,
    contentColor: colors.foreground,
    leadingContentColor: colors.mutedForeground,
    overlineContentColor: colors.mutedForeground,
    supportingContentColor: colors.mutedForeground,
    trailingContentColor: colors.mutedForeground,
  };
}

function rowPosition(index: number, count: number): SheetRowPosition {
  if (count === 1) return 'only';
  if (index === 0) return 'first';
  if (index === count - 1) return 'last';
  return 'middle';
}

function sheetRowShape(position: SheetRowPosition) {
  const topRadius =
    position === 'first' || position === 'only'
      ? SHEET_ROW_OUTER_CORNER_RADIUS
      : SHEET_ROW_INNER_CORNER_RADIUS;
  const bottomRadius =
    position === 'last' || position === 'only'
      ? SHEET_ROW_OUTER_CORNER_RADIUS
      : SHEET_ROW_INNER_CORNER_RADIUS;

  return Shapes.RoundedCorner({
    bottomEnd: bottomRadius,
    bottomStart: bottomRadius,
    topEnd: topRadius,
    topStart: topRadius,
  });
}

/** Re-key a control-group row with its segment shape once siblings are known. */
function positionSheetRow(
  row: ReactElement,
  index: number,
  count: number,
): ReactNode {
  return (
    <Column
      key={`sheet-row-${index}`}
      modifiers={[
        fillMaxWidth(),
        clip(sheetRowShape(rowPosition(index, count))),
      ]}>
      {row}
    </Column>
  );
}

function SheetSwitchRow({
  controlColors,
  disabled,
  label,
  labelColor,
  palette,
  testID,
  value,
  onValueChange,
}: {
  controlColors: SwitchColors;
  disabled: boolean;
  label: string;
  labelColor: string;
  palette: SheetRowPalette;
  testID: string;
  value: boolean;
  onValueChange(value: boolean): void;
}) {
  return (
    <ListItem
      colors={palette}
      modifiers={[
        fillMaxWidth(),
        ...(disabled
          ? []
          : [
              toggleable(value, () => onValueChange(!value), {
                role: 'switch',
              }),
            ]),
      ]}>
      <ListItem.HeadlineContent>
        <Text
          color={labelColor}
          style={{ typography: 'titleMedium' }}
          modifiers={[padding(4, 8, 0, 8)]}>
          {label}
        </Text>
      </ListItem.HeadlineContent>
      <ListItem.TrailingContent>
        <Row modifiers={[padding(0, 0, 4, 0)]}>
          <Switch
            colors={controlColors}
            enabled={!disabled}
            value={value}
            modifiers={[testIDModifier(testID)]}
            onCheckedChange={onValueChange}
          />
        </Row>
      </ListItem.TrailingContent>
    </ListItem>
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
      style={{ textAlign: 'center', typography: 'bodyMedium' }}
      modifiers={[
        fillMaxWidth(),
        padding(8, destructive ? 8 : 4, 8, destructive ? 8 : 4),
        testIDModifier(testID),
      ]}>
      {text}
    </Text>
  );
}
