import { Stack, useNavigation } from 'expo-router';
import { DrawerActions } from 'expo-router/react-navigation';
import { useCallback } from 'react';
import { Platform } from 'react-native';
import { useCSSVariable } from 'uniwind';

import { MenuButton } from '@/components/navigation/menu-button';

export const unstable_settings = {
  initialRouteName: 'new',
};

export default function AppStackLayout() {
  const navigation = useNavigation();
  const openDrawer = useCallback(
    () => navigation.dispatch(DrawerActions.openDrawer()),
    [navigation],
  );
  // Native header colors are native props, so the theme tokens resolve here.
  const [background, foreground] = useCSSVariable([
    '--color-background',
    '--color-foreground',
  ]);

  return (
    <Stack
      screenOptions={{
        headerBackButtonDisplayMode: 'minimal',
        headerStyle:
          typeof background === 'string'
            ? { backgroundColor: background }
            : undefined,
        headerTintColor:
          typeof foreground === 'string' ? foreground : undefined,
        headerLargeTitleStyle:
          typeof foreground === 'string' ? { color: foreground } : undefined,
        headerTitleAlign: Platform.OS === 'android' ? 'left' : 'center',
        headerShadowVisible: Platform.OS === 'android' ? false : undefined,
      }}>
      <Stack.Screen name="new" options={{ headerShown: false }} />
      <Stack.Screen
        name="conversation/[sessionId]"
        options={{
          headerLeft: () => <MenuButton onPress={openDrawer} />,
          // The chat screen sets the real conversation title once it resolves.
          title: '',
        }}
      />
      <Stack.Screen
        name="conversation/[sessionId]/voice"
        options={{ headerShown: false, presentation: 'modal' }}
      />
      <Stack.Screen name="search" options={{ title: 'Search conversations' }} />
      <Stack.Screen name="settings">
        <Stack.Title large>Settings</Stack.Title>
        {Platform.OS === 'ios' ? (
          <Stack.Header
            largeStyle={{
              backgroundColor: 'transparent',
              shadowColor: 'transparent',
            }}
            style={{ shadowColor: 'transparent' }}
          />
        ) : null}
      </Stack.Screen>
      <Stack.Screen
        name="settings/[selection]"
        options={{
          title: '',
        }}
      />
      <Stack.Screen
        name="development"
        options={{
          title: 'Development',
        }}
      />
    </Stack>
  );
}
