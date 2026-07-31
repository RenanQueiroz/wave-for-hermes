import { loadCompanionStorageConfig } from './config.ts';
import { SqliteDeviceStore } from './auth/sqlite-device-store.ts';

const [command, argument, ...extraArguments] = process.argv.slice(2);
if (!command || extraArguments.length > 0) {
  printUsageAndExit();
}

const config = loadCompanionStorageConfig();
const store = new SqliteDeviceStore(config.databasePath);

try {
  switch (command) {
    case 'pair': {
      if (argument) {
        printUsageAndExit();
      }
      const expiresAt = new Date(
        Date.now() + config.pairingCodeTtlSeconds * 1_000,
      );
      const pairing = store.issuePairingCode(expiresAt);
      console.log(`Pairing code: ${pairing.code}`);
      console.log(`Expires at: ${pairing.expiresAt}`);
      break;
    }
    case 'devices': {
      if (argument) {
        printUsageAndExit();
      }
      console.log(JSON.stringify(store.listDevices(), null, 2));
      break;
    }
    case 'revoke': {
      if (!argument) {
        printUsageAndExit();
      }
      if (!store.revokeDevice(argument)) {
        console.error('No active Wave device matched that ID.');
        process.exitCode = 1;
      } else {
        console.log(`Revoked Wave device ${argument}.`);
      }
      break;
    }
    default:
      printUsageAndExit();
  }
} finally {
  store.close();
}

function printUsageAndExit(): never {
  console.error('Usage: admin.js pair | devices | revoke <device-id>');
  process.exit(1);
}
