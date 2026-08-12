import { View } from 'react-native';

import { ThemedText } from '@/components/themed-text';

export function ProofRow({
  label,
  testID,
  value,
}: {
  label: string;
  testID: string;
  value: number | string;
}) {
  return (
    <View className="flex-row justify-between gap-4" testID={testID}>
      <ThemedText type="small" themeColor="textSecondary">
        {label}
      </ThemedText>
      <ThemedText type="code">{value}</ThemedText>
    </View>
  );
}
