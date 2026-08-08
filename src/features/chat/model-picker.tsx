/**
 * Per-conversation model controls: a compact composer pill opening a
 * bottom-sheet picker over the gateway's model catalog, with Desktop's
 * session-scoped knobs — thinking effort (off/low/medium/high), fast
 * (priority) tier, and a refresh of the provider model lists.
 *
 * The catalog is fetched only when the picker opens — reading the
 * session-scoped state resumes the gateway session, which is a real gateway
 * action and too heavy for every screen mount. Every change is one
 * non-retrying session-scoped `config.set`; a busy session defers a model
 * pick to its next turn start, and expensive models confirm first. Provider
 * administration stays out entirely (see AGENTS.md).
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  BottomSheet,
  Button,
  CheckIcon,
  ChevronDownIcon,
  Dialog,
  Item,
  RotateCcwIcon,
  SparklesIcon,
  Spinner,
  Switch,
  Typography,
} from 'panelui-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Keyboard, View } from 'react-native';

import type { GatewayClient } from '@/services/gateway/gateway-client';
import {
  WAVE_REASONING_EFFORTS,
  type WaveModelCatalog,
  type WaveModelSelection,
  type WaveReasoningEffort,
} from '@/services/gateway/gateway-models';

const NOTICE_TIMEOUT_MS = 8_000;
const MAX_PILL_LABEL_CHARS = 22;

const EFFORT_LABELS: Record<WaveReasoningEffort, string> = {
  high: 'High',
  low: 'Low',
  medium: 'Med',
  none: 'Off',
};

/** The trailing path segment reads best in a pill ("openrouter/x/y" → "y"). */
function pillLabel(modelId: string | undefined): string {
  if (!modelId) return 'Model';
  const tail = modelId.split('/').pop() ?? modelId;
  return tail.length > MAX_PILL_LABEL_CHARS
    ? `${tail.slice(0, MAX_PILL_LABEL_CHARS - 1)}…`
    : tail;
}

function modelDescription(option: {
  fast?: boolean;
  pricing?: string;
  reasoning?: boolean;
  unavailable: boolean;
}): string | undefined {
  if (option.unavailable) return 'Not available on this account';
  const parts = [
    ...(option.fast ? ['fast'] : []),
    ...(option.reasoning ? ['reasoning'] : []),
    ...(option.pricing ? [option.pricing] : []),
  ];
  return parts.length > 0 ? parts.join(' · ') : undefined;
}

/** The current model's capability row, when the catalog knows it. */
function currentCapabilities(catalog: WaveModelCatalog | undefined) {
  if (!catalog?.currentModel) return undefined;
  for (const provider of catalog.providers) {
    for (const option of provider.models) {
      if (option.id === catalog.currentModel) return option;
    }
  }
  return undefined;
}

export function SessionModelPill({
  baseUrl,
  connectionId,
  disabled,
  gatewayClient,
  onNotice,
  openNonce = 0,
  sessionId,
}: {
  baseUrl: string;
  connectionId: string;
  disabled?: boolean;
  gatewayClient: GatewayClient;
  /** Transient status copy ("applies next turn") for the caller to place. */
  onNotice?: (text: string | undefined) => void;
  /** Increment to open the picker from outside (the /model command). */
  openNonce?: number;
  sessionId: string;
}) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [busyModel, setBusyModel] = useState<string>();
  const [busyControl, setBusyControl] = useState<'fast' | 'reasoning'>();
  const [error, setError] = useState<string>();
  const [confirm, setConfirm] = useState<{
    message: string;
    selection: WaveModelSelection;
  }>();
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );

  const contextKey = [
    'wave',
    connectionId,
    baseUrl,
    'session-model-context',
    sessionId,
  ] as const;
  const context = useQuery({
    // Fetching resumes the session server-side; only the open picker pays it.
    enabled: false,
    gcTime: 10 * 60_000,
    queryFn: ({ signal }) =>
      gatewayClient.getSessionModelContext(sessionId, {}, signal),
    queryKey: contextKey,
    retry: false,
    staleTime: 60_000,
  });
  const refetchContext = context.refetch;
  const [refreshing, setRefreshing] = useState(false);

  useEffect(
    () => () => {
      if (noticeTimer.current) clearTimeout(noticeTimer.current);
    },
    [],
  );

  const showNotice = useCallback(
    (text: string | undefined) => {
      if (!onNotice) return;
      if (noticeTimer.current) clearTimeout(noticeTimer.current);
      onNotice(text);
      if (text) {
        noticeTimer.current = setTimeout(
          () => onNotice(undefined),
          NOTICE_TIMEOUT_MS,
        );
      }
    },
    [onNotice],
  );

  const openPicker = useCallback(() => {
    // The styled sheet renders in the app window, underneath the keyboard's
    // own window — close the keyboard before opening it (same rule as the
    // attachment sheet).
    Keyboard.dismiss();
    setError(undefined);
    setOpen(true);
    void refetchContext();
  }, [refetchContext]);

  useEffect(() => {
    if (openNonce <= 0) return;
    // Deferred a tick: opening synchronously inside the effect would set
    // state during the commit that delivered the nonce.
    const timer = setTimeout(openPicker, 0);
    return () => clearTimeout(timer);
  }, [openNonce, openPicker]);

  const patchContext = useCallback(
    (patch: Partial<WaveModelCatalog>) => {
      queryClient.setQueryData<WaveModelCatalog>(contextKey, (current) =>
        current ? { ...current, ...patch } : current,
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- contextKey derives from these
    [baseUrl, connectionId, queryClient, sessionId],
  );

  const refreshModels = useCallback(() => {
    if (refreshing) return;
    setRefreshing(true);
    setError(undefined);
    gatewayClient
      .getSessionModelContext(sessionId, { refresh: true })
      .then((catalog) => {
        queryClient.setQueryData(contextKey, catalog);
      })
      .catch(() => setError('Wave could not refresh the model list.'))
      .finally(() => setRefreshing(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- contextKey derives from listed inputs
  }, [
    gatewayClient,
    queryClient,
    refreshing,
    sessionId,
    baseUrl,
    connectionId,
  ]);

  const select = useCallback(
    async (selection: WaveModelSelection, confirmExpensive = false) => {
      if (busyModel) return;
      setBusyModel(selection.model);
      setError(undefined);
      try {
        const result = await gatewayClient.setSessionModel(
          sessionId,
          selection,
          confirmExpensive ? { confirmExpensiveModel: true } : {},
        );
        if (result.outcome === 'confirm-required') {
          setConfirm({ message: result.message, selection });
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
        setOpen(false);
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
      } finally {
        setBusyModel(undefined);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- contextKey is derived from the listed inputs
    [
      baseUrl,
      busyModel,
      connectionId,
      gatewayClient,
      queryClient,
      sessionId,
      showNotice,
    ],
  );

  const setReasoning = useCallback(
    (effort: WaveReasoningEffort) => {
      if (busyControl) return;
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
      if (busyControl) return;
      setBusyControl('fast');
      setError(undefined);
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
    [busyControl, gatewayClient, patchContext, sessionId],
  );

  const catalog = context.data;
  const capabilities = currentCapabilities(catalog);
  // Capability gating like Desktop: hide a knob the current model is known
  // not to support; an unknown capability keeps the knob and lets the
  // gateway's own validation answer.
  const sessionScoped = catalog?.sessionScoped === true;
  const showReasoning =
    sessionScoped &&
    catalog?.reasoningEffort !== undefined &&
    capabilities?.reasoning !== false;
  const showFast =
    sessionScoped &&
    catalog?.fastMode !== undefined &&
    capabilities?.fast !== false;
  const label = pillLabel(catalog?.currentModel);

  return (
    <>
      <Button
        size="sm"
        variant="ghost"
        accessibilityLabel="Change the model for this conversation"
        className="self-start"
        disabled={disabled}
        startContent={<SparklesIcon size={14} />}
        endContent={<ChevronDownIcon size={12} />}
        testID="chat-model-pill"
        onPress={openPicker}>
        {label}
      </Button>

      <BottomSheet open={open} onOpenChange={setOpen}>
        <BottomSheet.Content blur size="half">
          <BottomSheet.Header title="Model for this chat" />
          <BottomSheet.Body testID="chat-model-picker">
            {context.isFetching && !catalog ? (
              <View className="items-center py-10">
                <Spinner />
              </View>
            ) : context.isError && !catalog ? (
              <Typography.Paragraph muted className="px-3 py-8 text-center">
                Wave could not load the model list. Close and try again.
              </Typography.Paragraph>
            ) : catalog ? (
              <>
                {showReasoning || showFast ? (
                  <View className="gap-3 px-3 pb-2 pt-1">
                    {showReasoning ? (
                      <View className="flex-row items-center justify-between gap-3">
                        <Typography.Paragraph weight="medium">
                          Thinking
                        </Typography.Paragraph>
                        <View
                          className="flex-row gap-1"
                          testID="chat-model-reasoning">
                          {WAVE_REASONING_EFFORTS.map((effort) => (
                            <Button
                              key={effort}
                              size="sm"
                              variant={
                                catalog.reasoningEffort === effort ||
                                (effort === 'none' &&
                                  catalog.reasoningEffort === 'none')
                                  ? 'secondary'
                                  : 'ghost'
                              }
                              accessibilityLabel={`Set thinking to ${EFFORT_LABELS[effort]}`}
                              disabled={busyControl !== undefined}
                              testID={`chat-model-reasoning-${effort}`}
                              onPress={() => setReasoning(effort)}>
                              {EFFORT_LABELS[effort]}
                            </Button>
                          ))}
                        </View>
                      </View>
                    ) : null}
                    {showFast ? (
                      <View className="flex-row items-center justify-between gap-3">
                        <Typography.Paragraph weight="medium">
                          Fast mode
                        </Typography.Paragraph>
                        <View testID="chat-model-fast">
                          <Switch
                            disabled={busyControl !== undefined}
                            value={catalog.fastMode === true}
                            onValueChange={setFastMode}
                          />
                        </View>
                      </View>
                    ) : null}
                  </View>
                ) : null}

                <View className="flex-row items-center justify-between px-3 pb-1">
                  <Typography.Paragraph muted className="text-xs uppercase">
                    Models
                  </Typography.Paragraph>
                  <Button
                    size="sm"
                    variant="ghost"
                    accessibilityLabel="Refresh the model list"
                    disabled={refreshing}
                    loading={refreshing}
                    startContent={<RotateCcwIcon size={13} />}
                    testID="chat-model-refresh"
                    onPress={refreshModels}>
                    Refresh
                  </Button>
                </View>

                {catalog.providers.length === 0 ? (
                  <Typography.Paragraph muted className="px-3 py-8 text-center">
                    This server lists no switchable models.
                  </Typography.Paragraph>
                ) : (
                  catalog.providers.map((provider) => (
                    <View key={provider.slug} className="pb-2">
                      <Typography.Paragraph
                        muted
                        className="px-3 pb-1 pt-3 text-xs uppercase">
                        {provider.name}
                      </Typography.Paragraph>
                      {provider.models.map((option) => {
                        const selected =
                          provider.current &&
                          option.id === catalog.currentModel;
                        const description = modelDescription(option);
                        return (
                          <View
                            key={option.id}
                            className={
                              option.unavailable ? 'opacity-40' : undefined
                            }>
                            <Item
                              accessibilityLabel={`Use model ${option.id}`}
                              testID={`chat-model-${provider.slug}-${option.id}`}
                              onPress={
                                option.unavailable || Boolean(busyModel)
                                  ? undefined
                                  : () =>
                                      void select({
                                        model: option.id,
                                        provider: provider.slug,
                                      })
                              }>
                              <Item.Content>
                                <Item.Title numberOfLines={1}>
                                  {option.id}
                                </Item.Title>
                                {description ? (
                                  <Item.Description numberOfLines={1}>
                                    {description}
                                  </Item.Description>
                                ) : null}
                              </Item.Content>
                              {busyModel === option.id ? (
                                <Spinner size="sm" />
                              ) : selected ? (
                                <CheckIcon size={16} />
                              ) : null}
                            </Item>
                          </View>
                        );
                      })}
                    </View>
                  ))
                )}
              </>
            ) : null}
            {error ? (
              <Typography.Paragraph
                className="px-3 py-2 text-xs text-destructive"
                testID="chat-model-error">
                {error}
              </Typography.Paragraph>
            ) : null}
          </BottomSheet.Body>
        </BottomSheet.Content>
      </BottomSheet>

      <Dialog
        open={confirm !== undefined}
        onOpenChange={(dialogOpen) => {
          if (!dialogOpen && !busyModel) setConfirm(undefined);
        }}>
        <Dialog.Content blur>
          <Dialog.Title>Switch to an expensive model?</Dialog.Title>
          <Dialog.Description testID="chat-model-confirm-message">
            {confirm?.message}
          </Dialog.Description>
          <Dialog.Footer className="mt-4">
            <Button
              variant="ghost"
              disabled={Boolean(busyModel)}
              onPress={() => setConfirm(undefined)}>
              Cancel
            </Button>
            <Button
              disabled={Boolean(busyModel)}
              testID="chat-model-confirm"
              onPress={() => {
                const pending = confirm;
                setConfirm(undefined);
                if (pending) void select(pending.selection, true);
              }}>
              Switch
            </Button>
          </Dialog.Footer>
        </Dialog.Content>
      </Dialog>
    </>
  );
}
