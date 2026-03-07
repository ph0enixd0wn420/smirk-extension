/**
 * Grin Cancel Operations
 *
 * Cancel pending slatepacks and send transactions.
 */

import type { MessageResponse } from '@/types';
import { api } from '@/lib/api';
import { isUnlocked } from '../state';
import { getAuthenticatedUserId } from './helpers';
import { unlockGrinOutputs, updateGrinTransactionStatus } from './backend';

// =============================================================================
// Cancel Operations
// =============================================================================

/**
 * Cancel a pending slatepack (relay).
 *
 * Removes the slatepack from the relay system. The backend automatically
 * unlocks any locked outputs and cancels the associated transaction.
 *
 * @param relayId - ID of the pending relay slatepack
 * @returns Cancel status
 */
export async function handleGrinCancelSlate(
  relayId: string
): Promise<MessageResponse<{ success: boolean }>> {
  if (!isUnlocked) {
    return { success: false, error: 'Wallet is locked' };
  }

  try {
    const userId = await getAuthenticatedUserId();

    const result = await api.cancelGrinSlatepack({
      relayId,
      userId,
    });

    if (result.error) {
      return { success: false, error: result.error };
    }

    return { success: true, data: { success: true } };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to cancel slatepack',
    };
  }
}

/**
 * Cancel a Grin send transaction.
 *
 * Unlocks the inputs and marks the transaction as cancelled.
 * Used when sender decides not to complete the transaction
 * (e.g., recipient never signs S2).
 *
 * @param slateId - Slate ID of the transaction
 * @param _inputIds - Deprecated, backend now looks up outputs by slate_id
 * @returns Cancel status
 */
export async function handleGrinCancelSend(
  slateId: string,
  _inputIds: string[] // Deprecated
): Promise<MessageResponse<{ cancelled: boolean }>> {
  if (!isUnlocked) {
    return { success: false, error: 'Wallet is locked' };
  }

  try {
    const userId = await getAuthenticatedUserId();

    // Unlock the inputs (backend finds them by slate_id)
    await unlockGrinOutputs(userId, slateId);

    // Mark transaction as cancelled
    await updateGrinTransactionStatus(userId, slateId, 'cancelled');

    console.log(`[Grin] Cancelled send slate ${slateId}`);

    return {
      success: true,
      data: { cancelled: true },
    };
  } catch (err) {
    console.error('[Grin] Failed to cancel send:', err);
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to cancel transaction',
    };
  }
}

/**
 * Finalize a slate via relay (deprecated).
 *
 * This flow requires storing slate state which isn't currently implemented.
 * Use handleGrinFinalizeAndBroadcast with sendContext instead.
 */
export async function handleGrinFinalizeSlate(
  _relayId: string,
  _slatepack: string
): Promise<MessageResponse<{ broadcast: boolean; txid?: string }>> {
  return {
    success: false,
    error: 'Grin send/finalize flow not yet implemented. Use receive flow for now.',
  };
}
