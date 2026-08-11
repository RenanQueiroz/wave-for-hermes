import { Stack, useNavigation } from 'expo-router';
import { DrawerActions } from 'expo-router/react-navigation';
import { useCallback } from 'react';
import { useCSSVariable } from 'uniwind';

import { MenuButton } from '@/components/navigation/menu-button';

export const unstable_settings = {
  initialRouteName: 'new',
};

export default function ChatStackLayout() {
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
        headerTitleAlign: process.env.EXPO_OS === 'android' ? 'left' : 'center',
        headerShadowVisible:
          process.env.EXPO_OS === 'android' ? false : undefined,
      }}>
      <Stack.Screen name="new" options={{ headerShown: false }} />
      <Stack.Screen
        name="conversation/[sessionId]"
        options={{
          headerLeft: () => <MenuButton onPress={openDrawer} />,
          // The chat screen sets the real conversation title once it resolves.
          title: '',
        }}>
        {process.env.EXPO_OS === 'ios' ? (
          // Keep chat compact and let UIKit own its standard blurred material.
          <Stack.Header style={{ shadowColor: 'transparent' }} />
        ) : null}
      </Stack.Screen>
      <Stack.Screen
        name="conversation/[sessionId]/voice"
        options={{ headerShown: false, presentation: 'modal' }}
      />
    </Stack>
  );
}
