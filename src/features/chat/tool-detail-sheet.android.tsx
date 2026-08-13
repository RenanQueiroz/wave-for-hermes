/**
 * Native Android bottom sheet for one tool call's bounded input and output,
 * rendered in Jetpack Compose: code-block styled monospaced text on the app
 * background. The content is a plain scrollable Column — a LazyColumn inside
 * ModalBottomSheet swallows every pointer event before it reaches JS
 * (device-verified on the Pixel 8 Pro).
 */
import { Host } from '@expo/ui';
import { Column, ModalBottomSheet, Text } from '@expo/ui/jetpack-compose';
import {
  Shapes,
  background,
  clip,
  fillMaxWidth,
  padding,
  testID as testIDModifier,
  verticalScroll,
} from '@expo/ui/jetpack-compose/modifiers';

import type { ToolDetailSheetProps } from '@/features/chat/tool-detail-sheet.shared';
import {
  TOOL_DETAIL_EMPTY_COPY,
  TOOL_DETAIL_TRUNCATED_COPY,
  toolDetailSections,
} from '@/features/chat/tool-detail-sheet.shared';
import { useTheme } from '@/hooks/use-theme';

export function ToolDetailSheet({ detail, onDismiss }: ToolDetailSheetProps) {
  const theme = useTheme();
  if (!detail) return null;
  const sections = toolDetailSections(detail);

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
        modifiers={[testIDModifier('chat-tool-detail-sheet')]}
        onDismissRequest={onDismiss}>
        <Column
          horizontalAlignment="start"
          verticalArrangement={{ spacedBy: 12 }}
          modifiers={[
            fillMaxWidth(),
            verticalScroll(),
            padding(16, 0, 16, 28),
          ]}>
          <Text
            color={theme.text}
            style={{ typography: 'titleLarge' }}
            modifiers={[testIDModifier('chat-tool-detail-title')]}>
            {detail.title}
          </Text>
          {sections.map((section) => (
            <Column
              horizontalAlignment="start"
              key={section.key}
              verticalArrangement={{ spacedBy: 6 }}
              modifiers={[fillMaxWidth()]}>
              <Text
                color={theme.textSecondary}
                style={{ typography: 'labelLarge' }}>
                {section.label}
              </Text>
              <Text
                color={theme.text}
                style={{ fontFamily: 'monospace', fontSize: 12 }}
                modifiers={[
                  fillMaxWidth(),
                  clip(Shapes.RoundedCorner(12)),
                  background(theme.muted),
                  padding(12, 12, 12, 12),
                  testIDModifier(`chat-tool-detail-${section.key}`),
                ]}>
                {section.text}
              </Text>
              {section.truncated ? (
                <Text
                  color={theme.textSecondary}
                  style={{ typography: 'bodySmall' }}>
                  {TOOL_DETAIL_TRUNCATED_COPY}
                </Text>
              ) : null}
            </Column>
          ))}
          {sections.length === 0 ? (
            <Text
              color={theme.textSecondary}
              style={{ typography: 'bodyMedium' }}
              modifiers={[testIDModifier('chat-tool-detail-empty')]}>
              {TOOL_DETAIL_EMPTY_COPY}
            </Text>
          ) : null}
        </Column>
      </ModalBottomSheet>
    </Host>
  );
}
