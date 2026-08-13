import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { useEffect } from 'react';

const VOICE_KEEP_AWAKE_TAG = 'wave-voice-call';

/**
 * Hold the screen awake while a live voice call or gateway voice loop is
 * active, releasing the lock as soon as the call ends or the screen unmounts.
 * Nothing else prevents auto-lock mid-call: WebRTC audio does not stop the
 * idle timer, and development clients mask the problem by keeping the screen
 * awake in `__DEV__`.
 */
export function useVoiceKeepAwake(active: boolean) {
  useEffect(() => {
    if (!active) return;
    void activateKeepAwakeAsync(VOICE_KEEP_AWAKE_TAG).catch(() => undefined);
    return () => {
      void deactivateKeepAwake(VOICE_KEEP_AWAKE_TAG).catch(() => undefined);
    };
  }, [active]);
}
