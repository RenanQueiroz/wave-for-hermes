import { Button } from 'panelui-native';
import { View } from 'react-native';

interface MenuButtonProps {
  onPress(): void;
}

export function MenuButton({ onPress }: MenuButtonProps) {
  return (
    <Button
      size="icon"
      variant="ghost"
      accessibilityLabel="Open navigation menu"
      className="rounded-full"
      testID="open-navigation-menu"
      onPress={onPress}>
      <View
        className="h-4 w-5 justify-between"
        importantForAccessibility="no-hide-descendants">
        <View className="h-0.5 w-5 rounded-full bg-foreground" />
        <View className="h-0.5 w-5 rounded-full bg-foreground" />
        <View className="h-0.5 w-5 rounded-full bg-foreground" />
      </View>
    </Button>
  );
}
