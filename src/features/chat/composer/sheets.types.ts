import type { SessionModelPickerController } from '@/features/chat/composer/model/picker';
import type { ComposerColors } from '@/features/chat/composer/view.types';

export interface ModelPickerSheetProps {
  /** The app's resolved appearance, so native sheet controls match a forced theme. */
  colorScheme: 'light' | 'dark';
  colors: ComposerColors;
  model: SessionModelPickerController;
}
