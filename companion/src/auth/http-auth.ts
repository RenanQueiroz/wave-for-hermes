import type {
  FastifyReply,
  FastifyRequest,
} from 'fastify';

import type {
  AuthenticatedDevice,
  DeviceStore,
} from './device-store.ts';
import { WaveHttpError } from '../http/errors.ts';

declare module 'fastify' {
  interface FastifyRequest {
    waveDevice: AuthenticatedDevice | null;
  }
}

export function createDeviceAuthenticator(store: DeviceStore) {
  return async function authenticateDevice(
    request: FastifyRequest,
    _reply: FastifyReply,
  ) {
    const authorization = request.headers.authorization;
    const match =
      typeof authorization === 'string'
        ? /^Bearer ([^\s]+)$/.exec(authorization)
        : undefined;
    const device = match?.[1]
      ? store.authenticateDevice(match[1])
      : undefined;
    if (!device) {
      throw new WaveHttpError(
        'A valid Wave device credential is required.',
        {
          code: 'unauthorized',
          statusCode: 401,
        },
      );
    }
    request.waveDevice = device;
  };
}

export function requireAuthenticatedDevice(request: FastifyRequest) {
  if (!request.waveDevice) {
    throw new WaveHttpError(
      'A valid Wave device credential is required.',
      {
        code: 'unauthorized',
        statusCode: 401,
      },
    );
  }
  return request.waveDevice;
}
