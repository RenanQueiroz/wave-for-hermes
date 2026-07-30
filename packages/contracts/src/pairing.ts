import { z } from 'zod';

import {
  WaveIdentifierSchema,
  WaveIsoDateTimeSchema,
  WaveResponseMetadataSchema,
} from './common.ts';

export const WAVE_DEVICE_CREDENTIAL_PREFIX = 'wave_device_' as const;

export const WaveDeviceNameSchema = z.string().trim().min(1).max(80);
export const WavePairingCodeSchema = z
  .string()
  .trim()
  .min(16)
  .max(32)
  .regex(/^[A-Za-z2-9-]+$/);
export const WaveDeviceCredentialSchema = z
  .string()
  .regex(/^wave_device_[A-Za-z0-9_-]{43}$/);

export const WaveDeviceSchema = z
  .object({
    createdAt: WaveIsoDateTimeSchema,
    id: WaveIdentifierSchema,
    name: WaveDeviceNameSchema,
  })
  .strict();

export const WaveRedeemPairingRequestSchema = z
  .object({
    code: WavePairingCodeSchema,
    deviceName: WaveDeviceNameSchema,
  })
  .strict();

export const WaveRedeemPairingResponseSchema =
  WaveResponseMetadataSchema.extend({
    credential: WaveDeviceCredentialSchema,
    device: WaveDeviceSchema,
  }).strict();

export type WaveDevice = z.infer<typeof WaveDeviceSchema>;
export type WaveRedeemPairingRequest = z.infer<
  typeof WaveRedeemPairingRequestSchema
>;
export type WaveRedeemPairingResponse = z.infer<
  typeof WaveRedeemPairingResponseSchema
>;
