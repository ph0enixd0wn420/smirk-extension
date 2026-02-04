/**
 * Grin WASM Helpers
 *
 * Shared helper functions for all Grin operations:
 * - WASM module loading (dynamic import)
 * - Key initialization
 * - Authentication checks
 * - Output fetching
 */

import type { GrinKeys, GrinOutput } from '@/lib/grin';
import { getAuthState } from '@/lib/storage';
import { api } from '@/lib/api';
import {
  isUnlocked,
  grinWasmKeys,
  setGrinWasmKeys,
  unlockedMnemonic,
} from '../state';

// =============================================================================
// WASM Module Loading
// =============================================================================

/**
 * Dynamically import Grin WASM module when needed.
 *
 * CRITICAL: This must be a dynamic import because WASM modules use DOM APIs
 * (document.createElement) not available in service workers. Static imports
 * would crash the service worker at startup.
 */
export async function getGrinModule() {
  return import('@/lib/grin');
}

// =============================================================================
// Key Initialization
// =============================================================================

/**
 * Ensure Grin WASM keys are initialized.
 *
 * Returns cached keys if available, otherwise initializes from mnemonic.
 * Throws if wallet is locked or mnemonic unavailable.
 *
 * @returns Initialized GrinKeys
 * @throws Error if wallet is locked or mnemonic unavailable
 */
export async function ensureGrinKeysInitialized(): Promise<GrinKeys> {
  if (!isUnlocked) {
    throw new Error('Wallet is locked');
  }

  // Return cached keys if available
  if (grinWasmKeys) {
    return grinWasmKeys;
  }

  // Initialize from mnemonic
  if (!unlockedMnemonic) {
    throw new Error('Mnemonic not available - please re-unlock wallet');
  }

  const keys = await (await getGrinModule()).initGrinWallet(unlockedMnemonic);
  setGrinWasmKeys(keys);
  return keys;
}

// =============================================================================
// Authentication
// =============================================================================

/**
 * Get authenticated user ID.
 *
 * @returns User ID from auth state
 * @throws Error if not authenticated
 */
export async function getAuthenticatedUserId(): Promise<string> {
  const authState = await getAuthState();
  if (!authState?.userId) {
    throw new Error('Not authenticated');
  }
  return authState.userId;
}

// =============================================================================
// Output Management
// =============================================================================

/**
 * Get the next child index for key derivation.
 *
 * CRITICAL: This must be unique across ALL outputs (including spent).
 * Reusing n_child would create duplicate commitments, which the network
 * rejects as a double-spend attempt.
 *
 * @param userId - User ID for API call
 * @returns Next available child index
 */
export async function getNextChildIndex(userId: string): Promise<number> {
  const outputsResult = await api.getGrinOutputs(userId);
  if (outputsResult.error) {
    throw new Error(`Failed to fetch outputs: ${outputsResult.error}`);
  }
  return outputsResult.data?.next_child_index ?? 0;
}

/**
 * Fetch unspent outputs for transaction building.
 *
 * Returns outputs in the GrinOutput format needed by WASM functions.
 *
 * @param userId - User ID for API call
 * @returns Object with outputs array and next_child_index
 */
export async function fetchUnspentOutputs(userId: string): Promise<{
  outputs: GrinOutput[];
  nextChildIndex: number;
}> {
  const outputsResult = await api.getGrinOutputs(userId);
  if (outputsResult.error) {
    throw new Error(`Failed to fetch outputs: ${outputsResult.error}`);
  }

  const { outputs: rawOutputs, next_child_index: nextChildIndex } = outputsResult.data!;

  // Filter to only unspent outputs and convert to GrinOutput format
  const outputs: GrinOutput[] = rawOutputs
    .filter(o => o.status === 'unspent')
    .map(o => ({
      id: o.id,
      keyId: o.key_id,
      nChild: o.n_child,
      amount: BigInt(o.amount),
      commitment: o.commitment,
      isCoinbase: o.is_coinbase,
      blockHeight: o.block_height ?? undefined,
    }));

  return { outputs, nextChildIndex };
}

/**
 * Get current Grin blockchain height.
 *
 * @returns Current block height as BigInt
 * @throws Error if height unavailable
 */
export async function getCurrentBlockHeight(): Promise<bigint> {
  const heightsResult = await api.getBlockchainHeights();
  if (heightsResult.error || !heightsResult.data?.grin) {
    throw new Error('Failed to get blockchain height');
  }
  return BigInt(heightsResult.data.grin);
}
