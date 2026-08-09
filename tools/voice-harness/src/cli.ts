/**
 * `voice-harness start [--port 8790] [--control-port 8791] [--host 127.0.0.1]`
 *
 * Binding stays loopback by default; iOS simulators reach it as
 * `http://localhost:<port>` and Android emulators as `http://10.0.2.2:<port>`
 * (both route to the host's loopback, so no LAN exposure is needed).
 */
import { startVoiceHarness } from './index.js';

function readFlag(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  return value && !value.startsWith('--') ? value : undefined;
}

const command = process.argv[2];
if (command !== 'start') {
  process.stderr.write(
    'Usage: voice-harness start [--port N] [--control-port N] [--host H]\n',
  );
  process.exit(2);
}

const port = Number.parseInt(readFlag('--port') ?? '8790', 10);
const controlPort = Number.parseInt(readFlag('--control-port') ?? '8791', 10);
const host = readFlag('--host') ?? '127.0.0.1';

const harness = await startVoiceHarness({
  controlPort,
  gatewayPort: port,
  host,
});

process.stdout.write(
  [
    `voice-harness gateway: ${harness.gatewayUrl}`,
    `voice-harness control: ${harness.controlUrl}`,
    'Sign the dev build in with any non-empty username/password.',
    'iOS simulator uses http://localhost, Android emulator uses http://10.0.2.2.',
    '',
  ].join('\n'),
);

const shutdown = () => {
  void harness.close().finally(() => process.exit(0));
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
