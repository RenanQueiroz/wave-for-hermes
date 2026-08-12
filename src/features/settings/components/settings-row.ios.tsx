import { Button, HStack, Image, Spacer, Text, VStack } from '@expo/ui/swift-ui';
import {
  accessibilityAddTraits,
  accessibilityIdentifier,
  accessibilityValue,
  buttonStyle,
  contentShape,
  disabled,
  foregroundStyle,
  frame,
  shapes,
  tint,
} from '@expo/ui/swift-ui/modifiers';

import { useTheme } from '@/hooks/use-theme';

const PRIMARY_TEXT = foregroundStyle({
  style: 'primary',
  type: 'hierarchical',
});
const SECONDARY_TEXT = foregroundStyle({
  style: 'secondary',
  type: 'hierarchical',
});
const TERTIARY_TEXT = foregroundStyle({
  style: 'tertiary',
  type: 'hierarchical',
});
export function SettingsRow({
  description,
  enabled = true,
  label,
  onPress,
  selected,
  showsDisclosureIndicator = false,
  testID,
}: {
  description: string;
  enabled?: boolean;
  label: string;
  onPress: () => void;
  selected?: boolean;
  showsDisclosureIndicator?: boolean;
  testID: string;
}) {
  const theme = useTheme();

  return (
    <Button
      modifiers={[
        buttonStyle('plain'),
        frame({ maxWidth: Infinity, alignment: 'leading' }),
        tint(theme.primary),
        disabled(!enabled),
        accessibilityIdentifier(testID),
        ...(selected === undefined
          ? []
          : [accessibilityValue(selected ? 'Selected' : 'Not selected')]),
        ...(selected ? [accessibilityAddTraits(['isSelected'])] : []),
      ]}
      onPress={onPress}>
      <HStack
        alignment="center"
        spacing={12}
        modifiers={[
          frame({ maxWidth: Infinity, alignment: 'leading' }),
          contentShape(shapes.rectangle()),
        ]}>
        <VStack alignment="leading" spacing={3}>
          <Text modifiers={[PRIMARY_TEXT]}>{label}</Text>
          <Text modifiers={[SECONDARY_TEXT]}>{description}</Text>
        </VStack>
        <Spacer />
        {selected ? (
          <Image
            systemName="checkmark"
            size={17}
            modifiers={[foregroundStyle(theme.primary)]}
          />
        ) : showsDisclosureIndicator ? (
          <Image
            systemName="chevron.right"
            size={14}
            modifiers={[TERTIARY_TEXT]}
          />
        ) : null}
      </HStack>
    </Button>
  );
}
