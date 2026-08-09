import { Redirect } from 'expo-router';
import { Typography } from 'panelui-native';
import { ScrollView, View } from 'react-native';

import { PcmPlaybackProofCard } from '@/dev/pcm-playback-proof-card';
import { RealtimeHarnessCard } from '@/dev/realtime-harness-card';
import { WebRtcProofCard } from '@/dev/webrtc-proof-card';

export function DevelopmentScreen() {
  if (!__DEV__) {
    return <Redirect href="/" />;
  }

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentInsetAdjustmentBehavior="automatic"
      contentContainerClassName="mx-auto w-full max-w-xl gap-5 px-5 py-6">
      <View className="gap-1">
        <Typography.Heading type="h3">Native proofs</Typography.Heading>
        <Typography.Paragraph muted>
          Development-only checks for native foundations used by Wave.
        </Typography.Paragraph>
      </View>
      <PcmPlaybackProofCard />
      <WebRtcProofCard />
      <RealtimeHarnessCard />
    </ScrollView>
  );
}
