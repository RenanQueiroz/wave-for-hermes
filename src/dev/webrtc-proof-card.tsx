import { Alert, Button, Card } from 'panelui-native';
import { useEffect, useState } from 'react';
import { AppState } from 'react-native';

import { registerMobileAgentStateProvider } from '@/dev/mobile-agent-state';
import { ProofRow } from '@/dev/proof-row';
import {
  WebRtcAudioLoopbackProof,
  type WebRtcProofState,
} from '@/dev/webrtc-audio-loopback';

const RUNNING_PHASES = new Set<WebRtcProofState['phase']>([
  'negotiating',
  'requesting-permission',
  'verifying',
]);

export function WebRtcProofCard() {
  const [proof] = useState(() => new WebRtcAudioLoopbackProof());
  const [state, setState] = useState(proof.getState);
  const running = RUNNING_PHASES.has(state.phase);

  useEffect(() => {
    const unsubscribe = proof.subscribe(setState);
    const unregisterState = registerMobileAgentStateProvider({
      name: 'webrtc-proof',
      read: proof.getState,
    });
    const appStateSubscription = AppState.addEventListener(
      'change',
      (nextState) => {
        const requestingPermission =
          proof.getState().phase === 'requesting-permission';
        if (nextState === 'background' && !requestingPermission) {
          proof.stop();
        }
      },
    );

    return () => {
      appStateSubscription.remove();
      unregisterState();
      unsubscribe();
      proof.stop();
    };
  }, [proof]);

  if (!__DEV__) return null;

  return (
    <Card testID="webrtc-proof-card">
      <Card.Header>
        <Card.Title>WebRTC audio proof</Card.Title>
        <Card.Description>
          Creates two local peers, sends a microphone track, and verifies a
          data-channel echo.
        </Card.Description>
      </Card.Header>

      <Card.Content className="gap-1">
        <ProofRow
          label="Phase"
          testID="webrtc-proof-phase"
          value={state.phase}
        />
        <ProofRow
          label="Microphone tracks"
          testID="webrtc-proof-local-tracks"
          value={state.localAudioTracks}
        />
        <ProofRow
          label="Remote audio tracks"
          testID="webrtc-proof-remote-tracks"
          value={state.remoteAudioTracks}
        />
        <ProofRow
          label="Data echo"
          testID="webrtc-proof-data-echo"
          value={state.dataEchoReceived ? 'received' : 'pending'}
        />
        <ProofRow
          label="Peers"
          testID="webrtc-proof-peer-states"
          value={`${state.callerConnectionState} / ${state.receiverConnectionState}`}
        />

        {state.error ? (
          <Alert
            className="mt-3"
            variant="destructive"
            testID="webrtc-proof-error">
            <Alert.Indicator />
            <Alert.Content>
              <Alert.Title>Proof failed</Alert.Title>
              <Alert.Description>{state.error}</Alert.Description>
            </Alert.Content>
          </Alert>
        ) : null}
      </Card.Content>

      <Card.Footer>
        <Button
          accessibilityLabel="Start WebRTC audio proof"
          className="flex-1"
          disabled={state.phase === 'passed'}
          loading={running}
          testID="webrtc-proof-start"
          onPress={() => void proof.start()}>
          {running
            ? 'Running…'
            : state.phase === 'failed'
              ? 'Retry'
              : 'Start proof'}
        </Button>
        <Button
          accessibilityLabel="Stop WebRTC audio proof"
          className="flex-1"
          disabled={state.phase === 'idle'}
          testID="webrtc-proof-stop"
          variant="outline"
          onPress={() => proof.stop()}>
          Stop
        </Button>
      </Card.Footer>
    </Card>
  );
}
