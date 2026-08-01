import * as SecureStore from 'expo-secure-store';
import { PANEL_THEMES } from 'panelui-native';
import { useEffect } from 'react';
import { Appearance, useColorScheme } from 'react-native';
import { Uniwind } from 'uniwind';

const THEME_PREFERENCE_KEY = 'wave.theme-preference.v1';

export type WaveThemeFamilyId = 'panel' | 'moon' | 'grass';
export type WaveThemeAppearance = 'system' | 'light' | 'dark';

export interface WaveThemePreference {
  appearance: WaveThemeAppearance;
  family: WaveThemeFamilyId;
  version: 1;
}

export const DEFAULT_THEME_PREFERENCE: WaveThemePreference = {
  appearance: 'system',
  family: 'panel',
  version: 1,
};

const FAMILY_IDS: readonly WaveThemeFamilyId[] = ['panel', 'moon', 'grass'];
const APPEARANCES: readonly WaveThemeAppearance[] = ['system', 'light', 'dark'];

/** A malformed or missing record degrades to the default look, never an error. */
export async function loadThemePreference(): Promise<WaveThemePreference> {
  try {
    const stored = await SecureStore.getItemAsync(THEME_PREFERENCE_KEY);
    if (!stored) return DEFAULT_THEME_PREFERENCE;
    const record = JSON.parse(stored) as Record<string, unknown>;
    if (
      record.version !== 1 ||
      !FAMILY_IDS.includes(record.family as WaveThemeFamilyId) ||
      !APPEARANCES.includes(record.appearance as WaveThemeAppearance)
    ) {
      return DEFAULT_THEME_PREFERENCE;
    }
    return {
      appearance: record.appearance as WaveThemeAppearance,
      family: record.family as WaveThemeFamilyId,
      version: 1,
    };
  } catch {
    return DEFAULT_THEME_PREFERENCE;
  }
}

export async function saveThemePreference(preference: WaveThemePreference) {
  try {
    await SecureStore.setItemAsync(
      THEME_PREFERENCE_KEY,
      JSON.stringify(preference),
      { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY },
    );
  } catch {
    // Losing a theme preference is cosmetic; the applied theme stands until
    // the next launch.
  }
}

function preferredFamily(preference: WaveThemePreference) {
  return (
    PANEL_THEMES.find((candidate) => candidate.id === preference.family) ??
    PANEL_THEMES[0]!
  );
}

/**
 * Uniwind pins RN's app-level appearance override when an explicit
 * `light`/`dark` theme is set, so `useColorScheme` stops reporting the
 * device. "System" therefore goes through Uniwind's own adaptive mode for
 * the default family, and for named families the override is cleared before
 * the real device scheme is read.
 */
export function applyThemePreference(preference: WaveThemePreference) {
  const family = preferredFamily(preference);

  if (preference.appearance !== 'system') {
    Uniwind.setTheme(family[preference.appearance]);
    return;
  }
  if (preference.family === 'panel') {
    Uniwind.setTheme('system');
    return;
  }
  Appearance.setColorScheme('unspecified');
  const scheme = Appearance.getColorScheme();
  Uniwind.setTheme(family[scheme === 'dark' ? 'dark' : 'light']);
}

/**
 * Applies the stored preference at launch and re-applies it when the device
 * scheme changes, which is what makes "system" follow the OS for the named
 * families. Mount once at the app root.
 */
export function useApplyThemePreference() {
  const systemScheme = useColorScheme();

  useEffect(() => {
    let cancelled = false;
    void loadThemePreference().then((preference) => {
      if (!cancelled) applyThemePreference(preference);
    });
    return () => {
      cancelled = true;
    };
  }, [systemScheme]);
}
