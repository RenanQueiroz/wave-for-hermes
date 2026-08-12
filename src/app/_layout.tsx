import '../global.css';

import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { PanelUIProvider, useThemeMode } from 'panelui-native';
import { useEffect, useMemo } from 'react';
import { Platform, type ColorValue } from 'react-native';
import { useCSSVariable } from 'uniwind';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import { registerMobileAgentStateProvider } from '@/dev/mobile-agent-state';
import { WaveConnectionProvider } from '@/features/connection/connection-provider';
import { useApplyThemePreference } from '@/features/settings/theme-preference';
import { WaveQueryProvider } from '@/services/query/wave-query-provider';

void SplashScreen.preventAutoHideAsync().catch(() => {
  // Fast Refresh can race a splash screen that is already hidden.
});

function resolveColor(
  value: string | number | undefined,
  fallback: ColorValue,
): ColorValue {
  return typeof value === 'string' ? value : fallback;
}

function ThemedApp() {
  const { mode } = useThemeMode();
  const [background, card, text, border, primary] = useCSSVariable([
    '--color-background',
    '--color-card',
    '--color-foreground',
    '--color-border',
    '--color-primary',
  ]);
  const navigationTheme = useMemo(() => {
    const baseTheme = mode === 'dark' ? DarkTheme : DefaultTheme;

    return {
      ...baseTheme,
      colors: {
        ...baseTheme.colors,
        background: resolveColor(background, baseTheme.colors.background),
        border: resolveColor(border, baseTheme.colors.border),
        card: resolveColor(card, baseTheme.colors.card),
        primary: resolveColor(primary, baseTheme.colors.primary),
        text: resolveColor(text, baseTheme.colors.text),
      },
    };
  }, [background, border, card, mode, primary, text]);

  useEffect(() => {
    if (!__DEV__) return;
    return registerMobileAgentStateProvider({
      name: 'app-shell',
      read: () => ({
        colorScheme: mode,
        platform: Platform.OS,
      }),
    });
  }, [mode]);

  return (
    <ThemeProvider value={navigationTheme}>
      {/* The theme preference can differ from the OS scheme, so the status
          bar follows the app's resolved mode rather than the system's. */}
      <StatusBar style={mode === 'dark' ? 'light' : 'dark'} />
      <WaveConnectionProvider>
        <Stack screenOptions={{ headerBackButtonDisplayMode: 'minimal' }}>
          <Stack.Screen name="index" options={{ headerShown: false }} />
          <Stack.Screen name="connect" options={{ headerShown: false }} />
          <Stack.Screen name="(app)" options={{ headerShown: false }} />
        </Stack>
        <AnimatedSplashOverlay />
      </WaveConnectionProvider>
    </ThemeProvider>
  );
}

export default function RootLayout() {
  useApplyThemePreference();

  // PanelUIProvider mounts react-native-keyboard-controller's KeyboardProvider
  // itself. A second one here nests two providers, which breaks per-frame
  // keyboard events on Android.
  return (
    <PanelUIProvider>
      <WaveQueryProvider>
        <ThemedApp />
      </WaveQueryProvider>
    </PanelUIProvider>
  );
}
