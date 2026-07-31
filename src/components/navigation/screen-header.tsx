import { useNavigation, useRouter } from 'expo-router';
import { Button, ChevronLeftIcon, Typography } from 'panelui-native';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { MenuButton } from './menu-button';

interface ScreenHeaderProps {
  mode?: 'back' | 'menu';
  title: string;
}

export function ScreenHeader({ mode = 'back', title }: ScreenHeaderProps) {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const router = useRouter();

  return (
    <View
      className="flex-row items-center gap-2 border-b border-border bg-background px-3 pb-2"
      style={{ paddingTop: Math.max(insets.top, 10) }}>
      {mode === 'menu' ? (
        <MenuButton
          onPress={() =>
            navigation.getParent()?.dispatch({
              type: 'OPEN_DRAWER',
            })
          }
        />
      ) : (
        <Button
          size="icon"
          variant="ghost"
          accessibilityLabel="Go back"
          testID="screen-back-button"
          onPress={() => router.back()}>
          <ChevronLeftIcon size={22} />
        </Button>
      )}
      <Typography.Heading className="flex-1" numberOfLines={1} type="h4">
        {title}
      </Typography.Heading>
    </View>
  );
}
