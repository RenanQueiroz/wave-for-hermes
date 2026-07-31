import { z } from 'zod';

import {
  WaveFeatureAvailabilitySchema,
  WaveIsoDateTimeSchema,
  WaveResponseMetadataSchema,
} from './common.ts';

const WaveDiagnosticCapabilityNameSchema = z.string().trim().min(1).max(100);

export const WaveDiagnosticsHermesSchema = z.discriminatedUnion('status', [
  z
    .object({
      status: z.literal('compatible'),
    })
    .strict(),
  z
    .object({
      missingEndpoints: z.array(WaveDiagnosticCapabilityNameSchema).max(100),
      missingFeatures: z.array(WaveDiagnosticCapabilityNameSchema).max(100),
      status: z.literal('incompatible'),
    })
    .strict(),
  z
    .object({
      status: z.literal('unreachable'),
    })
    .strict(),
]);

export const WaveDiagnosticsResponseSchema = WaveResponseMetadataSchema.extend({
  companion: z
    .object({
      serviceVersion: z
        .string()
        .trim()
        .regex(/^\d+\.\d+\.\d+$/),
      uptimeSeconds: z.number().int().nonnegative(),
    })
    .strict(),
  features: WaveFeatureAvailabilitySchema,
  generatedAt: WaveIsoDateTimeSchema,
  hermes: WaveDiagnosticsHermesSchema,
}).strict();

export type WaveDiagnosticsHermes = z.infer<typeof WaveDiagnosticsHermesSchema>;
export type WaveDiagnosticsResponse = z.infer<
  typeof WaveDiagnosticsResponseSchema
>;
