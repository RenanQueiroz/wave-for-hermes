import { useNativeState } from '@expo/ui';
import {
  Alert,
  Button,
  ContentUnavailableView,
  Host,
  Picker,
  ProgressView,
  Text,
  TextField,
  VStack,
} from '@expo/ui/swift-ui';
import {
  accessibilityIdentifier,
  disabled,
  font,
  foregroundStyle,
  frame,
  hidden,
  kerning,
  onSubmit as onSubmitModifier,
  padding,
  pickerStyle,
  tag,
} from '@expo/ui/swift-ui/modifiers';
import type { WaveSessionSummary } from '@wave/contracts';
import type { DrawerContentComponentProps } from 'expo-router/drawer';
import { memo, useCallback } from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useRecyclingState } from '@legendapp/list/react-native';

import { OfflineNotice } from '@/components/offline-notice';
import {
  DRAWER_COPY,
  drawerReadStateAction,
  drawerRowAccessibilityLabel,
  drawerRowGlyph,
  emptySessionFilterMessage,
  SESSION_FILTERS,
  sessionTitle,
  useWaveDrawerContent,
  type DrawerRowGlyph,
  type DrawerSessionListItem,
} from '@/features/navigation/drawer/content.shared';
import { DRAWER_ICONS } from '@/features/navigation/drawer/icons';
import {
  DRAWER_ROW_HEIGHTS,
  DrawerNavRow,
  DrawerSectionHeader,
  DrawerSessionRow,
} from '@/features/navigation/drawer/session-row';
import { DrawerSessionList } from '@/features/navigation/drawer/session-list';
import { useDrawerColors } from '@/features/navigation/drawer/use-drawer-colors';
import type { DrawerColors } from '@/features/navigation/drawer/view.types';
import { useTheme } from '@/hooks/use-theme';
import type { WaveSessionFilter } from '@/features/sessions/session-organization';
import type { WaveChatClient } from '@/services/wave/wave-chat-client';
import { useConnectedWave } from '@/state/use-connected-wave';

export function WaveDrawerContent(props: DrawerContentComponentProps) {
  const connected = useConnectedWave();
  const colors = useDrawerColors();
  const theme = useTheme();
  if (!connected) {
    return (
      <View
        className="flex-1 items-center justify-center bg-background"
        accessibilityLabel="Loading Wave menu">
        <Host colorScheme={theme.mode} matchContents seedColor={colors.primary}>
          <ProgressView />
        </Host>
      </View>
    );
  }
  return (
    <ConnectedWaveDrawerContent
      {...props}
      baseUrl={connected.baseUrl}
      client={connected.client}
      colors={colors}
      connectionId={connected.connectionId}
    />
  );
}

function ConnectedWaveDrawerContent({
  baseUrl,
  client,
  colors,
  connectionId,
  navigation,
}: DrawerContentComponentProps & {
  baseUrl: string;
  client: WaveChatClient;
  colors: DrawerColors;
  connectionId: string;
}) {
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const closeDrawer = useCallback(() => navigation.closeDrawer(), [navigation]);
  const drawer = useWaveDrawerContent({
    baseUrl,
    client,
    closeDrawer,
    connectionId,
  });
  // Narrow, stable dependencies: a new renderItem identity re-renders every
  // visible row, so the container object from the hook must not be a dep.
  const {
    openSession,
    pathname,
    pinningSessionId,
    sessionFilter,
    startDelete,
    startRename,
    toggleSessionPin,
    toggleSessionUnread,
  } = drawer;
  const renderItem = useCallback(
    (item: DrawerSessionListItem) => {
      if (item.kind === 'section') {
        return (
          <SectionHeaderHost
            colors={colors}
            label={item.label}
            mode={theme.mode}
            sectionId={item.sectionId}
          />
        );
      }
      const selected = pathname.includes(item.session.id);
      return (
        <SessionRowHost
          colors={colors}
          glyph={drawerRowGlyph(item.session, sessionFilter, { selected })}
          mode={theme.mode}
          pinning={pinningSessionId === item.session.id}
          selected={selected}
          session={item.session}
          onDelete={startDelete}
          onOpen={openSession}
          onPin={toggleSessionPin}
          onRename={startRename}
          onToggleUnread={toggleSessionUnread}
        />
      );
    },
    [
      colors,
      openSession,
      pathname,
      pinningSessionId,
      sessionFilter,
      startDelete,
      startRename,
      theme.mode,
      toggleSessionPin,
      toggleSessionUnread,
    ],
  );

  return (
    <View
      className="flex-1 bg-background"
      style={{
        paddingBottom: Math.max(insets.bottom, 12),
        paddingTop: Math.max(insets.top, 12),
      }}>
      <View className="border-b border-border px-2 pb-2">
        <Host
          colorScheme={theme.mode}
          matchContents={{ vertical: true }}
          seedColor={colors.primary}
          style={{ width: '100%' }}>
          <VStack
            alignment="leading"
            spacing={2}
            modifiers={[frame({ alignment: 'leading', maxWidth: Infinity })]}>
            <Text
              modifiers={[
                font({ size: 20, weight: 'bold' }),
                foregroundStyle(colors.foreground),
                padding({ bottom: 8, horizontal: 12, top: 2 }),
              ]}>
              Wave
            </Text>
            <DrawerNavRow
              colors={colors}
              icon={DRAWER_ICONS.newConversation}
              label="New conversation"
              testID="drawer-new-conversation"
              onPress={() => drawer.navigate('/new')}
            />
            <DrawerNavRow
              colors={colors}
              icon={DRAWER_ICONS.search}
              label="Search conversations"
              testID="drawer-search-conversations"
              onPress={() => drawer.navigate('/search')}
            />
            {drawer.errorMessage ? (
              <Text
                modifiers={[
                  font({ size: 12 }),
                  foregroundStyle(colors.destructive),
                  padding({ horizontal: 12, vertical: 6 }),
                  accessibilityIdentifier('drawer-error'),
                ]}>
                {drawer.errorMessage}
              </Text>
            ) : null}
            <Text
              modifiers={[
                font({ size: 11, weight: 'semibold' }),
                foregroundStyle(colors.mutedForeground),
                kerning(0.8),
                padding({ bottom: 6, horizontal: 12, top: 10 }),
              ]}>
              CONVERSATIONS
            </Text>
            <FilterPicker
              value={drawer.sessionFilter}
              onChange={drawer.setSessionFilter}
            />
            {/* Keyed so each rename target mounts a fresh native draft seeded
                with its current title — no programmatic setText needed. */}
            {drawer.renameSession ? (
              <RenameAlert
                key={drawer.renameSession.id}
                colors={colors}
                pending={drawer.renamePending}
                session={drawer.renameSession}
                onCancel={drawer.cancelRename}
                onSubmit={drawer.confirmRename}
              />
            ) : null}
            <DeleteAlert
              message={DRAWER_COPY.deleteMessage(drawer.deleteSession)}
              pending={drawer.deletePending}
              presented={drawer.deleteSession !== undefined}
              onCancel={drawer.cancelDelete}
              onConfirm={drawer.confirmDelete}
            />
          </VStack>
        </Host>
      </View>

      <DrawerSessionList
        extraData={colors}
        isRefetching={drawer.isRefetching}
        items={drawer.sessionListItems}
        listEmpty={
          <Host
            colorScheme={theme.mode}
            matchContents={{ vertical: true }}
            seedColor={colors.primary}
            style={{ width: '100%' }}>
            {drawer.isPending ? (
              <VStack modifiers={[padding({ vertical: 32 })]}>
                <ProgressView />
              </VStack>
            ) : (
              <ContentUnavailableView
                description={emptySessionFilterMessage(drawer.sessionFilter)}
                systemImage="bubble.left"
                modifiers={[padding({ vertical: 16 })]}
              />
            )}
          </Host>
        }
        listHeader={
          drawer.showingCachedSessions ? (
            <OfflineNotice
              label={DRAWER_COPY.offlineNotice}
              testID="drawer-offline-notice"
            />
          ) : null
        }
        renderItem={renderItem}
        onEndReached={drawer.fetchNextPage}
        onRefresh={drawer.refetch}
      />

      <View className="border-t border-border px-2 pt-2">
        <Host
          colorScheme={theme.mode}
          matchContents={{ vertical: true }}
          seedColor={colors.primary}
          style={{ width: '100%' }}>
          <VStack
            alignment="leading"
            modifiers={[frame({ alignment: 'leading', maxWidth: Infinity })]}>
            <DrawerNavRow
              colors={colors}
              icon={DRAWER_ICONS.settings}
              label="Settings"
              testID="drawer-settings"
              onPress={() => drawer.navigate('/settings')}
            />
          </VStack>
        </Host>
      </View>
    </View>
  );
}

function FilterPicker({
  onChange,
  value,
}: {
  onChange(value: WaveSessionFilter): void;
  value: WaveSessionFilter;
}) {
  return (
    <Picker
      selection={value}
      modifiers={[
        pickerStyle('segmented'),
        padding({ bottom: 6, horizontal: 12 }),
        accessibilityIdentifier('drawer-session-filters'),
      ]}
      onSelectionChange={(selection) => {
        const match = SESSION_FILTERS.find(
          (filter) => filter.value === selection,
        );
        if (match) onChange(match.value);
      }}>
      {SESSION_FILTERS.map((filter) => (
        <Text key={filter.value} modifiers={[tag(filter.value)]}>
          {filter.label}
        </Text>
      ))}
    </Picker>
  );
}

/**
 * A SwiftUI alert carrying the rename text field — the native iOS rename
 * pattern. The alert anchors to a hidden zero-frame trigger because it opens
 * from menu actions, not a visible button. Mounted fresh per rename target
 * (keyed by session id) so the native draft's initial value is the current
 * title.
 */
function RenameAlert({
  colors,
  onCancel,
  onSubmit,
  pending,
  session,
}: {
  colors: DrawerColors;
  onCancel(): void;
  onSubmit(title: string): void;
  pending: boolean;
  session: WaveSessionSummary;
}) {
  const draft = useNativeState(sessionTitle(session));
  // Reads the native field's current value at submit (AGENTS keyboard rule).
  const submit = () => onSubmit(draft.value);
  return (
    <Alert
      isPresented
      title={DRAWER_COPY.renameTitle}
      onIsPresentedChange={(isPresented) => {
        if (!isPresented) onCancel();
      }}>
      <Alert.Trigger>
        <Text modifiers={[hidden(), frame({ height: 0, width: 0 })]}> </Text>
      </Alert.Trigger>
      <Alert.Message>
        <Text>{DRAWER_COPY.renameMessage}</Text>
      </Alert.Message>
      <Alert.Actions>
        <TextField
          text={draft as Parameters<typeof TextField>[0]['text']}
          modifiers={[
            accessibilityIdentifier('rename-session-input'),
            onSubmitModifier(submit),
          ]}>
          <TextField.Placeholder>
            <Text modifiers={[foregroundStyle(colors.mutedForeground)]}>
              Conversation title
            </Text>
          </TextField.Placeholder>
        </TextField>
        <ButtonRow
          cancelDisabled={pending}
          confirmDisabled={pending}
          confirmLabel={pending ? 'Saving…' : 'Save'}
          confirmTestID="rename-session-confirm"
          onCancel={onCancel}
          onConfirm={submit}
        />
      </Alert.Actions>
    </Alert>
  );
}

function DeleteAlert({
  message,
  onCancel,
  onConfirm,
  pending,
  presented,
}: {
  message: string;
  onCancel(): void;
  onConfirm(): void;
  pending: boolean;
  presented: boolean;
}) {
  return (
    <Alert
      isPresented={presented}
      title={DRAWER_COPY.deleteTitle}
      onIsPresentedChange={(isPresented) => {
        if (!isPresented) onCancel();
      }}>
      <Alert.Trigger>
        <Text modifiers={[hidden(), frame({ height: 0, width: 0 })]}> </Text>
      </Alert.Trigger>
      <Alert.Message>
        <Text>{message}</Text>
      </Alert.Message>
      <Alert.Actions>
        <ButtonRow
          cancelDisabled={pending}
          confirmDestructive
          confirmDisabled={pending}
          confirmLabel={pending ? 'Deleting…' : 'Delete'}
          confirmTestID="delete-session-confirm"
          onCancel={onCancel}
          onConfirm={onConfirm}
        />
      </Alert.Actions>
    </Alert>
  );
}

function ButtonRow({
  cancelDisabled,
  confirmDestructive,
  confirmDisabled,
  confirmLabel,
  confirmTestID,
  onCancel,
  onConfirm,
}: {
  cancelDisabled: boolean;
  confirmDestructive?: boolean;
  confirmDisabled: boolean;
  confirmLabel: string;
  confirmTestID: string;
  onCancel(): void;
  onConfirm(): void;
}) {
  return (
    <>
      <AlertButton
        disabled={cancelDisabled}
        label="Cancel"
        role="cancel"
        onPress={onCancel}
      />
      <AlertButton
        disabled={confirmDisabled}
        label={confirmLabel}
        role={confirmDestructive ? 'destructive' : 'default'}
        testID={confirmTestID}
        onPress={onConfirm}
      />
    </>
  );
}

function AlertButton({
  disabled: isDisabled,
  label,
  onPress,
  role,
  testID,
}: {
  disabled: boolean;
  label: string;
  onPress(): void;
  role: 'cancel' | 'default' | 'destructive';
  testID?: string;
}) {
  return (
    <Button
      label={label}
      role={role}
      modifiers={[
        disabled(isDisabled),
        ...(testID ? [accessibilityIdentifier(testID)] : []),
      ]}
      onPress={onPress}
    />
  );
}

const SectionHeaderHost = memo(function SectionHeaderHost({
  colors,
  label,
  mode,
  sectionId,
}: {
  colors: DrawerColors;
  label: string;
  mode: 'dark' | 'light';
  sectionId: string;
}) {
  return (
    <Host
      colorScheme={mode}
      seedColor={colors.primary}
      style={{ height: DRAWER_ROW_HEIGHTS.sectionHeader, width: '100%' }}>
      <DrawerSectionHeader
        colors={colors}
        label={label}
        testID={`drawer-section-${sectionId}`}
      />
    </Host>
  );
});

// Memoized because the drawer re-renders on every mutation, and an inline row
// would rebuild the whole visible list each time.
const SessionRowHost = memo(function SessionRowHost({
  colors,
  glyph,
  mode,
  pinning,
  selected,
  session,
  onDelete,
  onOpen,
  onPin,
  onRename,
  onToggleUnread,
}: {
  colors: DrawerColors;
  glyph: DrawerRowGlyph;
  mode: 'dark' | 'light';
  pinning: boolean;
  selected: boolean;
  session: WaveSessionSummary;
  onDelete(session: WaveSessionSummary): void;
  onOpen(sessionId: string): Promise<void>;
  onPin(session: WaveSessionSummary): void;
  onRename(session: WaveSessionSummary): void;
  onToggleUnread(session: WaveSessionSummary): void;
}) {
  // Resets when the recycled row is reused for another session, so an open
  // action sheet never carries over.
  const [menuOpen, setMenuOpen] = useRecyclingState(false);
  const readState = drawerReadStateAction(session);
  return (
    <Host
      colorScheme={mode}
      seedColor={colors.primary}
      style={{ height: DRAWER_ROW_HEIGHTS.sessionRow, width: '100%' }}>
      {/* Keyed by session, pinned, and read state: a mounted SwiftUI menu
          keeps a stale action snapshot when its props change in place (labels
          update but taps go dead — the "Unpin stops working" bug), and a
          recycled menu must never dispatch the previous session's actions.
          Remounting the hosted subtree is the AGENTS-documented remedy for
          stale hosted SwiftUI in recycled Legend List cells. */}
      <DrawerSessionRow
        key={`${session.id}-${session.pinned ? 'pinned' : 'unpinned'}-${session.unread ? 'unread' : 'read'}`}
        colors={colors}
        glyph={glyph}
        menuOpen={menuOpen}
        pinned={session.pinned}
        readStateLabel={readState.label}
        rowAccessibilityLabel={drawerRowAccessibilityLabel(session, glyph)}
        selected={selected}
        sessionId={session.id}
        title={sessionTitle(session)}
        unread={session.unread}
        onDelete={() => onDelete(session)}
        onMenuOpenChange={setMenuOpen}
        onOpen={() => void onOpen(session.id)}
        // Guarded here, not with a native disabled() on the menu item — see
        // the note in session-row.ios.tsx.
        onPin={() => {
          if (!pinning) onPin(session);
        }}
        onRename={() => onRename(session)}
        onToggleUnread={() => onToggleUnread(session)}
      />
    </Host>
  );
});
