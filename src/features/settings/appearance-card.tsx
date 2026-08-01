import { Card, RadioGroup } from 'panelui-native';
import { useEffect, useState } from 'react';

import {
  applyThemePreference,
  DEFAULT_THEME_PREFERENCE,
  loadThemePreference,
  saveThemePreference,
  type WaveThemeAppearance,
  type WaveThemeFamilyId,
  type WaveThemePreference,
} from '@/features/settings/theme-preference';

export function AppearanceCard() {
  const [preference, setPreference] = useState<WaveThemePreference>();

  useEffect(() => {
    let cancelled = false;
    void loadThemePreference().then((stored) => {
      if (!cancelled) setPreference(stored);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const update = (partial: Partial<WaveThemePreference>) => {
    setPreference((previous) => {
      const next = { ...(previous ?? DEFAULT_THEME_PREFERENCE), ...partial };
      applyThemePreference(next);
      void saveThemePreference(next);
      return next;
    });
  };

  return (
    <Card testID="appearance-card">
      <Card.Header>
        <Card.Title>Appearance</Card.Title>
        <Card.Description>
          Pick Wave&apos;s theme, and whether it runs light, dark, or follows
          this phone.
        </Card.Description>
      </Card.Header>
      <Card.Content className="gap-4">
        {preference ? (
          <>
            <RadioGroup
              testID="theme-family-picker"
              value={preference.family}
              variant="card"
              onValueChange={(value) =>
                update({ family: value as WaveThemeFamilyId })
              }>
              <RadioGroup.Item
                description="Neutral greys and moderate corners."
                label="Default"
                value="panel"
              />
              <RadioGroup.Item
                description="High contrast with an electric blue accent."
                label="Moon"
                value="moon"
              />
              <RadioGroup.Item
                description="Green accents on warm neutrals."
                label="Grass"
                value="grass"
              />
            </RadioGroup>
            <RadioGroup
              testID="theme-appearance-picker"
              value={preference.appearance}
              variant="card"
              onValueChange={(value) =>
                update({ appearance: value as WaveThemeAppearance })
              }>
              <RadioGroup.Item
                description="Follow this phone's light or dark setting."
                label="System"
                value="system"
              />
              <RadioGroup.Item label="Light" value="light" />
              <RadioGroup.Item label="Dark" value="dark" />
            </RadioGroup>
          </>
        ) : null}
      </Card.Content>
    </Card>
  );
}
