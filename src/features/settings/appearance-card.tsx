import { Card, RadioGroup } from 'panelui-native';

import {
  themeAppearancePreference,
  type WaveThemeAppearance,
} from '@/state/device-preferences';
import { useDevicePreference } from '@/state/use-device-state';

export function AppearanceCard() {
  const appearance = useDevicePreference(themeAppearancePreference);

  return (
    <Card testID="appearance-card">
      <Card.Header>
        <Card.Title>Appearance</Card.Title>
        <Card.Description>
          Run Wave light, dark, or follow this phone.
        </Card.Description>
      </Card.Header>
      <Card.Content className="gap-4">
        {appearance.hydrated ? (
          <RadioGroup
            testID="theme-appearance-picker"
            value={appearance.value}
            variant="card"
            onValueChange={(value) =>
              void themeAppearancePreference
                .set(value as WaveThemeAppearance)
                .catch(() => undefined)
            }>
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
