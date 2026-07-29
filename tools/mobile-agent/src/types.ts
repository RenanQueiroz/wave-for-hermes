export type CheckStatus = 'ok' | 'warning' | 'error';

export interface Diagnostic {
  code: string;
  status: CheckStatus;
  message: string;
  recovery?: string;
}

export interface IosSimulator {
  name: string;
  udid: string;
  state: string;
  runtime: string;
  runtimeIdentifier: string;
  available: boolean;
  appInstalled: boolean;
  appContainerPath?: string;
}

export interface IosDiscovery {
  supported: boolean;
  deviceSetPath: string;
  deviceSetExists: boolean;
  simulators: IosSimulator[];
  selected?: IosSimulator;
  diagnostics: Diagnostic[];
}

export interface AndroidDevice {
  serial: string;
  state: string;
  description: string;
  appInstalled: boolean;
  appRunning: boolean;
  launchActivity?: string;
}

export interface AndroidDiscovery {
  adbPath?: string;
  devices: AndroidDevice[];
  selected?: AndroidDevice;
  diagnostics: Diagnostic[];
}

export interface InspectorTarget {
  id: string;
  title?: string;
  description?: string;
  appId?: string;
  deviceName?: string;
  webSocketDebuggerUrl?: string;
  supportsMultipleDebuggers?: boolean;
}

export interface MetroServer {
  url: string;
  port: number;
  status: string;
  targets: InspectorTarget[];
}

export interface MetroDiscovery {
  servers: MetroServer[];
  selected?: MetroServer;
  diagnostics: Diagnostic[];
}

export interface ToolchainDiscovery {
  nodeVersion: string;
  nodeSupported: boolean;
  xcodeVersion?: string;
  appiumMcpVersion?: string;
  diagnostics: Diagnostic[];
}

export interface DoctorReport {
  ok: boolean;
  readyPlatforms: MobilePlatform[];
  generatedAt: string;
  projectRoot: string;
  bundleId: string;
  androidPackage: string;
  toolchain: ToolchainDiscovery;
  ios: IosDiscovery;
  android: AndroidDiscovery;
  metro: MetroDiscovery;
}

export type MobilePlatform = 'ios' | 'android';
