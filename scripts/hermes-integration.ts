import { HttpHermesClient } from '../src/services/hermes/hermes-client.ts';
import { HermesClientError } from '../src/services/hermes/hermes-errors.ts';

const baseUrl = process.env.HERMES_API_URL?.trim();
const bearerToken = process.env.HERMES_API_KEY?.trim();

if (!baseUrl || !bearerToken) {
  console.error(
    'Set HERMES_API_URL and HERMES_API_KEY in the command environment. Do not put either value in the repository.',
  );
  process.exit(1);
}

const client = new HttpHermesClient({ baseUrl, bearerToken });

try {
  const capabilityReport = await client.probeCapabilities();
  if (!capabilityReport.supported) {
    console.error(
      `Unsupported Hermes API Server. Missing features: ${capabilityReport.missingFeatures.join(', ') || 'none'}; missing endpoints: ${capabilityReport.missingEndpoints.join(', ') || 'none'}.`,
    );
    process.exit(1);
  }

  const configuredSessionId = process.env.HERMES_INTEGRATION_SESSION_ID?.trim();
  const sessionId =
    configuredSessionId ??
    (
      await client.createSession({
        title: `Wave integration ${new Date().toISOString()}`,
      })
    ).id;

  let sawAssistantOutput = false;
  let sawCompletion = false;
  for await (const event of client.streamChat(sessionId, {
    input: 'Reply with exactly: Wave Hermes integration OK',
  })) {
    if (event.type === 'assistant.delta' && event.delta) {
      sawAssistantOutput = true;
    }
    if (event.type === 'run.completed' && event.completed) {
      sawCompletion = true;
    }
    if (event.type === 'error') {
      throw new HermesClientError(event.message, {
        code: 'stream_error',
        kind: 'server',
      });
    }
  }

  if (!sawAssistantOutput || !sawCompletion) {
    throw new HermesClientError('Hermes ended the integration stream without a completed reply.', {
      code: 'incomplete_integration_stream',
      kind: 'protocol',
    });
  }

  console.log(`Hermes integration passed for session ${sessionId}.`);
} catch (error) {
  if (error instanceof HermesClientError) {
    console.error(`Hermes integration failed (${error.kind}/${error.code ?? 'unknown'}): ${error.message}`);
  } else {
    console.error('Hermes integration failed with an unexpected local error.');
  }
  process.exit(1);
}
