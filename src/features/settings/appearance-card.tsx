import { Card, RadioGroup } from 'panelui-native';
import { useEffect, useState } from 'react';

import {
  applyThemePreference,
  DEFAULT_THEME_PREFERENCE,
  loadThemePreference,
  saveThemePreference,
  type WaveThemeAppearance,
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

  const update = (appearance: WaveThemeAppearance) => {
    setPreference(() => {
      const next = { ...DEFAULT_THEME_PREFERENCE, appearance };
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
          Run Wave light, dark, or follow this phone.
        </Card.Description>
      </Card.Header>
      <Card.Content className="gap-4">
        {preference ? (
          <RadioGroup
            testID="theme-appearance-picker"
            value={preference.appearance}
            variant="card"
            onValueChange={(value) => update(value as WaveThemeAppearance)}>
            <RadioGroup.Item
              description="Follow this phone's light or dark setting."
              label="System"
              value="system"
            />
            <RadioGroup.Item label="Light" value="light" />
            <RadioGroup.Item label="Dark" value="dark" />
          </RadioGroup>
        ) : null}
      </Card.Content>
    </Card>
  );
}
