import { Host, ListItem, Text } from '@expo/ui/jetpack-compose';
import {
  clickable,
  clip,
  fillMaxWidth,
  height,
  Shapes,
  testID as testIDModifier,
} from '@expo/ui/jetpack-compose/modifiers';
import { memo } from 'react';

import { useTheme } from '@/hooks/use-theme';

/**
 * Fixed Host height matching Material's two-line list item. Hosted rows
 * inside recycled Legend List cells keep the RN Host and the native row at
 * the same explicit height without `matchContents`.
 */
export const SEARCH_ROW_HEIGHT = 72;

export const SessionSearchRow = memo(function SessionSearchRow({
  description,
  foregroundColor,
  mutedColor,
  onPress,
  testID,
  title,
}: {
  description: string;
  foregroundColor: string;
  mutedColor: string;
  onPress(): void;
  testID: string;
  title: string;
}) {
  const theme = useTheme();
  return (
    <Host
      colorScheme={theme.mode}
      seedColor={theme.primary}
      style={{ height: SEARCH_ROW_HEIGHT, width: '100%' }}>
      <ListItem
        colors={{
          containerColor: 'transparent',
          contentColor: foregroundColor,
          supportingContentColor: mutedColor,
        }}
        modifiers={[
          fillMaxWidth(),
          height(SEARCH_ROW_HEIGHT),
          clip(Shapes.RoundedCorner(16)),
          clickable(onPress),
          testIDModifier(testID),
        ]}>
        <ListItem.HeadlineContent>
          <Text
            color={foregroundColor}
            maxLines={1}
            overflow="ellipsis"
            style={{ typography: 'bodyLarge' }}>
            {title}
          </Text>
        </ListItem.HeadlineContent>
        <ListItem.SupportingContent>
          <Text
            color={mutedColor}
            maxLines={1}
            overflow="ellipsis"
            style={{ typography: 'bodyMedium' }}>
            {description}
          </Text>
        </ListItem.SupportingContent>
      </ListItem>
    </Host>
  );
});
