import { Stack, useNavigation } from 'expo-router';
import { DrawerActions } from 'expo-router/react-navigation';
import { useCallback } from 'react';
import { Platform } from 'react-native';
import { useCSSVariable } from 'uniwind';

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
        headerShown: Platform.OS === 'ios',
        headerStyle:
          typeof background === 'string'
            ? { backgroundColor: background }
            : undefined,
        headerTintColor:
          typeof foreground === 'string' ? foreground : undefined,
        headerTitleAlign: Platform.OS === 'android' ? 'left' : 'center',
        headerShadowVisible: Platform.OS === 'android' ? false : undefined,
      }}>
      <Stack.Screen name="new" options={{ headerShown: false }} />
      <Stack.Screen
        name="conversation/[sessionId]"
        options={{
          // The chat screen sets the real conversation title once it resolves.
          title: '',
        }}>
        {Platform.OS === 'ios' ? (
          // Keep chat compact while the transcript scrolls beneath UIKit's
          // system-selected translucent header material.
          <Stack.Header
            transparent
            style={{
              backgroundColor: 'transparent',
              shadowColor: 'transparent',
            }}
          />
        ) : null}
        {Platform.OS === 'ios' && typeof foreground === 'string' ? (
          <Stack.Toolbar placement="left">
            <Stack.Toolbar.Button
              accessibilityLabel="Open navigation menu"
              icon="line.3.horizontal"
              onPress={openDrawer}
            />
          </Stack.Toolbar>
        ) : null}
      </Stack.Screen>
      <Stack.Screen
        name="conversation/[sessionId]/voice"
        options={{ headerShown: false, presentation: 'modal' }}
      />
    </Stack>
  );
}
