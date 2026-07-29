import type { Diagnostic, DoctorReport } from './types.js';

export function formatDoctor(report: DoctorReport): string {
  const lines = [
    `Wave mobile-agent doctor: ${report.ok ? 'READY' : 'NOT READY'}`,
    `Ready platforms: ${report.readyPlatforms.length > 0 ? report.readyPlatforms.join(', ') : 'none'}`,
    `Project: ${report.projectRoot}`,
    `iOS bundle: ${report.bundleId}`,
    `Android package: ${report.androidPackage}`,
    '',
    'Toolchain',
    ...formatDiagnostics(report.toolchain.diagnostics),
    '',
    'iOS / Radon',
    `  Device set: ${report.ios.deviceSetPath}`,
    ...formatDiagnostics(report.ios.diagnostics),
    '',
    'Android',
    ...formatDiagnostics(report.android.diagnostics),
    '',
    'Metro / Hermes',
    ...formatDiagnostics(report.metro.diagnostics),
  ];
  return lines.join('\n');
}

function formatDiagnostics(diagnostics: Diagnostic[]): string[] {
  return diagnostics.flatMap((diagnostic) => {
    const marker = diagnostic.status === 'ok' ? '✓' : diagnostic.status === 'warning' ? '!' : '✗';
    return [
      `  ${marker} [${diagnostic.code}] ${diagnostic.message}`,
      ...(diagnostic.recovery ? [`    Recovery: ${diagnostic.recovery}`] : []),
    ];
  });
}
