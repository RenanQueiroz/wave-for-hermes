import type { ComposerColors } from '@/features/chat/composer/view.types';

/**
 * Shared contract for the platform-native attachment menus anchored to the
 * composer's + button. Each action launches its picker directly; menu
 * dismissal is native, so there is no sheet state or presentation timer.
 */
export interface AttachmentMenuProps {
  colors: ComposerColors;
  disabled: boolean;
  onPickFile(): void;
  onPickImage(): void;
  onTakePhoto(): void;
}
