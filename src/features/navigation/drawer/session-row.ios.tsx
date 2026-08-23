import {
  Button,
  ConfirmationDialog,
  ContextMenu,
  Divider,
  HStack,
  Image,
  Spacer,
  Text,
} from '@expo/ui/swift-ui';
import {
  accessibilityIdentifier,
  accessibilityLabel,
  background,
  buttonStyle,
  clipShape,
  font,
  foregroundStyle,
  frame,
  kerning,
  lineLimit,
  padding,
  shapes,
} from '@expo/ui/swift-ui/modifiers';

import { DRAWER_ICONS } from '@/features/navigation/drawer/icons';
import type { DrawerRowGlyph } from '@/features/navigation/drawer/row-model';
import type { DrawerColors } from '@/features/navigation/drawer/view.types';

/**
 * Fixed Host heights: 44pt matches the standard UIKit row; section labels get
 * a compact 30pt. Hosted rows inside recycled Legend List cells must keep the
 * RN Host and the native row at the same explicit height without
 * `matchContents`.
 */
export const DRAWER_ROW_HEIGHTS = {
  navRow: 44,
  sectionHeader: 30,
  sessionRow: 44,
} as const;

const ROW_CORNER_RADIUS = 10;

function glyphImage(glyph: DrawerRowGlyph, colors: DrawerColors) {
  if (glyph.kind === 'live') {
    return (
      <Image
        color={
          glyph.status === 'waiting' ? colors.mutedForeground : colors.primary
        }
        size={10}
        systemName={
          glyph.status === 'waiting'
            ? DRAWER_ICONS.liveWaiting
            : DRAWER_ICONS.liveActive
        }
      />
    );
  }
  if (glyph.kind === 'source') {
    const bySource = {
      automation: DRAWER_ICONS.sourceAutomation,
      external: DRAWER_ICONS.sourceExternal,
      other: DRAWER_ICONS.sourceOther,
    } as const;
    return (
      <Image
        color={colors.mutedForeground}
        size={14}
        systemName={bySource[glyph.source]}
      />
    );
  }
  if (glyph.kind === 'unread') {
    return (
      <Image
        color={colors.primary}
        size={12}
        systemName={DRAWER_ICONS.unread}
      />
    );
  }
  return null;
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
    <HStack
      alignment="bottom"
      modifiers={[
        frame({ height: DRAWER_ROW_HEIGHTS.sectionHeader, maxWidth: Infinity }),
        padding({ bottom: 4, horizontal: 12 }),
        accessibilityIdentifier(testID),
      ]}>
      <Text
        modifiers={[
          font({ size: 11, weight: 'semibold' }),
          foregroundStyle(colors.mutedForeground),
          kerning(0.8),
        ]}>
        {label.toUpperCase()}
      </Text>
      <Spacer />
    </HStack>
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
  icon?: (typeof DRAWER_ICONS)[keyof typeof DRAWER_ICONS];
  label: string;
  onPress(): void;
  testID: string;
}) {
  return (
    <Button
      onPress={onPress}
      modifiers={[
        buttonStyle('plain'),
        frame({ height: DRAWER_ROW_HEIGHTS.navRow, maxWidth: Infinity }),
        accessibilityIdentifier(testID),
        accessibilityLabel(label),
      ]}>
      <HStack
        alignment="center"
        spacing={10}
        modifiers={[
          frame({
            alignment: 'leading',
            height: DRAWER_ROW_HEIGHTS.navRow,
            maxWidth: Infinity,
          }),
          padding({ horizontal: 12 }),
        ]}>
        {icon ? (
          <Image color={colors.mutedForeground} size={17} systemName={icon} />
        ) : null}
        <Text
          modifiers={[font({ size: 15 }), foregroundStyle(colors.foreground)]}>
          {label}
        </Text>
        <Spacer />
      </HStack>
    </Button>
  );
}

function SessionActionItems({
  onDelete,
  onPin,
  onRename,
  onToggleUnread,
  pinned,
  readStateLabel,
  sessionId,
  unread,
  variant,
}: {
  onDelete(): void;
  onPin(): void;
  onRename(): void;
  onToggleUnread(): void;
  pinned: boolean;
  readStateLabel: string;
  sessionId: string;
  unread: boolean;
  variant: 'context' | 'menu';
}) {
  // The same actions back the ellipsis menu and the long-press context menu;
  // only the identifier suffix differs so the mobile agent can target either.
  const idSuffix = variant === 'context' ? '-context' : '';
  return (
    <>
      <Button
        label="Rename"
        systemImage={DRAWER_ICONS.rename}
        modifiers={[
          accessibilityIdentifier(
            `drawer-session-rename-${sessionId}${idSuffix}`,
          ),
        ]}
        onPress={onRename}
      />
      {/* Deliberately no native disabled() while a pin settles: SwiftUI menu
          items can retain a stale disabled state when the update lands while
          the menu is closed, leaving Unpin permanently dead. The pending
          guard lives in the onPin closure instead. */}
      <Button
        label={pinned ? 'Unpin' : 'Pin'}
        systemImage={pinned ? DRAWER_ICONS.unpin : DRAWER_ICONS.pin}
        modifiers={[
          accessibilityIdentifier(`drawer-session-pin-${sessionId}${idSuffix}`),
        ]}
        onPress={onPin}
      />
      <Button
        label={readStateLabel}
        systemImage={unread ? DRAWER_ICONS.markRead : DRAWER_ICONS.markUnread}
        modifiers={[
          accessibilityIdentifier(
            `drawer-session-read-state-${sessionId}${idSuffix}`,
          ),
        ]}
        onPress={onToggleUnread}
      />
      {/* Action sheets have no separators; the divider is context-menu only. */}
      {variant === 'context' ? <Divider /> : null}
      <Button
        label="Delete"
        role="destructive"
        systemImage={DRAWER_ICONS.delete}
        modifiers={[
          accessibilityIdentifier(
            `drawer-session-delete-${sessionId}${idSuffix}`,
          ),
        ]}
        onPress={onDelete}
      />
    </>
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
  onToggleUnread,
  pinned,
  readStateLabel,
  rowAccessibilityLabel,
  selected,
  sessionId,
  title,
  unread,
}: {
  colors: DrawerColors;
  glyph: DrawerRowGlyph;
  menuOpen: boolean;
  onDelete(): void;
  onMenuOpenChange(open: boolean): void;
  onOpen(): void;
  onPin(): void;
  onRename(): void;
  onToggleUnread(): void;
  pinned: boolean;
  readStateLabel: string;
  rowAccessibilityLabel: string;
  selected: boolean;
  sessionId: string;
  title: string;
  unread: boolean;
}) {
  // Close the sheet before dispatching, mirroring Android's DropdownMenu.
  const closeThen = (action: () => void) => () => {
    onMenuOpenChange(false);
    action();
  };
  const actionProps = {
    onDelete: closeThen(onDelete),
    onPin: closeThen(onPin),
    onRename: closeThen(onRename),
    onToggleUnread: closeThen(onToggleUnread),
    pinned,
    readStateLabel,
    sessionId,
    unread,
  };
  return (
    <ContextMenu>
      <ContextMenu.Trigger>
        <HStack
          alignment="center"
          spacing={4}
          modifiers={[
            frame({
              height: DRAWER_ROW_HEIGHTS.sessionRow,
              maxWidth: Infinity,
            }),
            background(
              selected ? colors.muted : 'clear',
              shapes.roundedRectangle({
                cornerRadius: ROW_CORNER_RADIUS,
                roundedCornerStyle: 'continuous',
              }),
            ),
            clipShape('roundedRectangle', ROW_CORNER_RADIUS),
          ]}>
          <Button
            onPress={onOpen}
            modifiers={[
              buttonStyle('plain'),
              frame({
                height: DRAWER_ROW_HEIGHTS.sessionRow,
                maxWidth: Infinity,
              }),
              accessibilityIdentifier(`drawer-session-${sessionId}`),
              accessibilityLabel(rowAccessibilityLabel),
            ]}>
            <HStack
              alignment="center"
              spacing={6}
              modifiers={[
                frame({
                  alignment: 'leading',
                  height: DRAWER_ROW_HEIGHTS.sessionRow,
                  maxWidth: Infinity,
                }),
                padding({ leading: 12 }),
              ]}>
              <Text
                modifiers={[
                  font({ size: 15 }),
                  foregroundStyle(colors.foreground),
                  lineLimit(1),
                ]}>
                {title}
              </Text>
              <Spacer />
            </HStack>
          </Button>
          {/* Trailing cluster: status/source glyph, pinned bookmark, menu —
              no reserved leading column, so idle titles keep the full row. */}
          {glyphImage(glyph, colors)}
          {pinned ? (
            <Image
              color={colors.mutedForeground}
              size={13}
              systemName={DRAWER_ICONS.pinned}
              modifiers={[
                accessibilityIdentifier(`drawer-session-pinned-${sessionId}`),
              ]}
            />
          ) : null}
          {/* A state-driven ConfirmationDialog instead of a SwiftUI Menu:
              menus hosted in recycled Legend List cells intermittently stop
              dispatching their item taps after the list reorganizes (the
              "Unpin stops working" bug). The sheet's actions mount at
              presentation time from current props, so they always dispatch. */}
          <ConfirmationDialog
            isPresented={menuOpen}
            title={title}
            onIsPresentedChange={onMenuOpenChange}>
            <ConfirmationDialog.Trigger>
              <Button
                onPress={() => onMenuOpenChange(true)}
                modifiers={[
                  buttonStyle('plain'),
                  frame({ height: DRAWER_ROW_HEIGHTS.sessionRow, width: 36 }),
                  accessibilityIdentifier(
                    `drawer-session-actions-${sessionId}`,
                  ),
                  accessibilityLabel(`Conversation actions for ${title}`),
                ]}>
                <Image
                  color={colors.mutedForeground}
                  size={16}
                  systemName={DRAWER_ICONS.ellipsis}
                />
              </Button>
            </ConfirmationDialog.Trigger>
            <ConfirmationDialog.Actions>
              <SessionActionItems {...actionProps} variant="menu" />
            </ConfirmationDialog.Actions>
          </ConfirmationDialog>
        </HStack>
      </ContextMenu.Trigger>
      <ContextMenu.Items>
        <SessionActionItems {...actionProps} variant="context" />
      </ContextMenu.Items>
    </ContextMenu>
  );
}
