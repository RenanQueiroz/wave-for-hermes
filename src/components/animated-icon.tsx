import { Image } from 'expo-image';
import * as SplashScreen from 'expo-splash-screen';
import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  Extrapolation,
  interpolate,
  useAnimatedProps,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';
import { scheduleOnRN } from 'react-native-worklets';

const BACKGROUND_COLOR = '#090909';
const MARK_COLOR = '#ffffff';
const MARK_SIZE = 120;
const MOTION_DURATION = 520;
const MOTION_HOLD = 80;
const REDUCED_MOTION_DURATION = 160;
const WAVE_PATH_LENGTH = 782.35;
const WAVE_PATH =
  'M 91.5 115.5 C 91.5 195.5 125.5 384.5 192.5 384.5 C 237.5 384.5 231.5 256.5 263.5 256.5 C 296.5 256.5 291.5 354.5 333.5 354.5 C 378.5 354.5 408.5 255.5 408.5 187.5';

const AnimatedPath = Animated.createAnimatedComponent(Path);

type TravelingRecedeSplashProps = {
  onFinished: () => void;
  onMarkDisplayed?: () => void;
  reducedMotion?: boolean;
  start: boolean;
  testID?: string;
};

export function TravelingRecedeSplash({
  onFinished,
  onMarkDisplayed,
  reducedMotion,
  start,
  testID,
}: TravelingRecedeSplashProps) {
  const systemReducedMotion = useReducedMotion();
  const shouldReduceMotion = reducedMotion ?? systemReducedMotion;
  const progress = useSharedValue(0);

  useEffect(() => {
    cancelAnimation(progress);
    progress.value = 0;

    if (!start) return;

    const delay = shouldReduceMotion ? 0 : MOTION_HOLD;
    const duration = shouldReduceMotion
      ? REDUCED_MOTION_DURATION
      : MOTION_DURATION;

    progress.value = withDelay(
      delay,
      withTiming(
        1,
        {
          duration,
          easing: Easing.bezier(0.22, 0.61, 0.36, 1),
        },
        (finished) => {
          'worklet';
          if (finished) scheduleOnRN(onFinished);
        },
      ),
    );

    return () => cancelAnimation(progress);
  }, [onFinished, progress, shouldReduceMotion, start]);

  const backgroundStyle = useAnimatedStyle(() => ({
    opacity: shouldReduceMotion
      ? 1 - progress.value
      : interpolate(
          progress.value,
          [0, 0.66, 1],
          [1, 1, 0],
          Extrapolation.CLAMP,
        ),
  }));

  const markStyle = useAnimatedStyle(() => {
    if (shouldReduceMotion) {
      return {
        opacity: 1 - progress.value,
        transform: [{ scale: 1 }],
      };
    }

    const recede = interpolate(
      progress.value,
      [0.08, 1],
      [0, 1],
      Extrapolation.CLAMP,
    );

    return {
      opacity: interpolate(
        progress.value,
        [0, 0.78, 1],
        [1, 1, 0],
        Extrapolation.CLAMP,
      ),
      transform: [
        { perspective: 560 },
        { translateX: recede * 14 },
        { rotateY: `${recede * -22}deg` },
        { scale: 1 - recede * 0.16 },
      ],
    };
  });

  const handoffImageStyle = useAnimatedStyle(() => ({
    opacity: shouldReduceMotion
      ? 1
      : interpolate(progress.value, [0, 0.08], [1, 0], Extrapolation.CLAMP),
  }));

  const pathProps = useAnimatedProps(() => ({
    strokeDashoffset: shouldReduceMotion
      ? 0
      : interpolate(
          progress.value,
          [0.08, 0.92],
          [0, -WAVE_PATH_LENGTH],
          Extrapolation.CLAMP,
        ),
  }));

  return (
    <View
      accessible={false}
      onLayout={onMarkDisplayed}
      pointerEvents="none"
      style={styles.splashOverlay}
      testID={testID}>
      <Animated.View style={[styles.background, backgroundStyle]} />

      <Animated.View style={[styles.mark, markStyle]}>
        <Svg
          accessible={false}
          height={MARK_SIZE}
          viewBox="0 0 500 500"
          width={MARK_SIZE}>
          <AnimatedPath
            animatedProps={pathProps}
            d={WAVE_PATH}
            fill="none"
            stroke={MARK_COLOR}
            strokeDasharray={[WAVE_PATH_LENGTH, WAVE_PATH_LENGTH]}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={60}
          />
        </Svg>

        <Animated.View style={[styles.handoffImage, handoffImageStyle]}>
          <Image
            accessible={false}
            contentFit="contain"
            onDisplay={onMarkDisplayed}
            onError={() => onMarkDisplayed?.()}
            source={require('@/assets/images/wave-mark.png')}
            style={styles.image}
            transition={0}
          />
        </Animated.View>
      </Animated.View>
    </View>
  );
}

export function AnimatedSplashOverlay() {
  const [started, setStarted] = useState(false);
  const [visible, setVisible] = useState(true);
  const nativeHideRequested = useRef(false);

  const handleMarkDisplayed = useCallback(() => {
    if (nativeHideRequested.current) return;
    nativeHideRequested.current = true;

    void SplashScreen.hideAsync()
      .catch(() => {
        // Fast Refresh can race the native splash screen. The React overlay is
        // already ready, so the outro can still complete safely.
      })
      .finally(() => setStarted(true));
  }, []);

  const handleFinished = useCallback(() => setVisible(false), []);

  if (!visible) return null;

  return (
    <TravelingRecedeSplash
      onFinished={handleFinished}
      onMarkDisplayed={handleMarkDisplayed}
      start={started}
      testID="wave-splash-overlay"
    />
  );
}

const styles = StyleSheet.create({
  background: {
    ...StyleSheet.absoluteFill,
    backgroundColor: BACKGROUND_COLOR,
  },
  handoffImage: {
    ...StyleSheet.absoluteFill,
  },
  image: {
    width: MARK_SIZE,
    height: MARK_SIZE,
  },
  mark: {
    width: MARK_SIZE,
    height: MARK_SIZE,
    transformOrigin: 'left center',
  },
  splashOverlay: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
  },
});
