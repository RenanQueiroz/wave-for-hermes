import { HttpHermesClient } from './hermes/hermes-client.ts';
import { HermesClientError } from './hermes/hermes-errors.ts';

const baseUrl = process.env.HERMES_API_URL?.trim();
const bearerToken = process.env.HERMES_API_KEY?.trim();
const allowInsecureHttp =
  process.env.HERMES_ALLOW_INSECURE_HTTP === '1' ||
  process.env.HERMES_ALLOW_INSECURE_HTTP === 'true';

if (!baseUrl || !bearerToken) {
  console.error(
    'Set HERMES_API_URL and HERMES_API_KEY in the command environment. Do not put either value in the repository.',
  );
  process.exit(1);
}

const client = new HttpHermesClient({
  allowInsecureHttp,
  baseUrl,
  bearerToken,
});

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
    throw new HermesClientError(
      'Hermes ended the integration stream without a completed reply.',
      {
        code: 'incomplete_integration_stream',
        kind: 'protocol',
      },
    );
  }

  const history = await client.getSessionMessages(sessionId);
  if (
    !history.some((message) => message.role === 'user') ||
    !history.some(
      (message) => message.role === 'assistant' && message.content.trim(),
    )
  ) {
    throw new HermesClientError(
      'Hermes did not persist the completed integration turn.',
      {
        code: 'missing_integration_history',
        kind: 'protocol',
      },
    );
  }

  const cancellation = new AbortController();
  let sawCancellationStart = false;
  let cancellationConfirmed = false;
  try {
    for await (const event of client.streamChat(sessionId, {
      input: 'Write a detailed explanation of how mobile voice agents work.',
      signal: cancellation.signal,
    })) {
      if (event.type === 'run.started') {
        sawCancellationStart = true;
        cancellation.abort();
      }
    }
  } catch (error) {
    cancellationConfirmed =
      error instanceof HermesClientError && error.kind === 'cancelled';
    if (!cancellationConfirmed) throw error;
  }
  if (!sawCancellationStart || !cancellationConfirmed) {
    throw new HermesClientError(
      'Hermes did not confirm cancellation of an active integration stream.',
      {
        code: 'cancellation_not_confirmed',
        kind: 'protocol',
      },
    );
  }

  console.log(
    `Hermes integration passed for session ${sessionId}; streaming, history, and cancellation are supported.`,
  );
} catch (error) {
  if (error instanceof HermesClientError) {
    console.error(
      `Hermes integration failed (${error.kind}/${error.code ?? 'unknown'}): ${error.message}`,
    );
  } else {
    console.error('Hermes integration failed with an unexpected local error.');
  }
  process.exit(1);
}
