/**
 * Maps a prompt card response onto the gateway prompt-response input, shared
 * by the chat screen and gateway voice mode so both answer identically.
 *
 * Approvals carry the prompt id so a gateway-issued request id (v0.20.5)
 * resolves exactly that approval; clarify answers and batches correlate by
 * the request id the prompt carried; everything else is a decline.
 */
import type { PromptCardResponse } from '@/components/prompt-card';
import type { WaveChatPrompt } from '@/features/chat/chat-state';
import type { GatewayClient } from '@/services/gateway/gateway-client';

export type WavePromptResponseInput = Parameters<
  GatewayClient['respondToPrompt']
>[1];

export function promptResponseInput(
  prompt: WaveChatPrompt,
  response: PromptCardResponse,
): WavePromptResponseInput | undefined {
  if (response.kind === 'approval') {
    return {
      choice: response.choice,
      kind: 'approval',
      promptId: prompt.promptId,
    };
  }
  if (response.kind === 'clarify') {
    return {
      answer: response.answer,
      kind: 'clarify',
      promptId: prompt.promptId,
    };
  }
  if (response.kind === 'clarify-batch') {
    return {
      answers: response.answers,
      kind: 'clarify-batch',
      promptId: prompt.promptId,
    };
  }
  if (prompt.kind === 'mcp-setup') {
    if (!prompt.server) return undefined;
    return {
      kind: 'mcp-setup',
      promptId: prompt.promptId,
      server: prompt.server,
    };
  }
  return {
    kind: prompt.kind === 'sudo' ? 'sudo' : 'secret',
    promptId: prompt.promptId,
  };
}
