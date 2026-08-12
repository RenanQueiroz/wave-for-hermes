import { Button, Card } from 'panelui-native';
import { useCallback, useRef, useState } from 'react';
import { Modal, StyleSheet, View } from 'react-native';

import { TravelingRecedeSplash } from '@/components/animated-icon';

export function SplashAnimationProofCard() {
  const [previewKey, setPreviewKey] = useState(0);
  const [previewVisible, setPreviewVisible] = useState(false);
  const [started, setStarted] = useState(false);
  const markDisplayed = useRef(false);

  const showPreview = useCallback(() => {
    markDisplayed.current = false;
    setStarted(false);
    setPreviewKey((value) => value + 1);
    setPreviewVisible(true);
  }, []);

  const hidePreview = useCallback(() => setPreviewVisible(false), []);

  const handleMarkDisplayed = useCallback(() => {
    if (markDisplayed.current) return;
    markDisplayed.current = true;
    setStarted(true);
  }, []);

  if (!__DEV__) return null;

  return (
    <>
      <Card testID="splash-animation-proof-card">
        <Card.Header>
          <Card.Title>Splash animation</Card.Title>
          <Card.Description>
            Replays the full-screen Traveling Recede transition. The preview
            follows the device&apos;s Reduce Motion setting.
          </Card.Description>
        </Card.Header>
        <Card.Footer>
          <Button
            fullWidth
            accessibilityLabel="Replay the Wave splash animation"
            testID="splash-animation-replay"
            onPress={showPreview}>
            Replay full screen
          </Button>
        </Card.Footer>
      </Card>

      <Modal
        animationType="none"
        navigationBarTranslucent
        onRequestClose={hidePreview}
        presentationStyle="fullScreen"
        statusBarTranslucent
        visible={previewVisible}>
        <View style={styles.preview}>
          {previewVisible ? (
            <TravelingRecedeSplash
              key={previewKey}
              onFinished={hidePreview}
              onMarkDisplayed={handleMarkDisplayed}
              start={started}
              testID="splash-animation-preview"
            />
          ) : null}
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  preview: {
    flex: 1,
    backgroundColor: '#090909',
  },
});
