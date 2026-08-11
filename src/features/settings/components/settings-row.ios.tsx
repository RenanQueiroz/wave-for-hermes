import { Button, HStack, Image, Spacer, Text, VStack } from '@expo/ui/swift-ui';
import {
  accessibilityAddTraits,
  accessibilityIdentifier,
  accessibilityValue,
  buttonStyle,
  disabled,
  foregroundStyle,
  frame,
} from '@expo/ui/swift-ui/modifiers';
import { Color } from 'expo-router';

const PRIMARY_TEXT = foregroundStyle({
  style: 'primary',
  type: 'hierarchical',
});
const SECONDARY_TEXT = foregroundStyle({
  style: 'secondary',
  type: 'hierarchical',
});
const SELECTION_ACCENT = foregroundStyle(Color.ios.systemBlue);

export function SettingsRow({
  description,
  enabled = true,
  label,
  onPress,
  selected,
  testID,
}: {
  description: string;
  enabled?: boolean;
  label: string;
  onPress: () => void;
  selected?: boolean;
  testID: string;
}) {
  return (
    <Button
      modifiers={[
        buttonStyle('plain'),
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
        modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' })]}>
        <VStack alignment="leading" spacing={3}>
          <Text modifiers={[PRIMARY_TEXT]}>{label}</Text>
          <Text modifiers={[SECONDARY_TEXT]}>{description}</Text>
        </VStack>
        <Spacer />
        {selected ? (
          <Image
            systemName="checkmark"
            size={17}
            modifiers={[SELECTION_ACCENT]}
          />
        ) : null}
      </HStack>
    </Button>
  );
}
