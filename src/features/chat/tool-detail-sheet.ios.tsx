/**
 * Native iOS bottom sheet for one tool call's bounded input and output,
 * rendered in SwiftUI: code-block styled monospaced text on the solid app
 * background (the default sheet material is translucent and lets the
 * transcript bleed through).
 */
import { Host } from '@expo/ui';
import {
  BottomSheet,
  Group,
  ScrollView,
  Text,
  VStack,
} from '@expo/ui/swift-ui';
import {
  accessibilityIdentifier,
  background,
  font,
  foregroundStyle,
  frame,
  padding,
  presentationBackground,
  presentationDetents,
  presentationDragIndicator,
  shapes,
  textSelection,
} from '@expo/ui/swift-ui/modifiers';

import type { ToolDetailSheetProps } from '@/features/chat/tool-detail-sheet.shared';
import {
  TOOL_DETAIL_EMPTY_COPY,
  TOOL_DETAIL_TRUNCATED_COPY,
  toolDetailSections,
} from '@/features/chat/tool-detail-sheet.shared';
import { useTheme } from '@/hooks/use-theme';

export function ToolDetailSheet({ detail, onDismiss }: ToolDetailSheetProps) {
  const theme = useTheme();
  const sections = detail ? toolDetailSections(detail) : [];

  return (
    <Host
      colorScheme={theme.mode}
      pointerEvents="none"
      seedColor={theme.primary}
      style={{ position: 'absolute' }}>
      <BottomSheet
        isPresented={Boolean(detail)}
        onDismiss={onDismiss}
        onIsPresentedChange={(presented) => {
          if (!presented) onDismiss();
        }}>
        <Group
          modifiers={[
            presentationDetents(['medium', 'large']),
            presentationDragIndicator('visible'),
            presentationBackground(theme.background),
          ]}>
          <VStack spacing={0} modifiers={[frame({ maxWidth: Infinity })]}>
            <Text
              modifiers={[
                frame({ alignment: 'leading', maxWidth: Infinity }),
                padding({ bottom: 10, horizontal: 20, top: 18 }),
                font({ size: 20, weight: 'bold' }),
                foregroundStyle(theme.text),
                accessibilityIdentifier('chat-tool-detail-title'),
              ]}>
              {detail?.title ?? ''}
            </Text>
            <ScrollView>
              <VStack
                alignment="leading"
                spacing={16}
                modifiers={[
                  frame({ maxWidth: Infinity }),
                  padding({ bottom: 28, horizontal: 20 }),
                ]}>
                {sections.map((section) => (
                  <VStack alignment="leading" key={section.key} spacing={6}>
                    <Text
                      modifiers={[
                        font({ size: 13, weight: 'semibold' }),
                        foregroundStyle(theme.textSecondary),
                      ]}>
                      {section.label}
                    </Text>
                    <Text
                      modifiers={[
                        frame({ alignment: 'leading', maxWidth: Infinity }),
                        padding({ horizontal: 12, vertical: 12 }),
                        background(
                          theme.muted,
                          shapes.roundedRectangle({ cornerRadius: 12 }),
                        ),
                        font({ design: 'monospaced', size: 12 }),
                        foregroundStyle(theme.text),
                        textSelection(true),
                        accessibilityIdentifier(
                          `chat-tool-detail-${section.key}`,
                        ),
                      ]}>
                      {section.text}
                    </Text>
                    {section.truncated ? (
                      <Text
                        modifiers={[
                          font({ size: 12 }),
                          foregroundStyle(theme.textSecondary),
                        ]}>
                        {TOOL_DETAIL_TRUNCATED_COPY}
                      </Text>
                    ) : null}
                  </VStack>
                ))}
                {detail && sections.length === 0 ? (
                  <Text
                    modifiers={[
                      frame({ alignment: 'leading', maxWidth: Infinity }),
                      font({ size: 14 }),
                      foregroundStyle(theme.textSecondary),
                      accessibilityIdentifier('chat-tool-detail-empty'),
                    ]}>
                    {TOOL_DETAIL_EMPTY_COPY}
                  </Text>
                ) : null}
              </VStack>
            </ScrollView>
          </VStack>
        </Group>
      </BottomSheet>
    </Host>
  );
}
