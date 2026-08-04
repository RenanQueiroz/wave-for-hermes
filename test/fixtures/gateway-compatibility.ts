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
        last_active: 1_785_642_618,
        session_key: 'stored-starting',
        status: 'starting',
      },
      {
        id: 'live-working',
        last_active: 1_785_642_619,
        session_key: 'stored-working',
        status: 'working',
      },
      {
        id: 'live-waiting',
        last_active: 1_785_642_620,
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
      payload: { already_streamed: true, text: 'Synthetic interim.' },
      type: 'message.interim',
    },
    {
      payload: { name: 'search', preview: 'Synthetic progress.' },
      type: 'tool.progress',
    },
    {
      payload: { kind: 'compacting', text: 'Synthetic lifecycle.' },
      type: 'status.update',
    },
  ],
} as const;
