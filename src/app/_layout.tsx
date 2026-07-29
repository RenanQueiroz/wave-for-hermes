import '../global.css';

import { DarkTheme, DefaultTheme, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { PanelUIProvider, useThemeMode } from 'panelui-native';
import { useEffect, useMemo } from 'react';
import { Platform, type ColorValue } from 'react-native';
import { useCSSVariable } from 'uniwind';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import AppTabs from '@/components/app-tabs';
import { registerMobileAgentStateProvider } from '@/dev/mobile-agent-state';

SplashScreen.preventAutoHideAsync();

function resolveColor(value: string | number | undefined, fallback: ColorValue): ColorValue {
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
      <AnimatedSplashOverlay />
      <AppTabs />
    </ThemeProvider>
  );
}

export default function RootLayout() {
  return (
    <PanelUIProvider>
      <ThemedApp />
    </PanelUIProvider>
  );
}
