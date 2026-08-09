/**
 * Session-scoped model controller for the native chat composer.
 *
 * Presentation lives with ChatComposer so the trigger, model sheet, and
 * expensive-model alert are all direct Expo UI. This hook keeps the existing
 * gateway boundaries: existing conversations read lazily when the picker
 * opens; pending conversations may prefetch the profile default because there
 * is no session to resume. Every write is one non-retrying session-scoped
 * mutation or a pending option for that conversation's eventual create.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { modelTriggerLabel } from '@/features/chat/composer/state';
import type { GatewayClient } from '@/services/gateway/gateway-client';
import {
  resolveModelFastControl,
  WAVE_REASONING_EFFORTS,
  type WaveModelCatalog,
  type WaveModelSelection,
  type WaveReasoningEffort,
  type WaveReasoningLevel,
} from '@/services/gateway/gateway-models';
import { isPendingSessionId } from '@/services/wave/wave-chat-client';

const NOTICE_TIMEOUT_MS = 8_000;
const CONFIRMATION_PRESENTATION_DELAY_MS = 400;

export const MODEL_EFFORT_LABELS: Record<WaveReasoningLevel, string> = {
  high: 'High',
  low: 'Low',
  max: 'Max',
  medium: 'Medium',
  minimal: 'Minimal',
  ultra: 'Ultra',
  xhigh: 'Extra High',
};

export function modelOptionDescription(option: {
  fast?: boolean;
  pricing?: string;
  reasoning?: boolean;
  unavailable: boolean;
}): string | undefined {
  if (option.unavailable) return 'Not available on this account';
  return option.pricing;
}

/** The current model's capability row, when the catalog knows it. */
function currentCapabilities(catalog: WaveModelCatalog | undefined) {
  if (!catalog?.currentModel) return undefined;
  const providers = catalog.currentProvider
    ? catalog.providers.filter(
        (provider) => provider.slug === catalog.currentProvider,
      )
    : catalog.providers.filter((provider) => provider.current);
  for (const provider of providers) {
    for (const option of provider.models) {
      if (
        option.id === catalog.currentModel ||
        option.id === catalog.currentModel.replace(/-fast$/i, '')
      ) {
        return option;
      }
    }
  }
  return undefined;
}

export interface SessionModelPickerController {
  busyControl: 'fast' | 'reasoning' | undefined;
  busyModel: string | undefined;
  catalog: WaveModelCatalog | undefined;
  closeConfirmation(): void;
  closePicker(): void;
  confirm: { message: string; selection: WaveModelSelection } | undefined;
  confirmSelection(): void;
  error: string | undefined;
  isInitialError: boolean;
  isLoading: boolean;
  label: string;
  notice: string | undefined;
  open: boolean;
  openPicker(): void;
  reasoningEfforts: typeof WAVE_REASONING_EFFORTS;
  selectedReasoning: WaveReasoningLevel;
  refreshModels(): Promise<void>;
  refreshing: boolean;
  select(
    selection: WaveModelSelection,
    confirmExpensive?: boolean,
  ): Promise<void>;
  setFastMode(enabled: boolean): void;
  setReasoning(effort: WaveReasoningEffort): void;
  setThinking(enabled: boolean): void;
  fastEnabled: boolean;
  showFast: boolean;
  showReasoning: boolean;
  thinkingEnabled: boolean;
}

export function useSessionModelPicker({
  baseUrl,
  connectionId,
  gatewayClient,
  sessionId,
}: {
  baseUrl: string;
  connectionId: string;
  gatewayClient: GatewayClient | undefined;
  sessionId: string;
}): SessionModelPickerController {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [busyModel, setBusyModel] = useState<string>();
  const [busyControl, setBusyControl] = useState<'fast' | 'reasoning'>();
  const [error, setError] = useState<string>();
  const [confirm, setConfirm] = useState<{
    message: string;
    selection: WaveModelSelection;
  }>();
  const [notice, setNotice] = useState<string>();
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const confirmTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const lastReasoning = useRef<WaveReasoningLevel>('medium');
  const prefetchedPendingSession = useRef<string | undefined>(undefined);

  const contextKey = useMemo(
    () =>
      [
        'wave',
        connectionId,
        baseUrl,
        'session-model-context',
        sessionId,
      ] as const,
    [baseUrl, connectionId, sessionId],
  );
  const context = useQuery({
    // Fetching resumes the session server-side; only the open picker pays it.
    enabled: false,
    gcTime: 10 * 60_000,
    queryFn: ({ signal }) => {
      if (!gatewayClient) throw new Error('The model catalog is unavailable.');
      return gatewayClient.getSessionModelContext(sessionId, {}, signal);
    },
    queryKey: contextKey,
    retry: false,
    staleTime: 60_000,
  });
  const refetchContext = context.refetch;
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    // A pending conversation has no gateway session to resume, so its profile
    // model context is safe to read immediately. Existing chats stay lazy:
    // reading their scoped context deliberately resumes a Hermes session.
    if (
      !gatewayClient ||
      !isPendingSessionId(sessionId) ||
      prefetchedPendingSession.current === sessionId
    ) {
      return;
    }
    prefetchedPendingSession.current = sessionId;
    void refetchContext();
  }, [gatewayClient, refetchContext, sessionId]);

  useEffect(
    () => () => {
      if (noticeTimer.current) clearTimeout(noticeTimer.current);
      if (confirmTimer.current) clearTimeout(confirmTimer.current);
    },
    [],
  );

  const showNotice = useCallback((text: string | undefined) => {
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    setNotice(text);
    if (text) {
      noticeTimer.current = setTimeout(
        () => setNotice(undefined),
        NOTICE_TIMEOUT_MS,
      );
    }
  }, []);

  const openPicker = useCallback(() => {
    if (!gatewayClient) return;
    if (confirmTimer.current) clearTimeout(confirmTimer.current);
    setConfirm(undefined);
    setError(undefined);
    setOpen(true);
    void refetchContext();
  }, [gatewayClient, refetchContext]);

  const patchContext = useCallback(
    (patch: Partial<WaveModelCatalog>) => {
      queryClient.setQueryData<WaveModelCatalog>(contextKey, (current) =>
        current ? { ...current, ...patch } : current,
      );
    },
    [contextKey, queryClient],
  );

  const refreshModels = useCallback(async () => {
    if (!gatewayClient || refreshing) return;
    setRefreshing(true);
    setError(undefined);
    try {
      const catalog = await gatewayClient.getSessionModelContext(sessionId, {
        refresh: true,
      });
      queryClient.setQueryData(contextKey, catalog);
    } catch {
      setError('Wave could not refresh the model list.');
    } finally {
      setRefreshing(false);
    }
  }, [contextKey, gatewayClient, queryClient, refreshing, sessionId]);

  const select = useCallback(
    async (
      selection: WaveModelSelection,
      confirmExpensive = false,
      keepOpen = false,
    ) => {
      if (!gatewayClient || busyModel) return;
      setBusyModel(selection.model);
      setError(undefined);
      try {
        const result = await gatewayClient.setSessionModel(
          sessionId,
          selection,
          confirmExpensive ? { confirmExpensiveModel: true } : {},
        );
        if (result.outcome === 'confirm-required') {
          // A native sheet and native alert cannot own presentation at the
          // same instant. Let the sheet finish its dismissal first.
          setOpen(false);
          if (confirmTimer.current) clearTimeout(confirmTimer.current);
          confirmTimer.current = setTimeout(
            () => setConfirm({ message: result.message, selection }),
            CONFIRMATION_PRESENTATION_DELAY_MS,
          );
          return;
        }
        queryClient.setQueryData<WaveModelCatalog>(contextKey, (current) =>
          current
            ? {
                ...current,
                currentModel: result.model,
                currentProvider: selection.provider,
                providers: current.providers.map((provider) => ({
                  ...provider,
                  current: provider.slug === selection.provider,
                })),
              }
            : current,
        );
        if (!keepOpen) setOpen(false);
        showNotice(
          result.outcome === 'deferred'
            ? 'The model changes when the next turn starts.'
            : result.warning,
        );
      } catch (selectError) {
        setError(
          selectError instanceof Error
            ? selectError.message
            : 'Wave could not switch the model.',
        );
        if (confirmExpensive) {
          // Reopen the picker after the alert has left the hierarchy so the
          // native error remains visible and retryable.
          if (confirmTimer.current) clearTimeout(confirmTimer.current);
          confirmTimer.current = setTimeout(
            () => setOpen(true),
            CONFIRMATION_PRESENTATION_DELAY_MS,
          );
        }
      } finally {
        setBusyModel(undefined);
      }
    },
    [busyModel, contextKey, gatewayClient, queryClient, sessionId, showNotice],
  );

  const setReasoning = useCallback(
    (effort: WaveReasoningEffort) => {
      if (!gatewayClient || busyControl) return;
      setBusyControl('reasoning');
      setError(undefined);
      gatewayClient
        .setSessionReasoning(sessionId, effort)
        .then((result) => patchContext({ reasoningEffort: result.effort }))
        .catch((cause) =>
          setError(
            cause instanceof Error
              ? cause.message
              : 'Wave could not change thinking.',
          ),
        )
        .finally(() => setBusyControl(undefined));
    },
    [busyControl, gatewayClient, patchContext, sessionId],
  );

  const setFastMode = useCallback(
    (enabled: boolean) => {
      if (!gatewayClient || busyControl) return;
      setBusyControl('fast');
      setError(undefined);
      const fastControl = resolveModelFastControl(context.data);
      if (fastControl.kind === 'variant') {
        void select(
          {
            model: enabled ? fastControl.fastModel : fastControl.baseModel,
            provider: fastControl.provider,
          },
          false,
          true,
        ).finally(() => setBusyControl(undefined));
        return;
      }
      gatewayClient
        .setSessionFastMode(sessionId, enabled)
        .then((result) => patchContext({ fastMode: result.fastMode }))
        .catch((cause) =>
          setError(
            cause instanceof Error
              ? cause.message
              : 'Wave could not change fast mode.',
          ),
        )
        .finally(() => setBusyControl(undefined));
    },
    [busyControl, context.data, gatewayClient, patchContext, select, sessionId],
  );

  const catalog = context.data;
  const capabilities = currentCapabilities(catalog);
  const fastControl = resolveModelFastControl(catalog);
  const selectedReasoning =
    WAVE_REASONING_EFFORTS.find(
      (effort) => effort === catalog?.reasoningEffort,
    ) ?? 'medium';
  const thinkingEnabled = catalog?.reasoningEffort !== 'none';
  useEffect(() => {
    if (catalog?.reasoningEffort && catalog.reasoningEffort !== 'none') {
      const settled = WAVE_REASONING_EFFORTS.find(
        (effort) => effort === catalog.reasoningEffort,
      );
      if (settled) lastReasoning.current = settled;
    }
  }, [catalog?.reasoningEffort]);
  const setThinking = useCallback(
    (enabled: boolean) => {
      setReasoning(enabled ? lastReasoning.current : 'none');
    },
    [setReasoning],
  );
  // Capability gating like Desktop: hide a knob the current model is known
  // not to support; an unknown capability leaves gateway validation in charge.
  const showReasoning =
    catalog !== undefined &&
    catalog?.reasoningEffort !== undefined &&
    capabilities?.reasoning !== false;
  const showFast = catalog !== undefined && fastControl.kind !== 'none';

  const closeConfirmation = useCallback(() => setConfirm(undefined), []);
  const closePicker = useCallback(() => setOpen(false), []);
  const confirmSelection = useCallback(() => {
    const pending = confirm;
    setConfirm(undefined);
    if (pending) void select(pending.selection, true);
  }, [confirm, select]);

  return {
    busyControl,
    busyModel,
    catalog,
    closeConfirmation,
    closePicker,
    confirm,
    confirmSelection,
    error,
    fastEnabled: fastControl.kind === 'none' ? false : fastControl.enabled,
    isInitialError: context.isError && !catalog,
    isLoading: context.isFetching && !catalog,
    label: modelTriggerLabel(catalog?.currentModel, catalog?.reasoningEffort),
    notice,
    open,
    openPicker,
    reasoningEfforts: WAVE_REASONING_EFFORTS,
    refreshModels,
    refreshing,
    select,
    selectedReasoning,
    setFastMode,
    setReasoning,
    setThinking,
    showFast,
    showReasoning,
    thinkingEnabled,
  };
}
