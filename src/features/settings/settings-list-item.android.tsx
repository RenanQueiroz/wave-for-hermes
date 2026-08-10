import {
  Box,
  Column,
  ListItem,
  RadioButton,
  Switch,
  Text,
} from '@expo/ui/jetpack-compose';
import {
  Shapes,
  clickable,
  clip,
  fillMaxWidth,
  padding,
  selectable,
  selectableGroup,
  testID as testIDModifier,
  toggleable,
} from '@expo/ui/jetpack-compose/modifiers';
import {
  Children,
  cloneElement,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from 'react';
import { useCSSVariable } from 'uniwind';

import { useTheme } from '@/hooks/use-theme';

type SettingsListItemPosition = 'first' | 'last' | 'middle' | 'only';
type NativeListItemColors = NonNullable<
  Parameters<typeof ListItem>[0]['colors']
>;

interface SettingsListItemPalette {
  content: string;
  listItem: NativeListItemColors;
  secondaryContent: string;
}

export interface SettingsListItemContentInsets {
  bottom?: number;
  end?: number;
  start?: number;
  top?: number;
}

interface SettingsListItemBaseProps {
  contentInsets?: SettingsListItemContentInsets;
  destructive?: boolean;
  description?: string;
  enabled?: boolean;
  label: string;
  leadingContent?: ReactNode;
  overline?: string;
  testID?: string;
}

interface SettingsPlainListItemProps extends SettingsListItemBaseProps {
  onPress?: () => void;
  trailingContent?: ReactNode;
  type?: 'item';
}

interface SettingsRadioListItemProps extends SettingsListItemBaseProps {
  onSelect: () => void;
  selected: boolean;
  type: 'radio';
}

interface SettingsSwitchListItemProps extends SettingsListItemBaseProps {
  onValueChange: (value: boolean) => void;
  type: 'switch';
  value: boolean;
}

export type SettingsListItemProps = (
  | SettingsPlainListItemProps
  | SettingsRadioListItemProps
  | SettingsSwitchListItemProps
) & {
  /** Assigned automatically by SettingsListGroup. */
  position?: SettingsListItemPosition;
};

interface SettingsListGroupProps {
  children: ReactNode;
  radioGroup?: boolean;
}

// Change these PanelUI semantic tokens to restyle every Android settings row.
const SETTINGS_LIST_ITEM_COLOR_TOKENS = {
  container: '--color-surface-tertiary',
  content: '--color-foreground',
  destructiveContent: '--color-destructive-foreground',
  secondaryContent: '--color-muted-foreground',
} as const;

const SETTINGS_LIST_ITEM_COLOR_TOKEN_LIST = [
  SETTINGS_LIST_ITEM_COLOR_TOKENS.container,
  SETTINGS_LIST_ITEM_COLOR_TOKENS.content,
  SETTINGS_LIST_ITEM_COLOR_TOKENS.destructiveContent,
  SETTINGS_LIST_ITEM_COLOR_TOKENS.secondaryContent,
] as [string, string, string, string];

// Expo UI exposes the standard ListItem but not Material 3's SegmentedListItem yet.
// These mirror the native Compose segmented-list shape tokens and gap.
const LIST_ITEM_INNER_CORNER_RADIUS = 4;
const LIST_ITEM_OUTER_CORNER_RADIUS = 16;
const LIST_ITEM_SEGMENT_GAP = 2;

// Added to Compose ListItem's built-in insets. Override any side per row with
// contentInsets; change these defaults to adjust every Android settings item.
const DEFAULT_SETTINGS_LIST_ITEM_CONTENT_INSETS = {
  bottom: 8,
  end: 4,
  start: 4,
  top: 8,
} satisfies Required<SettingsListItemContentInsets>;

function resolveColor(value: string | number | undefined, fallback: string) {
  return typeof value === 'string' ? value : fallback;
}

function resolveContentInset(value: number | undefined, fallback: number) {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, value)
    : fallback;
}

function resolveContentInsets(
  contentInsets: SettingsListItemContentInsets | undefined,
): Required<SettingsListItemContentInsets> {
  return {
    bottom: resolveContentInset(
      contentInsets?.bottom,
      DEFAULT_SETTINGS_LIST_ITEM_CONTENT_INSETS.bottom,
    ),
    end: resolveContentInset(
      contentInsets?.end,
      DEFAULT_SETTINGS_LIST_ITEM_CONTENT_INSETS.end,
    ),
    start: resolveContentInset(
      contentInsets?.start,
      DEFAULT_SETTINGS_LIST_ITEM_CONTENT_INSETS.start,
    ),
    top: resolveContentInset(
      contentInsets?.top,
      DEFAULT_SETTINGS_LIST_ITEM_CONTENT_INSETS.top,
    ),
  };
}

function useSettingsListItemPalette(
  destructive: boolean,
): SettingsListItemPalette {
  const theme = useTheme();
  const [container, content, destructiveContent, secondaryContent] =
    useCSSVariable(SETTINGS_LIST_ITEM_COLOR_TOKEN_LIST);

  const resolvedContent = destructive
    ? resolveColor(destructiveContent, theme.text)
    : resolveColor(content, theme.text);
  const resolvedSecondaryContent = resolveColor(
    secondaryContent,
    theme.textSecondary,
  );

  return {
    content: resolvedContent,
    listItem: {
      containerColor: resolveColor(container, theme.backgroundElement),
      contentColor: resolvedContent,
      leadingContentColor: resolvedSecondaryContent,
      overlineContentColor: resolvedSecondaryContent,
      supportingContentColor: resolvedSecondaryContent,
      trailingContentColor: resolvedSecondaryContent,
    },
    secondaryContent: resolvedSecondaryContent,
  };
}

function getSettingsListItemShape(position: SettingsListItemPosition) {
  const topRadius =
    position === 'first' || position === 'only'
      ? LIST_ITEM_OUTER_CORNER_RADIUS
      : LIST_ITEM_INNER_CORNER_RADIUS;
  const bottomRadius =
    position === 'last' || position === 'only'
      ? LIST_ITEM_OUTER_CORNER_RADIUS
      : LIST_ITEM_INNER_CORNER_RADIUS;

  return Shapes.RoundedCorner({
    bottomEnd: bottomRadius,
    bottomStart: bottomRadius,
    topEnd: topRadius,
    topStart: topRadius,
  });
}

function getSettingsListItemPosition(
  index: number,
  count: number,
): SettingsListItemPosition {
  if (count === 1) return 'only';
  if (index === 0) return 'first';
  if (index === count - 1) return 'last';
  return 'middle';
}

export function SettingsListGroup({
  children,
  radioGroup = false,
}: SettingsListGroupProps) {
  const items = Children.toArray(children);

  return (
    <Column
      verticalArrangement={{ spacedBy: LIST_ITEM_SEGMENT_GAP }}
      modifiers={[
        fillMaxWidth(),
        padding(16, 0, 16, 0),
        ...(radioGroup ? [selectableGroup()] : []),
      ]}>
      {items.map((child, index) =>
        isValidElement<SettingsListItemProps>(child)
          ? cloneElement(child as ReactElement<SettingsListItemProps>, {
              position: getSettingsListItemPosition(index, items.length),
            })
          : child,
      )}
    </Column>
  );
}

export function SettingsListItem(props: SettingsListItemProps) {
  const enabled = props.enabled ?? true;
  const contentInsets = resolveContentInsets(props.contentInsets);
  const palette = useSettingsListItemPalette(Boolean(props.destructive));
  const hasLeadingContent = props.leadingContent != null;
  const hasTrailingContent =
    props.type === 'switch' ||
    props.type === 'radio' ||
    props.trailingContent != null;
  const modifiers = [
    fillMaxWidth(),
    clip(getSettingsListItemShape(props.position ?? 'only')),
  ];

  if (props.type === 'switch') {
    if (enabled) {
      modifiers.push(
        toggleable(props.value, () => props.onValueChange(!props.value), {
          role: 'switch',
        }),
      );
    }
  } else if (props.type === 'radio') {
    if (enabled) {
      modifiers.push(selectable(props.selected, props.onSelect, 'radioButton'));
    }
  } else {
    if (enabled && props.onPress) modifiers.push(clickable(props.onPress));
    if (props.testID) modifiers.push(testIDModifier(props.testID));
  }

  return (
    <ListItem colors={palette.listItem} modifiers={modifiers}>
      <ListItem.HeadlineContent>
        <Column
          verticalArrangement={{ spacedBy: 4 }}
          modifiers={[
            padding(
              hasLeadingContent ? 0 : contentInsets.start,
              contentInsets.top,
              hasTrailingContent ? 0 : contentInsets.end,
              contentInsets.bottom,
            ),
          ]}>
          {props.overline ? (
            <Text
              color={palette.secondaryContent}
              style={{ typography: 'labelMedium' }}>
              {props.overline}
            </Text>
          ) : null}
          <Text color={palette.content} style={{ typography: 'titleMedium' }}>
            {props.label}
          </Text>
          {props.description ? (
            <Text
              color={palette.secondaryContent}
              style={{ typography: 'bodyMedium' }}>
              {props.description}
            </Text>
          ) : null}
        </Column>
      </ListItem.HeadlineContent>
      {hasLeadingContent ? (
        <ListItem.LeadingContent>
          <Box modifiers={[padding(contentInsets.start, 0, 0, 0)]}>
            {props.leadingContent}
          </Box>
        </ListItem.LeadingContent>
      ) : null}
      {props.type === 'switch' ? (
        <ListItem.TrailingContent>
          <Box modifiers={[padding(0, 0, contentInsets.end, 0)]}>
            <Switch
              enabled={enabled}
              onCheckedChange={props.onValueChange}
              value={props.value}
              modifiers={props.testID ? [testIDModifier(props.testID)] : []}
            />
          </Box>
        </ListItem.TrailingContent>
      ) : props.type === 'radio' ? (
        <ListItem.TrailingContent>
          <Box modifiers={[padding(0, 0, contentInsets.end, 0)]}>
            <RadioButton
              selected={props.selected}
              onClick={enabled ? props.onSelect : undefined}
              modifiers={props.testID ? [testIDModifier(props.testID)] : []}
            />
          </Box>
        </ListItem.TrailingContent>
      ) : props.trailingContent ? (
        <ListItem.TrailingContent>
          <Box modifiers={[padding(0, 0, contentInsets.end, 0)]}>
            {props.trailingContent}
          </Box>
        </ListItem.TrailingContent>
      ) : null}
    </ListItem>
  );
}
