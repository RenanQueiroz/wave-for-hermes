/**
 * Rows for native `FieldGroup.Section` forms (Android implementation).
 *
 * Android's `FieldGroup.Section` wraps every row child in a Material 3
 * `ListItem` surface of its own, so rows must be plain Compose layout —
 * nesting a universal `ListItem` here draws a second bordered container
 * (validated on the emulator). This mirrors the M3 list-item text styles.
 */
import {
  Column as ComposeColumn,
  Row as ComposeRow,
  Text as ComposeText,
  useMaterialColors,
} from '@expo/ui/jetpack-compose';
import {
  clickable,
  fillMaxWidth,
  testID as testIDModifier,
  weight,
} from '@expo/ui/jetpack-compose/modifiers';
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
  const colors = useMaterialColors();
  const modifiers = [
    fillMaxWidth(),
    ...(onPress ? [clickable(onPress)] : []),
    ...(testID ? [testIDModifier(testID)] : []),
  ];
  return (
    <ComposeRow
      horizontalArrangement={{ spacedBy: 16 }}
      modifiers={modifiers}
      verticalAlignment="center">
      <ComposeColumn
        modifiers={[weight(1)]}
        verticalArrangement={{ spacedBy: 2 }}>
        <ComposeText
          color={colors.onSurface}
          style={{ typography: 'bodyLarge' }}>
          {children}
        </ComposeText>
        {supportingText ? (
          <ComposeText
            color={colors.onSurfaceVariant}
            style={{ typography: 'bodyMedium' }}>
            {supportingText}
          </ComposeText>
        ) : null}
      </ComposeColumn>
      {trailing}
    </ComposeRow>
  );
}

export interface FormPickerRowProps {
  /** Row label shown on iOS; Android lets the section title carry it. */
  label: string;
  /** The `Picker` element. */
  children: ReactNode;
}

/**
 * On Android the Material exposed dropdown has no compact anchor, so the
 * picker takes the full row and the section title carries the label.
 */
export function FormPickerRow({ children }: FormPickerRowProps) {
  return <>{children}</>;
}

/**
 * Text for a `FieldGroup.SectionFooter`. The footer slot renders outside any
 * `ListItem`, where Compose text has no themed content color and falls back
 * to black — set the muted theme color explicitly.
 */
export function FormFooterText({ children }: { children: string }) {
  const colors = useMaterialColors();
  return (
    <ComposeText
      color={colors.onSurfaceVariant}
      style={{ typography: 'bodyMedium' }}>
      {children}
    </ComposeText>
  );
}
