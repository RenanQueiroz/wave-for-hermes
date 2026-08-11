import { Stack } from 'expo-router';
import { useCSSVariable } from 'uniwind';

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
        headerTitleAlign: process.env.EXPO_OS === 'android' ? 'left' : 'center',
        headerShadowVisible:
          process.env.EXPO_OS === 'android' ? false : undefined,
      }}>
      <Stack.Screen name="(chat)" options={{ headerShown: false }} />
      <Stack.Screen name="search">
        <Stack.Title large>Search conversations</Stack.Title>
        {process.env.EXPO_OS === 'ios' ? (
          <Stack.Header
            largeStyle={IOS_LARGE_HEADER_STYLE}
            style={IOS_HEADER_STYLE}
          />
        ) : null}
      </Stack.Screen>
      <Stack.Screen name="settings">
        <Stack.Title large>Settings</Stack.Title>
        {process.env.EXPO_OS === 'ios' ? (
          <Stack.Header
            largeStyle={IOS_LARGE_HEADER_STYLE}
            style={IOS_HEADER_STYLE}
          />
        ) : null}
      </Stack.Screen>
      <Stack.Screen name="settings/[selection]">
        <Stack.Title large />
        {process.env.EXPO_OS === 'ios' ? (
          <Stack.Header
            largeStyle={IOS_LARGE_HEADER_STYLE}
            style={IOS_HEADER_STYLE}
          />
        ) : null}
      </Stack.Screen>
      <Stack.Screen name="development">
        <Stack.Title large>Development</Stack.Title>
        {process.env.EXPO_OS === 'ios' ? (
          <Stack.Header
            largeStyle={IOS_LARGE_HEADER_STYLE}
            style={IOS_HEADER_STYLE}
          />
        ) : null}
      </Stack.Screen>
    </Stack>
  );
}
