import { Stack } from 'expo-router';
import { Platform } from 'react-native';
import { useCSSVariable } from 'uniwind';

import { AppUpdateProvider } from '@/features/updates/app-update-provider';

const IOS_HEADER_STYLE = { shadowColor: 'transparent' } as const;
const IOS_LARGE_HEADER_STYLE = {
  backgroundColor: 'transparent',
  shadowColor: 'transparent',
} as const;

export const unstable_settings = {
  initialRouteName: '(chat)',
};

export default function AppLayout() {
  // Native header colors are native props, so the theme tokens resolve here.
  const [background, foreground] = useCSSVariable([
    '--color-background',
    '--color-foreground',
  ]);

  return (
    <AppUpdateProvider>
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
        <Stack.Screen name="(chat)" options={{ headerShown: false }} />
        <Stack.Screen name="search">
          <Stack.Title large>Search conversations</Stack.Title>
          {Platform.OS === 'ios' ? (
            <Stack.Header
              largeStyle={IOS_LARGE_HEADER_STYLE}
              style={IOS_HEADER_STYLE}
            />
          ) : null}
        </Stack.Screen>
        <Stack.Screen name="settings">
          <Stack.Title large>Settings</Stack.Title>
          {Platform.OS === 'ios' ? (
            <Stack.Header
              largeStyle={IOS_LARGE_HEADER_STYLE}
              style={IOS_HEADER_STYLE}
            />
          ) : null}
        </Stack.Screen>
        <Stack.Screen name="settings/[selection]">
          <Stack.Title large />
          {Platform.OS === 'ios' ? (
            <Stack.Header
              largeStyle={IOS_LARGE_HEADER_STYLE}
              style={IOS_HEADER_STYLE}
            />
          ) : null}
        </Stack.Screen>
        <Stack.Screen name="development">
          <Stack.Title large>Development</Stack.Title>
          {Platform.OS === 'ios' ? (
            <Stack.Header
              largeStyle={IOS_LARGE_HEADER_STYLE}
              style={IOS_HEADER_STYLE}
            />
          ) : null}
        </Stack.Screen>
      </Stack>
    </AppUpdateProvider>
  );
}
