import {
  WAVE_MAX_IMAGE_ATTACHMENT_BYTES,
  WAVE_MAX_TEXT_ATTACHMENT_CHARS,
  WAVE_MAX_TURN_ATTACHMENTS,
  type WaveTurnInputPart,
} from '@wave/contracts';
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';

type AttachmentPart = Extract<
  WaveTurnInputPart,
  { type: 'image' | 'text_file' }
>;

export interface PendingChatAttachment {
  description: string;
  id: string;
  part: AttachmentPart;
}

const TEXT_FILE_MIME_TYPES = [
  'application/javascript',
  'application/json',
  'application/toml',
  'application/xml',
  'application/x-httpd-php',
  'application/x-sh',
  'application/x-yaml',
  'text/*',
];
const TEXT_FILE_EXTENSIONS = new Set([
  'c',
  'conf',
  'cpp',
  'css',
  'csv',
  'env',
  'go',
  'h',
  'html',
  'ini',
  'java',
  'js',
  'json',
  'jsx',
  'kt',
  'log',
  'md',
  'mjs',
  'py',
  'rb',
  'rs',
  'sh',
  'sql',
  'swift',
  'toml',
  'ts',
  'tsx',
  'txt',
  'xml',
  'yaml',
  'yml',
]);
const MAX_TEXT_FILE_BYTES = WAVE_MAX_TEXT_ATTACHMENT_CHARS * 4;

export function useChatAttachments() {
  const [attachments, setAttachments] = useState<PendingChatAttachment[]>([]);
  const [error, setError] = useState<string>();
  const idRef = useRef(0);
  const attachmentsRef = useRef(attachments);

  useEffect(() => {
    attachmentsRef.current = attachments;
  }, [attachments]);

  const addPart = useCallback((part: AttachmentPart, description: string) => {
    if (attachmentsRef.current.length >= WAVE_MAX_TURN_ATTACHMENTS) {
      setError(
        `You can attach up to ${WAVE_MAX_TURN_ATTACHMENTS} files to one message.`,
      );
      return;
    }
    idRef.current += 1;
    const next = [
      ...attachmentsRef.current,
      {
        description,
        id: `${Date.now()}-${idRef.current}`,
        part,
      },
    ];
    attachmentsRef.current = next;
    setAttachments(next);
    setError(undefined);
  }, []);

  const addImageResult = useCallback(
    (result: ImagePicker.ImagePickerResult) => {
      if (result.canceled) return;
      const asset = result.assets[0];
      if (!asset?.base64) {
        setError('Wave could not read that image.');
        return;
      }
      const size = decodedBase64Size(asset.base64);
      if (size <= 0 || size > WAVE_MAX_IMAGE_ATTACHMENT_BYTES) {
        setError(
          `Images must be smaller than ${formatBytes(WAVE_MAX_IMAGE_ATTACHMENT_BYTES)}.`,
        );
        return;
      }
      addPart(
        {
          dataUrl: `data:image/jpeg;base64,${asset.base64}`,
          mimeType: 'image/jpeg',
          name: normalizeAttachmentName(
            asset.fileName ?? `wave-image-${Date.now()}.jpg`,
          ),
          type: 'image',
        },
        `${formatBytes(size)} · Image`,
      );
    },
    [addPart],
  );

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    void ImagePicker.getPendingResultAsync().then((result) => {
      if (!result) return;
      if ('code' in result) {
        setError(result.message || 'Wave could not recover the image picker.');
        return;
      }
      addImageResult(result);
    });
  }, [addImageResult]);

  const takePhoto = useCallback(async () => {
    setError(undefined);
    try {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) {
        setError('Camera access is required to take a photo.');
        return;
      }
      addImageResult(
        await ImagePicker.launchCameraAsync({
          base64: true,
          mediaTypes: ['images'],
          quality: 0.8,
        }),
      );
    } catch {
      setError('Wave could not open the camera.');
    }
  }, [addImageResult]);

  const pickImage = useCallback(async () => {
    setError(undefined);
    try {
      addImageResult(
        await ImagePicker.launchImageLibraryAsync({
          allowsMultipleSelection: false,
          base64: true,
          mediaTypes: ['images'],
          quality: 0.8,
        }),
      );
    } catch {
      setError('Wave could not open the photo library.');
    }
  }, [addImageResult]);

  const pickFile = useCallback(async () => {
    setError(undefined);
    let result: DocumentPicker.DocumentPickerResult;
    try {
      result = await DocumentPicker.getDocumentAsync({
        copyToCacheDirectory: true,
        multiple: false,
        type: '*/*',
      });
    } catch {
      setError('Wave could not open the file picker.');
      return;
    }
    if (result.canceled) return;
    const asset = result.assets[0];
    if (!asset || !isSupportedTextAsset(asset.name, asset.mimeType)) {
      setError(
        'Wave currently supports text, code, JSON, CSV, XML, and Markdown files.',
      );
      return;
    }
    if (asset.size !== undefined && asset.size > MAX_TEXT_FILE_BYTES) {
      setError(
        `Text files must contain at most ${WAVE_MAX_TEXT_ATTACHMENT_CHARS.toLocaleString()} characters.`,
      );
      return;
    }
    try {
      const text = await new File(asset.uri).text();
      if (
        !text ||
        text.length > WAVE_MAX_TEXT_ATTACHMENT_CHARS ||
        !looksLikeText(text)
      ) {
        setError(
          `Files must contain readable text between 1 and ${WAVE_MAX_TEXT_ATTACHMENT_CHARS.toLocaleString()} characters.`,
        );
        return;
      }
      addPart(
        {
          mimeType: asset.mimeType ?? 'text/plain',
          name: normalizeAttachmentName(asset.name),
          text,
          type: 'text_file',
        },
        `${formatBytes(asset.size ?? text.length)} · Text`,
      );
    } catch {
      setError('Wave could not read that text file.');
    }
  }, [addPart]);

  const remove = useCallback((id: string) => {
    const next = attachmentsRef.current.filter(
      (attachment) => attachment.id !== id,
    );
    attachmentsRef.current = next;
    setAttachments(next);
  }, []);

  const clear = useCallback(() => {
    attachmentsRef.current = [];
    setAttachments([]);
    setError(undefined);
  }, []);

  return {
    attachments,
    clear,
    dismissError: () => setError(undefined),
    error,
    pickFile,
    pickImage,
    remove,
    takePhoto,
  };
}

function decodedBase64Size(value: string) {
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
  return Math.floor((value.length * 3) / 4) - padding;
}

function formatBytes(bytes: number) {
  if (bytes < 1_000) return `${bytes} B`;
  if (bytes < 1_000_000) return `${Math.ceil(bytes / 1_000)} KB`;
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

function isSupportedTextAsset(name: string, mimeType?: string) {
  if (mimeType?.startsWith('text/')) return true;
  if (
    mimeType &&
    TEXT_FILE_MIME_TYPES.some(
      (allowed) => allowed !== 'text/*' && allowed === mimeType,
    )
  ) {
    return true;
  }
  const extension = name.split('.').pop()?.toLocaleLowerCase();
  return extension ? TEXT_FILE_EXTENSIONS.has(extension) : false;
}

function looksLikeText(value: string) {
  if (value.includes('\u0000')) return false;
  const replacements = value.match(/\uFFFD/g)?.length ?? 0;
  return replacements <= Math.max(2, Math.floor(value.length / 1_000));
}

function normalizeAttachmentName(value: string) {
  const normalized = value.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return (normalized || 'attachment').slice(0, 255);
}
