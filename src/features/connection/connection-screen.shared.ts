import { useNativeState } from '@expo/ui';
import { useState } from 'react';

import { useWaveConnection } from '@/features/connection/connection-provider';
import { themeAppearancePreference } from '@/state/device-preferences';
import { useDevicePreference } from '@/state/use-device-state';

export type ConnectionField = 'baseUrl' | 'password' | 'username';

interface FieldValidationError {
  field: ConnectionField;
  message: string;
}

const HTTP_POLICY_TEXT =
  'Wave uses HTTPS by default. Localhost and Tailscale can use HTTP ' +
  'automatically. For a private LAN address, enter http:// explicitly; HTTP ' +
  'traffic is unencrypted.';

export const CONNECTION_COPY = {
  intro: 'Sign in to your Hermes agent to chat from this phone.',
  signInFooter:
    'Use the same login as the Hermes dashboard. Wave sends your password ' +
    `once and never saves it.\n\n${HTTP_POLICY_TEXT}`,
  signOutFooter:
    "Signing out removes this phone's session tokens. The gateway invalidates " +
    'them when its token secret next rotates.',
  title: 'Your Hermes, in Wave',
} as const;

/**
 * Owns the platform-neutral connection fields, validation, and gateway
 * actions. The iOS and Android files contain presentation and focus flow only.
 */
export function useConnectionScreen() {
  const { forget, retry, signIn, state } = useWaveConnection();
  const appearance = useDevicePreference(themeAppearancePreference);
  const baseUrl = useNativeState('');
  const username = useNativeState('');
  const password = useNativeState('');
  const [validationError, setValidationError] =
    useState<FieldValidationError>();

  const savedConnection =
    state.phase === 'error' && state.identity
      ? {
          baseUrl: state.identity.baseUrl,
          error: `Connection failed: ${state.error.message}`,
          label: state.identity.label,
          retryable: state.error.retryable,
        }
      : undefined;
  const signingIn = state.phase === 'signing-in';

  const submitSignIn = () => {
    if (signingIn) return;

    const trimmedUrl = baseUrl.value.trim();
    const trimmedUsername = username.value.trim();
    if (!trimmedUrl) {
      setValidationError({
        field: 'baseUrl',
        message: 'Enter your Hermes gateway URL.',
      });
      return;
    }
    if (!trimmedUsername) {
      setValidationError({
        field: 'username',
        message: 'Enter your username.',
      });
      return;
    }
    if (!password.value) {
      setValidationError({
        field: 'password',
        message: 'Enter your password.',
      });
      return;
    }

    setValidationError(undefined);
    void signIn({
      baseUrl: trimmedUrl,
      password: password.value,
      provider: 'basic',
      username: trimmedUsername,
    });
  };

  const fieldError = (field: ConnectionField) =>
    validationError?.field === field ? validationError.message : undefined;

  return {
    appearance: appearance.value,
    baseUrl,
    connected: state.phase === 'connected',
    connectionError:
      state.phase === 'error' && !state.identity
        ? `Connection failed: ${state.error.message}`
        : undefined,
    fieldErrors: {
      baseUrl: fieldError('baseUrl'),
      password: fieldError('password'),
      username: fieldError('username'),
    },
    password,
    savedConnection,
    signingIn,
    username,
    clearFieldError: (field: ConnectionField) => {
      if (validationError?.field === field) setValidationError(undefined);
    },
    forgetConnection: () => void forget(),
    retryConnection: () => {
      if (savedConnection?.retryable) void retry();
    },
    submitSignIn,
  };
}
