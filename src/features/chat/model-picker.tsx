/**
 * Per-conversation model selection: a compact composer pill opening a
 * bottom-sheet picker over the gateway's model catalog.
 *
 * The catalog is fetched only when the picker opens — reading the
 * session-scoped current model resumes the gateway session, which is a real
 * gateway action and too heavy for every screen mount. A switch is one
 * non-retrying `config.set`; a busy session answers `deferred` and the
 * gateway applies the pick when its next turn starts. Expensive models come
 * back `confirm-required` and are re-sent only after the user agrees.
 * Provider administration stays out entirely — the sheet lists only what the
 * gateway says is usable (see AGENTS.md).
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  BottomSheet,
  Button,
  CheckIcon,
  ChevronDownIcon,
  Dialog,
  Item,
  SparklesIcon,
  Spinner,
  Typography,
} from 'panelui-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { View } from 'react-native';

import type { GatewayClient } from '@/services/gateway/gateway-client';
import type {
  WaveModelCatalog,
  WaveModelSelection,
} from '@/services/gateway/gateway-models';

const NOTICE_TIMEOUT_MS = 8_000;
const MAX_PILL_LABEL_CHARS = 26;

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

export function SessionModelPill({
  baseUrl,
  connectionId,
  disabled,
  gatewayClient,
  sessionId,
}: {
  baseUrl: string;
  connectionId: string;
  disabled?: boolean;
  gatewayClient: GatewayClient;
  sessionId: string;
}) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [busyModel, setBusyModel] = useState<string>();
  const [notice, setNotice] = useState<string>();
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
      gatewayClient.getSessionModelContext(sessionId, signal),
    queryKey: contextKey,
    retry: false,
    staleTime: 60_000,
  });
  const refetchContext = context.refetch;

  useEffect(
    () => () => {
      if (noticeTimer.current) clearTimeout(noticeTimer.current);
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
    setError(undefined);
    setOpen(true);
    void refetchContext();
  }, [refetchContext]);

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

  const catalog = context.data;
  const label = pillLabel(catalog?.currentModel);

  return (
    <>
      <View className="flex-row items-center gap-2 px-1">
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
        {notice ? (
          <Typography.Paragraph
            muted
            className="flex-1 text-xs"
            testID="chat-model-notice">
            {notice}
          </Typography.Paragraph>
        ) : null}
      </View>

      <BottomSheet
        open={open}
        snapPoints={['half', 'full']}
        onOpenChange={setOpen}>
        <BottomSheet.Content blur>
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
            ) : catalog && catalog.providers.length === 0 ? (
              <Typography.Paragraph muted className="px-3 py-8 text-center">
                This server lists no switchable models.
              </Typography.Paragraph>
            ) : (
              catalog?.providers.map((provider) => (
                <View key={provider.slug} className="pb-2">
                  <Typography.Paragraph
                    muted
                    className="px-3 pb-1 pt-3 text-xs uppercase">
                    {provider.name}
                  </Typography.Paragraph>
                  {provider.models.map((option) => {
                    const selected =
                      provider.current && option.id === catalog.currentModel;
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
