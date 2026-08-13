/**
 * Android bottom sheet for the in-app updater. Presentation only: every
 * transition lives in the shared reducer and the provider owns all side
 * effects. Release notes are untrusted text and render as plain bounded
 * Text, never markdown. The content is a plain scrollable Column — a
 * LazyColumn inside ModalBottomSheet swallows every pointer event before it
 * reaches JS (device-verified on the Pixel 8 Pro).
 */
import { Host } from '@expo/ui';
import {
  Button,
  CircularProgressIndicator,
  Column,
  LinearProgressIndicator,
  ModalBottomSheet,
  Row,
  Text,
} from '@expo/ui/jetpack-compose';
import {
  fillMaxWidth,
  padding,
  testID as testIDModifier,
  verticalScroll,
  weight,
} from '@expo/ui/jetpack-compose/modifiers';

import {
  APP_UPDATE_COPY,
  formatUpdateSize,
  formatUpdateVersion,
  isUpdateSheetPresented,
  type AppUpdateSheetProps,
} from '@/features/updates/app-update.shared';
import { useTheme } from '@/hooks/use-theme';
import {
  useWaveMaterialColors,
  wavePrimaryButtonColors,
  waveTextButtonColors,
} from '@/hooks/use-wave-material-colors';

export function AppUpdateSheet({
  installedVersion,
  onDismiss,
  onDownload,
  onInstall,
  state,
}: AppUpdateSheetProps) {
  const theme = useTheme();
  const colors = useWaveMaterialColors();
  if (!isUpdateSheetPresented(state)) return null;

  const primaryColors = wavePrimaryButtonColors(colors);
  const textColors = waveTextButtonColors(colors);

  return (
    <Host
      colorScheme={theme.mode}
      pointerEvents="none"
      seedColor={theme.primary}
      style={{ position: 'absolute' }}>
      <ModalBottomSheet
        containerColor={theme.background}
        contentColor={theme.text}
        initialFullyExpanded={false}
        sheetGesturesEnabled
        showDragHandle
        skipPartiallyExpanded={false}
        modifiers={[testIDModifier('app-update-sheet')]}
        onDismissRequest={onDismiss}>
        <Column
          horizontalAlignment="start"
          verticalArrangement={{ spacedBy: 12 }}
          modifiers={[
            fillMaxWidth(),
            verticalScroll(),
            padding(24, 0, 24, 28),
          ]}>
          {state.phase === 'checking' ? (
            <>
              <SheetTitle
                color={theme.text}
                text={APP_UPDATE_COPY.checkingTitle}
              />
              <Row modifiers={[fillMaxWidth(), padding(0, 8, 0, 8)]}>
                <CircularProgressIndicator color={theme.primary} />
              </Row>
            </>
          ) : null}

          {state.phase === 'up-to-date' ? (
            <>
              <SheetTitle
                color={theme.text}
                text={APP_UPDATE_COPY.upToDateTitle}
              />
              <Text
                color={theme.textSecondary}
                style={{ typography: 'bodyMedium' }}>
                {`Wave ${installedVersion} is the latest version.`}
              </Text>
              <Row
                horizontalArrangement={{ spacedBy: 8 }}
                modifiers={[fillMaxWidth(), padding(0, 8, 0, 0)]}>
                <Button
                  colors={primaryColors}
                  modifiers={[weight(1), testIDModifier('app-update-dismiss')]}
                  onClick={onDismiss}>
                  <Text>{APP_UPDATE_COPY.close}</Text>
                </Button>
              </Row>
            </>
          ) : null}

          {state.phase === 'available' ? (
            <>
              <SheetTitle
                color={theme.text}
                text={APP_UPDATE_COPY.availableTitle}
              />
              <Text color={theme.text} style={{ typography: 'bodyLarge' }}>
                {`Wave ${formatUpdateVersion(state.update)} · ${formatUpdateSize(state.update.apkSizeBytes)}`}
              </Text>
              <Text
                color={theme.textSecondary}
                style={{ typography: 'bodyMedium' }}>
                {`You have ${installedVersion}.`}
              </Text>
              {state.update.notes.length > 0 ? (
                <Text
                  color={theme.textSecondary}
                  style={{ typography: 'bodySmall' }}
                  modifiers={[testIDModifier('app-update-notes')]}>
                  {state.update.notes}
                </Text>
              ) : null}
              <Row
                horizontalArrangement={{ spacedBy: 8 }}
                modifiers={[fillMaxWidth(), padding(0, 8, 0, 0)]}>
                <Button
                  colors={textColors}
                  modifiers={[weight(1), testIDModifier('app-update-dismiss')]}
                  onClick={onDismiss}>
                  <Text>{APP_UPDATE_COPY.notNow}</Text>
                </Button>
                <Button
                  colors={primaryColors}
                  modifiers={[weight(1), testIDModifier('app-update-install')]}
                  onClick={onDownload}>
                  <Text>{APP_UPDATE_COPY.downloadInstall}</Text>
                </Button>
              </Row>
            </>
          ) : null}

          {state.phase === 'downloading' || state.phase === 'verifying' ? (
            <>
              <SheetTitle
                color={theme.text}
                text={`Wave ${formatUpdateVersion(state.update)}`}
              />
              <Text
                color={theme.textSecondary}
                style={{ typography: 'bodyMedium' }}>
                {state.phase === 'downloading'
                  ? APP_UPDATE_COPY.downloadingLabel
                  : APP_UPDATE_COPY.verifyingLabel}
              </Text>
              <LinearProgressIndicator
                color={theme.primary}
                trackColor={theme.backgroundElement}
                modifiers={[fillMaxWidth()]}
                {...(state.phase === 'downloading' &&
                state.progress !== undefined
                  ? { progress: state.progress }
                  : {})}
              />
              <Row
                horizontalArrangement={{ spacedBy: 8 }}
                modifiers={[fillMaxWidth(), padding(0, 8, 0, 0)]}>
                <Button
                  colors={textColors}
                  modifiers={[weight(1), testIDModifier('app-update-dismiss')]}
                  onClick={onDismiss}>
                  <Text>{APP_UPDATE_COPY.notNow}</Text>
                </Button>
              </Row>
            </>
          ) : null}

          {state.phase === 'ready' ? (
            <>
              <SheetTitle
                color={theme.text}
                text={APP_UPDATE_COPY.readyTitle}
              />
              <Text color={theme.text} style={{ typography: 'bodyMedium' }}>
                {APP_UPDATE_COPY.readyBody}
              </Text>
              <Text
                color={theme.textSecondary}
                style={{ typography: 'bodySmall' }}>
                {APP_UPDATE_COPY.unknownSourcesHint}
              </Text>
              <Row
                horizontalArrangement={{ spacedBy: 8 }}
                modifiers={[fillMaxWidth(), padding(0, 8, 0, 0)]}>
                <Button
                  colors={textColors}
                  modifiers={[weight(1), testIDModifier('app-update-dismiss')]}
                  onClick={onDismiss}>
                  <Text>{APP_UPDATE_COPY.notNow}</Text>
                </Button>
                <Button
                  colors={primaryColors}
                  modifiers={[weight(1), testIDModifier('app-update-install')]}
                  onClick={onInstall}>
                  <Text>{APP_UPDATE_COPY.install}</Text>
                </Button>
              </Row>
            </>
          ) : null}

          {state.phase === 'error' ? (
            <>
              <SheetTitle
                color={theme.text}
                text={APP_UPDATE_COPY.errorTitle}
              />
              <Text
                color={theme.textSecondary}
                style={{ typography: 'bodyMedium' }}
                modifiers={[testIDModifier('app-update-error')]}>
                {state.message}
              </Text>
              <Row
                horizontalArrangement={{ spacedBy: 8 }}
                modifiers={[fillMaxWidth(), padding(0, 8, 0, 0)]}>
                <Button
                  colors={primaryColors}
                  modifiers={[weight(1), testIDModifier('app-update-dismiss')]}
                  onClick={onDismiss}>
                  <Text>{APP_UPDATE_COPY.close}</Text>
                </Button>
              </Row>
            </>
          ) : null}
        </Column>
      </ModalBottomSheet>
    </Host>
  );
}

function SheetTitle({ color, text }: { color: string; text: string }) {
  return (
    <Text color={color} style={{ typography: 'titleLarge' }}>
      {text}
    </Text>
  );
}
