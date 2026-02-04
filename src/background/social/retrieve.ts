/**
 * Social Tipping Retrieve Module
 *
 * Tip listing handlers (claimable, received, sent).
 * NO WASM DEPENDENCIES - safe for service worker startup.
 */

import type { MessageResponse } from '@/types';
import { api } from '@/lib/api';

/**
 * Get tips the current user can claim (only confirmed tips).
 */
export async function handleGetClaimableTips(): Promise<MessageResponse<{ tips: unknown[] }>> {
  try {
    const result = await api.getClaimableTips();

    if (result.error) {
      return { success: false, error: result.error };
    }

    return {
      success: true,
      data: { tips: result.data!.tips },
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to get claimable tips',
    };
  }
}

/**
 * Get all received tips (includes tips waiting for confirmations).
 */
export async function handleGetReceivedTips(): Promise<MessageResponse<{ tips: unknown[] }>> {
  try {
    console.log('[handleGetReceivedTips] Calling API (social received)...');
    const result = await api.getReceivedSocialTips();
    console.log('[handleGetReceivedTips] API result:', result);

    if (result.error) {
      console.log('[handleGetReceivedTips] API error:', result.error);
      return { success: false, error: result.error };
    }

    console.log('[handleGetReceivedTips] Tips count:', result.data?.tips?.length);
    return {
      success: true,
      data: { tips: result.data!.tips },
    };
  } catch (err) {
    console.error('[handleGetReceivedTips] Exception:', err);
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to get received tips',
    };
  }
}

/**
 * Get tips sent by the current user.
 */
export async function handleGetSentSocialTips(): Promise<MessageResponse<{ tips: unknown[] }>> {
  try {
    const result = await api.getSentSocialTips();

    if (result.error) {
      return { success: false, error: result.error };
    }

    return {
      success: true,
      data: { tips: result.data!.tips },
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to get sent tips',
    };
  }
}
