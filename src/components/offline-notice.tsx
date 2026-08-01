import { Typography } from 'panelui-native';

/**
 * Quiet banner for connectivity-shaped refetch failures while cached data
 * stays on screen. Real errors keep their explicit destructive surfaces —
 * this notice must only ever accompany data the user can still read.
 */
export function OfflineNotice({
  label,
  testID,
}: {
  label: string;
  testID: string;
}) {
  return (
    <Typography.Paragraph
      muted
      className="px-4 py-1 text-center text-xs"
      testID={testID}>
      {label}
    </Typography.Paragraph>
  );
}
