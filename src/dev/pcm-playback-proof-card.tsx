import { Alert, Button, Card } from 'panelui-native';
import { useEffect, useState } from 'react';
import { AppState, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { registerMobileAgentStateProvider } from '@/dev/mobile-agent-state';
import {
  PcmPlaybackProof,
  type PcmPlaybackProofState,
} from '@/dev/pcm-playback-proof';

const RUNNING_PHASES = new Set<PcmPlaybackProofState['phase']>([
  'cancelling',
  'draining',
  'restarting',
  'streaming',
]);

export function PcmPlaybackProofCard() {
  const [proof] = useState(() => new PcmPlaybackProof());
  const [state, setState] = useState(proof.getState);
  const running = RUNNING_PHASES.has(state.phase);

  useEffect(() => {
    const unsubscribe = proof.subscribe(setState);
    const unregisterState = registerMobileAgentStateProvider({
      name: 'pcm-playback-proof',
      read: proof.getState,
    });
    const appStateSubscription = AppState.addEventListener(
      'change',
      (nextState) => {
        if (nextState === 'background') proof.stop();
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
    <Card testID="pcm-playback-proof-card">
      <Card.Header>
        <Card.Title>Streaming PCM playback proof</Card.Title>
        <Card.Description>
          Plays three contiguous tones from 20 ms Int16 chunks, drains them,
          restarts at a new sample rate, and cancels immediately.
        </Card.Description>
      </Card.Header>

      <Card.Content className="gap-1">
        <ProofRow label="Phase" testID="pcm-proof-phase" value={state.phase} />
        <ProofRow
          label="First chunk"
          testID="pcm-proof-first-chunk"
          value={
            state.firstChunkLatencyMs === undefined
              ? 'pending'
              : `${state.firstChunkLatencyMs} ms`
          }
        />
        <ProofRow
          label="Drained frames"
          testID="pcm-proof-drained-frames"
          value={`${state.drainedFrames} / ${state.expectedFrames}`}
        />
        <ProofRow
          label="Format restart"
          testID="pcm-proof-format-restart"
          value={state.formatRestart}
        />
        <ProofRow
          label="Cancellation"
          testID="pcm-proof-cancellation"
          value={state.cancellation}
        />

        {state.phase === 'passed' ? (
          <View className="pt-3">
            <Alert variant="success" testID="pcm-proof-success">
              <Alert.Indicator />
              <Alert.Content>
                <Alert.Title>Native checks passed</Alert.Title>
                <Alert.Description>
                  Confirm the tones rose cleanly with no clicks, gaps, or
                  lingering final tone.
                </Alert.Description>
              </Alert.Content>
            </Alert>
          </View>
        ) : null}

        {state.error ? (
          <View className="pt-3">
            <Alert variant="destructive" testID="pcm-proof-error">
              <Alert.Indicator />
              <Alert.Content>
                <Alert.Title>Proof failed</Alert.Title>
                <Alert.Description>{state.error}</Alert.Description>
              </Alert.Content>
            </Alert>
          </View>
        ) : null}
      </Card.Content>

      <Card.Footer>
        <View
          className={state.phase === 'passed' ? 'flex-1 opacity-50' : 'flex-1'}>
          <Button
            fullWidth
            accessibilityLabel="Start streaming PCM playback proof"
            disabled={state.phase === 'passed'}
            loading={running}
            testID="pcm-proof-start"
            onPress={() => void proof.start()}>
            {running
              ? 'Running…'
              : state.phase === 'failed'
                ? 'Retry'
                : 'Start proof'}
          </Button>
        </View>
        <View
          className={state.phase === 'idle' ? 'flex-1 opacity-50' : 'flex-1'}>
          <Button
            fullWidth
            accessibilityLabel="Stop streaming PCM playback proof"
            disabled={state.phase === 'idle'}
            testID="pcm-proof-stop"
            variant="outline"
            onPress={() => proof.stop()}>
            Stop
          </Button>
        </View>
      </Card.Footer>
    </Card>
  );
}

function ProofRow({
  label,
  testID,
  value,
}: {
  label: string;
  testID: string;
  value: number | string;
}) {
  return (
    <View className="flex-row justify-between gap-4" testID={testID}>
      <ThemedText type="small" themeColor="textSecondary">
        {label}
      </ThemedText>
      <ThemedText type="code">{value}</ThemedText>
    </View>
  );
}
