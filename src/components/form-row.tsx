/**
 * Rows for native `FieldGroup.Section` forms (iOS/default implementation).
 *
 * On iOS a universal `ListItem` renders the native SwiftUI row directly. On
 * Android (see form-row.android.tsx) the section wrapper already provides the
 * Material `ListItem` surface, so rows are built from Compose layout
 * primitives instead — nesting another `ListItem` would draw a second
 * container.
 */
import { ListItem, Text } from '@expo/ui';
import type { ReactNode } from 'react';

export interface FormRowProps {
  /** Headline text of the row. */
  children: string;
  supportingText?: string;
  trailing?: ReactNode;
  onPress?: () => void;
  testID?: string;
}

export function FormRow({
  children,
  onPress,
  supportingText,
  testID,
  trailing,
}: FormRowProps) {
  return (
    <ListItem
      supportingText={supportingText}
      testID={testID}
      trailing={trailing}
      onPress={onPress}>
      {children}
    </ListItem>
  );
}

export interface FormPickerRowProps {
  /** Row label shown on iOS; Android lets the section title carry it. */
  label: string;
  /** The `Picker` element. */
  children: ReactNode;
}

/**
 * A single-choice picker row. iOS shows a labeled row with the compact menu
 * picker trailing; Android renders the Material exposed-dropdown full-width
 * (it has no compact form), so the label is dropped there.
 */
export function FormPickerRow({ children, label }: FormPickerRowProps) {
  return <ListItem trailing={children}>{label}</ListItem>;
}

/**
 * Text for a `FieldGroup.SectionFooter`. SwiftUI's `Form` styles footer text
 * natively on iOS; Android needs the muted theme color set explicitly (a bare
 * Compose text outside a `ListItem` defaults to black — validated on the
 * emulator in dark mode).
 */
export function FormFooterText({ children }: { children: string }) {
  return <Text>{children}</Text>;
}
