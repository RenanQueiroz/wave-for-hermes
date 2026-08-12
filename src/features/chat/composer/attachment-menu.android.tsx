import {
  DropdownMenu,
  DropdownMenuItem,
  FilledTonalIconButton,
  Icon,
  Text,
} from '@expo/ui/jetpack-compose';
import {
  size,
  testID as testIDModifier,
} from '@expo/ui/jetpack-compose/modifiers';
import { useState } from 'react';
import type { ImageSourcePropType } from 'react-native';

import { NATIVE_ICON_BUTTON_SIZE } from '@/components/native-icon-button/button.types';
import type { AttachmentMenuProps } from '@/features/chat/composer/attachment-menu.types';
import { CHAT_COMPOSER_ICONS } from '@/features/chat/composer/icons';

/**
 * The composer's attachment entry point: a Compose `DropdownMenu` anchored to
 * the + button, following the drawer rows' device-validated trigger wiring
 * (trigger button sets React state, `onDismissRequest` clears it).
 */
export function AttachmentMenu({
  colors,
  disabled,
  onPickFile,
  onPickImage,
  onTakePhoto,
}: AttachmentMenuProps) {
  const [open, setOpen] = useState(false);

  const item = (
    testID: string,
    label: string,
    contentDescription: string,
    icon: ImageSourcePropType,
    action: () => void,
  ) => (
    <DropdownMenuItem
      elementColors={{ textColor: colors.foreground }}
      modifiers={[testIDModifier(testID)]}
      onClick={() => {
        setOpen(false);
        action();
      }}>
      <DropdownMenuItem.LeadingIcon>
        <Icon
          contentDescription={contentDescription}
          size={18}
          source={icon}
          tint={colors.mutedForeground}
        />
      </DropdownMenuItem.LeadingIcon>
      <DropdownMenuItem.Text>
        <Text color={colors.foreground}>{label}</Text>
      </DropdownMenuItem.Text>
    </DropdownMenuItem>
  );

  return (
    <DropdownMenu
      color={colors.card}
      expanded={open}
      onDismissRequest={() => setOpen(false)}>
      <DropdownMenu.Trigger>
        <FilledTonalIconButton
          colors={{
            containerColor: colors.secondary,
            contentColor: colors.secondaryForeground,
            disabledContentColor: colors.secondaryForeground,
          }}
          enabled={!disabled}
          modifiers={[
            size(NATIVE_ICON_BUTTON_SIZE, NATIVE_ICON_BUTTON_SIZE),
            testIDModifier('chat-attachment-button'),
          ]}
          onClick={disabled ? undefined : () => setOpen(true)}>
          <Icon
            contentDescription="Add an attachment"
            source={CHAT_COMPOSER_ICONS.add as ImageSourcePropType}
            size={20}
            tint={colors.secondaryForeground}
          />
        </FilledTonalIconButton>
      </DropdownMenu.Trigger>
      <DropdownMenu.Items>
        {item(
          'attachment-source-camera',
          'Take Photo',
          'Take a photo',
          CHAT_COMPOSER_ICONS.camera as ImageSourcePropType,
          onTakePhoto,
        )}
        {item(
          'attachment-source-photos',
          'Photo Library',
          'Choose a photo',
          CHAT_COMPOSER_ICONS.photos as ImageSourcePropType,
          onPickImage,
        )}
        {item(
          'attachment-source-files',
          'Attach File',
          'Choose a text file',
          CHAT_COMPOSER_ICONS.paperclip as ImageSourcePropType,
          onPickFile,
        )}
      </DropdownMenu.Items>
    </DropdownMenu>
  );
}
