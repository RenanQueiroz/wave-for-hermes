import { Button, Image, Menu } from '@expo/ui/swift-ui';
import {
  accessibilityIdentifier,
  accessibilityLabel,
  background,
  buttonStyle,
  contentShape,
  disabled as disabledModifier,
  frame,
  opacity,
  shapes,
} from '@expo/ui/swift-ui/modifiers';

import { NATIVE_ICON_BUTTON_SIZE } from '@/components/native-icon-button/button.types';
import type { AttachmentMenuProps } from '@/features/chat/composer/attachment-menu.types';
import { CHAT_COMPOSER_ICONS } from '@/features/chat/composer/icons';

/**
 * The composer's attachment entry point: a SwiftUI `Menu` anchored to the +
 * button itself, styled to match the other composer icon buttons. Menu item
 * actions fire after the menu dismisses natively, so pickers never race the
 * menu's own teardown.
 */
export function AttachmentMenu({
  colors,
  disabled,
  onPickFile,
  onPickImage,
  onTakePhoto,
}: AttachmentMenuProps) {
  return (
    <Menu
      // The tonal circle is painted on the label itself rather than via a
      // tinted borderedProminent trigger: a tint on the Menu propagates into
      // the presented menu, rendering its item symbols in the dark secondary
      // color — nearly invisible on the menu surface.
      label={
        <Image
          color={colors.secondaryForeground}
          size={19}
          systemName={CHAT_COMPOSER_ICONS.add}
          modifiers={[
            frame({
              height: NATIVE_ICON_BUTTON_SIZE,
              width: NATIVE_ICON_BUTTON_SIZE,
            }),
            background(colors.secondary, shapes.circle()),
          ]}
        />
      }
      modifiers={[
        buttonStyle('plain'),
        frame({
          height: NATIVE_ICON_BUTTON_SIZE,
          width: NATIVE_ICON_BUTTON_SIZE,
        }),
        contentShape(shapes.circle()),
        accessibilityLabel('Add an attachment'),
        accessibilityIdentifier('chat-attachment-button'),
        disabledModifier(disabled),
        opacity(disabled ? 0.45 : 1),
      ]}>
      <Button
        label="Take Photo"
        systemImage={CHAT_COMPOSER_ICONS.camera}
        onPress={onTakePhoto}
        modifiers={[
          accessibilityLabel('Take a photo'),
          accessibilityIdentifier('attachment-source-camera'),
        ]}
      />
      <Button
        label="Photo Library"
        systemImage={CHAT_COMPOSER_ICONS.photos}
        onPress={onPickImage}
        modifiers={[
          accessibilityLabel('Choose a photo'),
          accessibilityIdentifier('attachment-source-photos'),
        ]}
      />
      <Button
        label="Attach File"
        systemImage={CHAT_COMPOSER_ICONS.paperclip}
        onPress={onPickFile}
        modifiers={[
          accessibilityLabel('Choose a text file'),
          accessibilityIdentifier('attachment-source-files'),
        ]}
      />
    </Menu>
  );
}
