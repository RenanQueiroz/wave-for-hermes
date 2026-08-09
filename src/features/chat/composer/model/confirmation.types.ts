import type { ReactNode } from 'react';

export interface NativeModelConfirmationProps {
  children: ReactNode;
  isPresented: boolean;
  message?: string;
  onCancel(): void;
  onConfirm(): void;
}
