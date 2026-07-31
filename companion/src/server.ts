import { buildCompanionServer } from './app.ts';
import { CompanionConfigError, loadCompanionConfig } from './config.ts';
import { createCompanionLoggerOptions } from './logging.ts';

async function main() {
  const config = loadCompanionConfig();
  const app = buildCompanionServer(config, {
    logger: createCompanionLoggerOptions(
      process.env.WAVE_LOG_LEVEL?.trim() || 'info',
    ),
  });

  const stop = async (signal: NodeJS.Signals) => {
    app.log.info({ signal }, 'Wave Companion shutting down');
    await app.close();
  };

  process.once('SIGINT', () => void stop('SIGINT'));
  process.once('SIGTERM', () => void stop('SIGTERM'));

  await app.listen({
    host: config.host,
    port: config.port,
  });
}

try {
  await main();
} catch (error) {
  if (error instanceof CompanionConfigError) {
    console.error(error.message);
  } else {
    console.error('Wave Companion failed to start.');
  }
  process.exitCode = 1;
}
