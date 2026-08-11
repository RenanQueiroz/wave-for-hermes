import type { SessionModelPickerController } from '@/features/chat/composer/model/picker';
import type { ComposerColors } from '@/features/chat/composer/view.types';

export interface AttachmentSourceSheetProps {
  colors: ComposerColors;
  isPresented: boolean;
  onDismiss(): void;
  onPickFile(): void;
  onPickImage(): void;
  onTakePhoto(): void;
}

export interface ModelPickerSheetProps {
  colors: ComposerColors;
  model: SessionModelPickerController;
}
