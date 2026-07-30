import { buildCompanionServer } from './app.ts';
import { CompanionConfigError, loadCompanionConfig } from './config.ts';

async function main() {
  const config = loadCompanionConfig();
  const app = buildCompanionServer(config, {
    logger: {
      level: process.env.WAVE_LOG_LEVEL?.trim() || 'info',
      redact: {
        censor: '[REDACTED]',
        paths: [
          'req.headers.authorization',
          'req.headers.cookie',
          'request.headers.authorization',
          'request.headers.cookie',
        ],
      },
    },
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
