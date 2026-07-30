export interface AuthenticatedDevice {
  createdAt: string;
  id: string;
  name: string;
}

export interface DeviceRecord extends AuthenticatedDevice {
  lastUsedAt?: string;
  revokedAt?: string;
}

export interface IssuedPairingCode {
  code: string;
  expiresAt: string;
}

export interface RedeemedDevice {
  credential: string;
  device: AuthenticatedDevice;
}

export interface DeviceStore {
  authenticateDevice(credential: string): AuthenticatedDevice | undefined;
  bindSession(deviceId: string, sessionId: string): void;
  close(): void;
  hasSession(deviceId: string, sessionId: string): boolean;
  isDeviceActive(deviceId: string): boolean;
  issuePairingCode(expiresAt: Date): IssuedPairingCode;
  listDevices(): DeviceRecord[];
  listSessionIds(deviceId: string): string[];
  redeemPairingCode(
    code: string,
    deviceName: string,
  ): RedeemedDevice | undefined;
  revokeDevice(deviceId: string): boolean;
}
