import { useNativeState } from '@expo/ui';
import {
  AlertDialog,
  Box,
  Column,
  FilledTonalButton,
  Host,
  LoadingIndicator,
  OutlinedTextField,
  SegmentedButton,
  SingleChoiceSegmentedButtonRow,
  Text,
  TextButton,
} from '@expo/ui/jetpack-compose';
import {
  fillMaxWidth,
  padding,
  testID as testIDModifier,
} from '@expo/ui/jetpack-compose/modifiers';
import type { WaveSessionSummary } from '@wave/contracts';
import type { DrawerContentComponentProps } from 'expo-router/drawer';
import { memo, useCallback } from 'react';
import type { ImageSourcePropType } from 'react-native';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useRecyclingState } from '@legendapp/list/react-native';

import { OfflineNotice } from '@/components/offline-notice';
import {
  DRAWER_COPY,
  drawerReadStateAction,
  drawerRowGlyph,
  emptySessionFilterMessage,
  SESSION_FILTERS,
  sessionTitle,
  useWaveDrawerContent,
  type DrawerRowGlyph,
  type DrawerSessionListItem,
} from '@/features/navigation/drawer/content.shared';
import { DRAWER_ICONS } from '@/features/navigation/drawer/icons';
import { useAppUpdate } from '@/features/updates/app-update-provider';
import {
  DRAWER_ROW_HEIGHTS,
  DrawerNavRow,
  DrawerSectionHeader,
  DrawerSessionRow,
} from '@/features/navigation/drawer/rows';
import { DrawerSessionList } from '@/features/navigation/drawer/session-list';
import { useDrawerColors } from '@/features/navigation/drawer/use-drawer-colors';
import type { DrawerColors } from '@/features/navigation/drawer/view.types';
import { useTheme } from '@/hooks/use-theme';
import {
  useWaveMaterialColors,
  waveAlertDialogColors,
  waveSegmentedButtonColors,
  waveTextButtonColors,
  waveTextFieldColors,
  waveTonalButtonColors,
} from '@/hooks/use-wave-material-colors';
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
          <LoadingIndicator color={colors.primary} />
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
  const nativeColors = useWaveMaterialColors({ colorScheme: theme.mode });
  const closeDrawer = useCallback(() => navigation.closeDrawer(), [navigation]);
  const appUpdate = useAppUpdate();
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
          <Column
            horizontalAlignment="start"
            verticalArrangement={{ spacedBy: 2 }}
            modifiers={[fillMaxWidth()]}>
            <Text
              color={colors.foreground}
              style={{ typography: 'titleLarge' }}
              modifiers={[padding(16, 4, 16, 10)]}>
              Wave
            </Text>
            <DrawerNavRow
              colors={colors}
              icon={DRAWER_ICONS.newConversation as ImageSourcePropType}
              label="New conversation"
              testID="drawer-new-conversation"
              onPress={() => drawer.navigate('/new')}
            />
            <DrawerNavRow
              colors={colors}
              icon={DRAWER_ICONS.search as ImageSourcePropType}
              label="Search conversations"
              testID="drawer-search-conversations"
              onPress={() => drawer.navigate('/search')}
            />
            {drawer.errorMessage ? (
              <Text
                color={colors.destructive}
                style={{ typography: 'bodySmall' }}
                modifiers={[
                  fillMaxWidth(),
                  padding(16, 6, 16, 6),
                  testIDModifier('drawer-error'),
                ]}>
                {drawer.errorMessage}
              </Text>
            ) : null}
            <Text
              color={colors.mutedForeground}
              style={{ letterSpacing: 0.8, typography: 'labelMedium' }}
              modifiers={[padding(16, 10, 16, 6)]}>
              CONVERSATIONS
            </Text>
            <SingleChoiceSegmentedButtonRow
              modifiers={[fillMaxWidth(), padding(12, 0, 12, 6)]}>
              {SESSION_FILTERS.map((filter) => (
                <SegmentedButton
                  colors={waveSegmentedButtonColors(nativeColors)}
                  key={filter.value}
                  selected={drawer.sessionFilter === filter.value}
                  modifiers={[testIDModifier(`drawer-filter-${filter.value}`)]}
                  onClick={() => drawer.setSessionFilter(filter.value)}>
                  <SegmentedButton.Label>
                    <Text>{filter.label}</Text>
                  </SegmentedButton.Label>
                </SegmentedButton>
              ))}
            </SingleChoiceSegmentedButtonRow>
          </Column>
          {/* Dialogs live inside this sized Host as direct children — the
              Settings-proven placement; a zero-size presentation Host never
              shows the dialog window. Keyed so each rename target mounts a
              fresh native draft seeded with its current title. */}
          {drawer.renameSession ? (
            <RenameDialog
              key={drawer.renameSession.id}
              nativeColors={nativeColors}
              pending={drawer.renamePending}
              session={drawer.renameSession}
              onCancel={drawer.cancelRename}
              onSubmit={drawer.confirmRename}
            />
          ) : null}
          {drawer.deleteSession ? (
            <AlertDialog
              colors={waveAlertDialogColors(nativeColors)}
              properties={{
                dismissOnBackPress: !drawer.deletePending,
                dismissOnClickOutside: !drawer.deletePending,
              }}
              onDismissRequest={drawer.cancelDelete}>
              <AlertDialog.Title>
                <Text style={{ typography: 'headlineSmall' }}>
                  {DRAWER_COPY.deleteTitle}
                </Text>
              </AlertDialog.Title>
              <AlertDialog.Text>
                <Text style={{ typography: 'bodyMedium' }}>
                  {DRAWER_COPY.deleteMessage(drawer.deleteSession)}
                </Text>
              </AlertDialog.Text>
              <AlertDialog.DismissButton>
                <TextButton
                  colors={waveTextButtonColors(nativeColors)}
                  enabled={!drawer.deletePending}
                  onClick={drawer.cancelDelete}>
                  <Text>Cancel</Text>
                </TextButton>
              </AlertDialog.DismissButton>
              <AlertDialog.ConfirmButton>
                <FilledTonalButton
                  enabled={!drawer.deletePending}
                  colors={{
                    ...waveTonalButtonColors(nativeColors),
                    contentColor: colors.destructive,
                  }}
                  modifiers={[testIDModifier('delete-session-confirm')]}
                  onClick={drawer.confirmDelete}>
                  <Text>{drawer.deletePending ? 'Deleting…' : 'Delete'}</Text>
                </FilledTonalButton>
              </AlertDialog.ConfirmButton>
            </AlertDialog>
          ) : null}
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
              <Box
                contentAlignment="center"
                modifiers={[fillMaxWidth(), padding(0, 32, 0, 32)]}>
                <LoadingIndicator color={colors.primary} />
              </Box>
            ) : (
              <Text
                color={colors.mutedForeground}
                style={{ typography: 'bodyMedium' }}
                modifiers={[fillMaxWidth(), padding(16, 24, 16, 24)]}>
                {emptySessionFilterMessage(drawer.sessionFilter)}
              </Text>
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
          <Column horizontalAlignment="start" modifiers={[fillMaxWidth()]}>
            <DrawerNavRow
              colors={colors}
              icon={DRAWER_ICONS.settings as ImageSourcePropType}
              label="Settings"
              testID="drawer-settings"
              onPress={() => drawer.navigate('/settings')}
            />
            {appUpdate.supported ? (
              <DrawerNavRow
                colors={colors}
                icon={DRAWER_ICONS.update as ImageSourcePropType}
                label="Check for updates"
                testID="drawer-check-updates"
                onPress={() => {
                  closeDrawer();
                  appUpdate.checkNow();
                }}
              />
            ) : null}
          </Column>
        </Host>
      </View>
    </View>
  );
}

/**
 * Mounted fresh per rename target (keyed by session id), so the native draft
 * state's initial value is the current title — no programmatic setText, which
 * this version's Compose text field does not implement.
 */
function RenameDialog({
  nativeColors,
  onCancel,
  onSubmit,
  pending,
  session,
}: {
  nativeColors: ReturnType<typeof useWaveMaterialColors>;
  onCancel(): void;
  onSubmit(title: string): void;
  pending: boolean;
  session: WaveSessionSummary;
}) {
  const draft = useNativeState(sessionTitle(session));
  // Reads the native field's current value at submit (AGENTS keyboard rule).
  const submit = () => onSubmit(draft.value);
  return (
    <AlertDialog
      colors={waveAlertDialogColors(nativeColors)}
      properties={{
        dismissOnBackPress: !pending,
        dismissOnClickOutside: !pending,
      }}
      onDismissRequest={onCancel}>
      <AlertDialog.Title>
        <Text style={{ typography: 'headlineSmall' }}>
          {DRAWER_COPY.renameTitle}
        </Text>
      </AlertDialog.Title>
      <AlertDialog.Text>
        <Column
          verticalArrangement={{ spacedBy: 16 }}
          modifiers={[fillMaxWidth()]}>
          <Text style={{ typography: 'bodyMedium' }}>
            {DRAWER_COPY.renameMessage}
          </Text>
          <OutlinedTextField
            colors={waveTextFieldColors(nativeColors)}
            enabled={!pending}
            singleLine
            value={draft as Parameters<typeof OutlinedTextField>[0]['value']}
            keyboardActions={{ onDone: submit }}
            keyboardOptions={{
              capitalization: 'sentences',
              imeAction: 'done',
            }}
            modifiers={[
              fillMaxWidth(),
              testIDModifier('rename-session-input'),
            ]}>
            <OutlinedTextField.Label>
              <Text>Conversation title</Text>
            </OutlinedTextField.Label>
          </OutlinedTextField>
        </Column>
      </AlertDialog.Text>
      <AlertDialog.DismissButton>
        <TextButton
          colors={waveTextButtonColors(nativeColors)}
          enabled={!pending}
          onClick={onCancel}>
          <Text>Cancel</Text>
        </TextButton>
      </AlertDialog.DismissButton>
      <AlertDialog.ConfirmButton>
        <FilledTonalButton
          colors={waveTonalButtonColors(nativeColors)}
          enabled={!pending}
          modifiers={[testIDModifier('rename-session-confirm')]}
          onClick={submit}>
          <Text>{pending ? 'Saving…' : 'Save'}</Text>
        </FilledTonalButton>
      </AlertDialog.ConfirmButton>
    </AlertDialog>
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
  // menu never carries over.
  const [menuOpen, setMenuOpen] = useRecyclingState(false);
  const readState = drawerReadStateAction(session);

  return (
    <Host
      colorScheme={mode}
      seedColor={colors.primary}
      style={{ height: DRAWER_ROW_HEIGHTS.sessionRow, width: '100%' }}>
      <DrawerSessionRow
        colors={colors}
        glyph={glyph}
        menuOpen={menuOpen}
        pinDisabled={pinning}
        pinned={session.pinned}
        readStateLabel={readState.label}
        selected={selected}
        sessionId={session.id}
        title={sessionTitle(session)}
        unread={session.unread}
        onDelete={() => onDelete(session)}
        onMenuOpenChange={setMenuOpen}
        onOpen={() => void onOpen(session.id)}
        onPin={() => onPin(session)}
        onRename={() => onRename(session)}
        onToggleUnread={() => onToggleUnread(session)}
      />
    </Host>
  );
});
