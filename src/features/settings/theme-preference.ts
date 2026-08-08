import * as SecureStore from 'expo-secure-store';
import { useEffect } from 'react';
import { Uniwind } from 'uniwind';

const THEME_PREFERENCE_KEY = 'wave.theme-preference.v1';

/**
 * Wave ships one theme family (PanelUI's default); the user chooses only
 * whether it runs light, dark, or follows the OS. The Moon and Grass families
 * were deliberately removed — records from that era still parse, keeping the
 * appearance they stored.
 */
export type WaveThemeAppearance = 'system' | 'light' | 'dark';

export interface WaveThemePreference {
  appearance: WaveThemeAppearance;
  version: 1 | 2;
}

export const DEFAULT_THEME_PREFERENCE: WaveThemePreference = {
  appearance: 'system',
  version: 2,
};

const APPEARANCES: readonly WaveThemeAppearance[] = ['system', 'light', 'dark'];

/** A malformed or missing record degrades to the default look, never an error. */
export async function loadThemePreference(): Promise<WaveThemePreference> {
  try {
    const stored = await SecureStore.getItemAsync(THEME_PREFERENCE_KEY);
    if (!stored) return DEFAULT_THEME_PREFERENCE;
    const record = JSON.parse(stored) as Record<string, unknown>;
    // Version 1 records carried a theme family as well; only the appearance
    // survives the migration.
    if (
      (record.version !== 1 && record.version !== 2) ||
      !APPEARANCES.includes(record.appearance as WaveThemeAppearance)
    ) {
      return DEFAULT_THEME_PREFERENCE;
    }
    return {
      appearance: record.appearance as WaveThemeAppearance,
      version: 2,
    };
  } catch {
    return DEFAULT_THEME_PREFERENCE;
  }
}

export async function saveThemePreference(preference: WaveThemePreference) {
  try {
    await SecureStore.setItemAsync(
      THEME_PREFERENCE_KEY,
      JSON.stringify({ appearance: preference.appearance, version: 2 }),
      { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY },
    );
  } catch {
    // Losing a theme preference is cosmetic; the applied theme stands until
    // the next launch.
  }
}

/**
 * `system` uses Uniwind's adaptive mode, which tracks OS scheme changes on
 * its own; an explicit choice pins the matching registered theme (Uniwind
 * also pins RN's app-level appearance so native views follow along).
 */
export function applyThemePreference(preference: WaveThemePreference) {
  Uniwind.setTheme(
    preference.appearance === 'system' ? 'system' : preference.appearance,
  );
}

/** Applies the stored preference at launch. Mount once at the app root. */
export function useApplyThemePreference() {
  useEffect(() => {
    let cancelled = false;
    void loadThemePreference().then((preference) => {
      if (!cancelled) applyThemePreference(preference);
    });
    return () => {
      cancelled = true;
    };
  }, []);
}
