import {
  Box,
  DropdownMenu,
  DropdownMenuItem,
  Icon,
  IconButton,
  ListItem,
  Row,
  Text,
} from '@expo/ui/jetpack-compose';
import {
  clip,
  combinedClickable,
  clickable,
  fillMaxWidth,
  height,
  padding,
  Shapes,
  size,
  testID as testIDModifier,
  width,
} from '@expo/ui/jetpack-compose/modifiers';
import type { ImageSourcePropType } from 'react-native';

import { DRAWER_ICONS } from '@/features/navigation/drawer/icons';
import type { DrawerRowGlyph } from '@/features/navigation/drawer/row-model';
import type { DrawerColors } from '@/features/navigation/drawer/view.types';

/**
 * Fixed Host heights: Material one-line list items and navigation-drawer
 * items are 56dp, section labels get a compact 36dp. Hosted rows inside
 * recycled Legend List cells must keep the RN Host and the native row at the
 * same explicit height without `matchContents`.
 */
export const DRAWER_ROW_HEIGHTS = {
  navRow: 56,
  sectionHeader: 36,
  sessionRow: 56,
} as const;

const NAV_ROW_CORNER = 28;
const SESSION_ROW_CORNER = 16;
const GLYPH_COLUMN_WIDTH = 24;

function glyphSource(glyph: DrawerRowGlyph): ImageSourcePropType | undefined {
  if (glyph.kind === 'live') {
    return (
      glyph.status === 'waiting'
        ? DRAWER_ICONS.liveWaiting
        : DRAWER_ICONS.liveActive
    ) as ImageSourcePropType;
  }
  if (glyph.kind === 'source') {
    const bySource = {
      automation: DRAWER_ICONS.sourceAutomation,
      external: DRAWER_ICONS.sourceExternal,
      other: DRAWER_ICONS.sourceOther,
    } as const;
    return bySource[glyph.source] as ImageSourcePropType;
  }
  return undefined;
}

export function DrawerSectionHeader({
  colors,
  label,
  testID,
}: {
  colors: DrawerColors;
  label: string;
  testID: string;
}) {
  return (
    <Row
      verticalAlignment="bottom"
      modifiers={[
        fillMaxWidth(),
        height(DRAWER_ROW_HEIGHTS.sectionHeader),
        padding(16, 0, 16, 6),
        testIDModifier(testID),
      ]}>
      <Text
        color={colors.mutedForeground}
        style={{ letterSpacing: 0.8, typography: 'labelMedium' }}>
        {label.toUpperCase()}
      </Text>
    </Row>
  );
}

export function DrawerNavRow({
  colors,
  icon,
  label,
  onPress,
  testID,
}: {
  colors: DrawerColors;
  icon?: ImageSourcePropType;
  label: string;
  onPress(): void;
  testID: string;
}) {
  return (
    <Row
      verticalAlignment="center"
      modifiers={[
        fillMaxWidth(),
        height(DRAWER_ROW_HEIGHTS.navRow),
        clip(Shapes.RoundedCorner(NAV_ROW_CORNER)),
        clickable(onPress),
        testIDModifier(testID),
        padding(16, 0, 16, 0),
      ]}>
      {icon ? (
        <Box modifiers={[padding(0, 0, 12, 0)]}>
          <Icon
            contentDescription=""
            size={20}
            source={icon}
            tint={colors.mutedForeground}
          />
        </Box>
      ) : null}
      <Text color={colors.foreground} style={{ typography: 'labelLarge' }}>
        {label}
      </Text>
    </Row>
  );
}

export function DrawerSessionRow({
  colors,
  glyph,
  menuOpen,
  onDelete,
  onMenuOpenChange,
  onOpen,
  onPin,
  onRename,
  pinDisabled,
  pinned,
  selected,
  sessionId,
  title,
}: {
  colors: DrawerColors;
  glyph: DrawerRowGlyph;
  menuOpen: boolean;
  onDelete(): void;
  onMenuOpenChange(open: boolean): void;
  onOpen(): void;
  onPin(): void;
  onRename(): void;
  pinDisabled: boolean;
  pinned: boolean;
  selected: boolean;
  sessionId: string;
  title: string;
}) {
  const glyphIcon = glyphSource(glyph);
  return (
    <ListItem
      colors={{
        containerColor: selected ? colors.muted : 'transparent',
        contentColor: colors.foreground,
        leadingContentColor: colors.mutedForeground,
        trailingContentColor: colors.mutedForeground,
      }}
      modifiers={[
        fillMaxWidth(),
        height(DRAWER_ROW_HEIGHTS.sessionRow),
        clip(Shapes.RoundedCorner(SESSION_ROW_CORNER)),
        combinedClickable({
          onClick: onOpen,
          onLongClick: () => onMenuOpenChange(true),
        }),
        testIDModifier(`drawer-session-${sessionId}`),
      ]}>
      <ListItem.HeadlineContent>
        <Text
          color={colors.foreground}
          maxLines={1}
          overflow="ellipsis"
          style={{ typography: 'bodyLarge' }}>
          {title}
        </Text>
      </ListItem.HeadlineContent>
      {/* Trailing cluster: status/source glyph, pinned bookmark, overflow —
          no reserved leading column, so idle titles keep the full row. */}
      <ListItem.TrailingContent>
        <Row verticalAlignment="center" horizontalArrangement={{ spacedBy: 2 }}>
          {glyphIcon ? (
            <Box
              contentAlignment="center"
              modifiers={[
                width(GLYPH_COLUMN_WIDTH),
                height(GLYPH_COLUMN_WIDTH),
              ]}>
              <Icon
                contentDescription={glyph.kind === 'none' ? '' : glyph.label}
                size={glyph.kind === 'live' ? 12 : 16}
                source={glyphIcon}
                tint={
                  glyph.kind === 'live' && glyph.status !== 'waiting'
                    ? colors.primary
                    : colors.mutedForeground
                }
              />
            </Box>
          ) : null}
          {pinned ? (
            <Icon
              contentDescription="Pinned conversation"
              size={16}
              source={DRAWER_ICONS.pinned as ImageSourcePropType}
              tint={colors.mutedForeground}
              modifiers={[testIDModifier(`drawer-session-pinned-${sessionId}`)]}
            />
          ) : null}
          <DropdownMenu
            color={colors.card}
            expanded={menuOpen}
            onDismissRequest={() => onMenuOpenChange(false)}>
            <DropdownMenu.Trigger>
              <IconButton
                colors={{
                  containerColor: 'transparent',
                  contentColor: colors.mutedForeground,
                }}
                modifiers={[
                  size(40, 40),
                  testIDModifier(`drawer-session-actions-${sessionId}`),
                ]}
                onClick={() => onMenuOpenChange(true)}>
                <Icon
                  contentDescription={`Conversation actions for ${title}`}
                  size={20}
                  source={DRAWER_ICONS.ellipsis as ImageSourcePropType}
                  tint={colors.mutedForeground}
                />
              </IconButton>
            </DropdownMenu.Trigger>
            <DropdownMenu.Items>
              <DropdownMenuItem
                elementColors={{ textColor: colors.foreground }}
                modifiers={[
                  testIDModifier(`drawer-session-rename-${sessionId}`),
                ]}
                onClick={() => {
                  onMenuOpenChange(false);
                  onRename();
                }}>
                <DropdownMenuItem.LeadingIcon>
                  <Icon
                    contentDescription=""
                    size={18}
                    source={DRAWER_ICONS.rename as ImageSourcePropType}
                    tint={colors.mutedForeground}
                  />
                </DropdownMenuItem.LeadingIcon>
                <DropdownMenuItem.Text>
                  <Text color={colors.foreground}>Rename</Text>
                </DropdownMenuItem.Text>
              </DropdownMenuItem>
              <DropdownMenuItem
                enabled={!pinDisabled}
                elementColors={{ textColor: colors.foreground }}
                modifiers={[testIDModifier(`drawer-session-pin-${sessionId}`)]}
                onClick={() => {
                  onMenuOpenChange(false);
                  onPin();
                }}>
                <DropdownMenuItem.LeadingIcon>
                  <Icon
                    contentDescription=""
                    size={18}
                    source={
                      (pinned
                        ? DRAWER_ICONS.unpin
                        : DRAWER_ICONS.pin) as ImageSourcePropType
                    }
                    tint={colors.mutedForeground}
                  />
                </DropdownMenuItem.LeadingIcon>
                <DropdownMenuItem.Text>
                  <Text color={colors.foreground}>
                    {pinned ? 'Unpin' : 'Pin'}
                  </Text>
                </DropdownMenuItem.Text>
              </DropdownMenuItem>
              <DropdownMenuItem
                elementColors={{ textColor: colors.destructive }}
                modifiers={[
                  testIDModifier(`drawer-session-delete-${sessionId}`),
                ]}
                onClick={() => {
                  onMenuOpenChange(false);
                  onDelete();
                }}>
                <DropdownMenuItem.LeadingIcon>
                  <Icon
                    contentDescription=""
                    size={18}
                    source={DRAWER_ICONS.delete as ImageSourcePropType}
                    tint={colors.destructive}
                  />
                </DropdownMenuItem.LeadingIcon>
                <DropdownMenuItem.Text>
                  <Text color={colors.destructive}>Delete</Text>
                </DropdownMenuItem.Text>
              </DropdownMenuItem>
            </DropdownMenu.Items>
          </DropdownMenu>
        </Row>
      </ListItem.TrailingContent>
    </ListItem>
  );
}
