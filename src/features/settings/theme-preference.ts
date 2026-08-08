/**
 * Applies the persisted appearance preference to Uniwind.
 *
 * The preference itself lives in the device-state store
 * (`src/state/device-preferences.ts`); this module owns only the UI side:
 * `system` uses Uniwind's adaptive mode (which tracks OS scheme changes on
 * its own), an explicit choice pins the matching registered theme — Uniwind
 * also pins RN's app-level appearance so native views follow along.
 */
import { useEffect } from 'react';
import { Uniwind } from 'uniwind';

import {
  themeAppearancePreference,
  type WaveThemeAppearance,
} from '@/state/device-preferences';

export type { WaveThemeAppearance };

export function applyThemeAppearance(appearance: WaveThemeAppearance) {
  Uniwind.setTheme(appearance === 'system' ? 'system' : appearance);
}

/** Applies the stored appearance at launch and on change. Mount at the root. */
export function useApplyThemePreference() {
  useEffect(() => {
    let lastApplied: WaveThemeAppearance | undefined;
    const apply = (appearance: WaveThemeAppearance, hydrated: boolean) => {
      if (!hydrated || appearance === lastApplied) return;
      lastApplied = appearance;
      applyThemeAppearance(appearance);
    };
    const unsubscribe = themeAppearancePreference.api.subscribe((state) =>
      apply(state.value, state.hydrated),
    );
    void themeAppearancePreference.hydrate().then(() => {
      const state = themeAppearancePreference.api.getState();
      apply(state.value, state.hydrated);
    });
    return unsubscribe;
  }, []);
}
