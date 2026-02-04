/**
 * Grin Relay Operations
 *
 * Fetches pending slatepacks from the relay system.
 */

import type { MessageResponse } from '@/types';
import { api } from '@/lib/api';
import { isUnlocked } from '../state';
import { getAuthenticatedUserId } from './helpers';

// =============================================================================
// Pending Slatepacks (Relay)
// =============================================================================

/**
 * Get pending slatepacks for the current user.
 *
 * Returns two lists:
 * - pendingToSign: S1 slatepacks waiting for us to sign (as recipient)
 * - pendingToFinalize: S2 slatepacks waiting for us to finalize (as sender)
 *
 * The relay system allows Smirk-to-Smirk transfers without manual
 * slatepack copying.
 *
 * @returns Lists of pending slatepacks
 */
export async function handleGetGrinPendingSlatepacks(): Promise<MessageResponse<{
  pendingToSign: Array<{
    id: string;
    slateId: string;
    senderUserId: string;
    amount: number;
    slatepack: string;
    createdAt: string;
    expiresAt: string;
  }>;
  pendingToFinalize: Array<{
    id: string;
    slateId: string;
    senderUserId: string;
    amount: number;
    slatepack: string;
    createdAt: string;
    expiresAt: string;
  }>;
}>> {
  if (!isUnlocked) {
    return { success: false, error: 'Wallet is locked' };
  }

  try {
    const userId = await getAuthenticatedUserId();

    const result = await api.getGrinPendingSlatepacks(userId);
    if (result.error) {
      return { success: false, error: result.error };
    }

    return {
      success: true,
      data: {
        pendingToSign: result.data!.pending_to_sign.map(s => ({
          id: s.id,
          slateId: s.slate_id,
          senderUserId: s.sender_user_id,
          amount: s.amount,
          slatepack: s.slatepack,
          createdAt: s.created_at,
          expiresAt: s.expires_at,
        })),
        pendingToFinalize: result.data!.pending_to_finalize.map(s => ({
          id: s.id,
          slateId: s.slate_id,
          senderUserId: s.sender_user_id,
          amount: s.amount,
          slatepack: s.slatepack,
          createdAt: s.created_at,
          expiresAt: s.expires_at,
        })),
      },
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to fetch pending slatepacks',
    };
  }
}
