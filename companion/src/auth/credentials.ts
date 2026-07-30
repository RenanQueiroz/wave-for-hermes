import { createHash, randomBytes } from 'node:crypto';

import {
  WAVE_DEVICE_CREDENTIAL_PREFIX,
  WaveDeviceCredentialSchema,
} from '@wave/contracts';

const BASE32_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const PAIRING_CODE_BYTE_LENGTH = 10;

export function createDeviceCredential() {
  return WaveDeviceCredentialSchema.parse(
    `${WAVE_DEVICE_CREDENTIAL_PREFIX}${randomBytes(32).toString('base64url')}`,
  );
}

export function createPairingCode() {
  const bytes = randomBytes(PAIRING_CODE_BYTE_LENGTH);
  let bits = 0;
  let value = 0;
  let encoded = '';

  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      encoded += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }

  return encoded.match(/.{1,4}/g)?.join('-') ?? encoded;
}

export function normalizePairingCode(value: string) {
  return value.replace(/-/g, '').trim().toUpperCase();
}

export function hashCredential(value: string) {
  return createHash('sha256').update(value, 'utf8').digest();
}
