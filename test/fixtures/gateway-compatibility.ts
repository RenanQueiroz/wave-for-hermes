/**
 * Sanitized structural fixtures for the Hermes gateway compatibility floor.
 *
 * Every identifier and text value below is synthetic. These fixtures contain
 * no captured gateway URL, credential, conversation payload, or real session
 * identifier.
 */
export const GATEWAY_V019_FIXTURE = {
  activeList: {
    sessions: [
      {
        id: 'live-working',
        session_key: 'stored-working',
        status: 'working',
      },
      { id: 'live-idle', session_key: 'stored-idle', status: 'idle' },
    ],
  },
  gatewayReady: {
    payload: { skin: {} },
    type: 'gateway.ready',
  },
  status: { version: '0.19.0' },
} as const;

export const GATEWAY_V020_FIXTURE = {
  activeList: {
    sessions: [
      {
        id: 'live-starting',
        session_key: 'stored-starting',
        status: 'starting',
      },
      {
        id: 'live-working',
        session_key: 'stored-working',
        status: 'working',
      },
      {
        id: 'live-waiting',
        session_key: 'stored-waiting',
        status: 'waiting',
      },
      { id: 'live-idle', session_key: 'stored-idle', status: 'idle' },
    ],
  },
  gatewayReady: {
    payload: { change_events: true, skin: {} },
    type: 'gateway.ready',
  },
  redirectResults: [
    { status: 'redirected' },
    { status: 'queued' },
    { status: 'rejected' },
  ],
  sessionRow: {
    id: 'stored-session',
    pinned: true,
    source: 'fixture',
  },
  speakStreamControlFrames: [
    { channels: 1, sample_rate: 24_000, type: 'start' },
    { type: 'fallback' },
    { type: 'end' },
  ],
  status: { release_date: 'fixture-date', version: '0.20.0' },
  turnFrames: [
    {
      payload: {},
      type: 'message.interim',
    },
    {
      payload: {},
      type: 'tool.progress',
    },
    {
      payload: {},
      type: 'status.update',
    },
  ],
} as const;
