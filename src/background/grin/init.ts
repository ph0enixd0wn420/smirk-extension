/**
 * Grin Wallet Initialization
 *
 * Initialize the Grin WASM wallet from mnemonic.
 */

import type { MessageResponse } from '@/types';
import {
  isUnlocked,
  grinWasmKeys,
  setGrinWasmKeys,
  unlockedMnemonic,
  persistSessionKeys,
} from '../state';
import { getGrinModule } from './helpers';

// =============================================================================
// Wallet Initialization
// =============================================================================

/**
 * Initialize the Grin WASM wallet and return the slatepack address.
 *
 * The Grin wallet uses MWC's WebAssembly implementation for all
 * cryptographic operations. Keys are derived from the BIP39 mnemonic
 * using the MWC Seed class.
 *
 * Keys can be initialized from:
 * 1. Cached grinWasmKeys (already initialized this session)
 * 2. Session storage (restored after service worker restart)
 * 3. Mnemonic (fresh unlock - derives keys and persists to session)
 *
 * @returns Slatepack address (bech32-encoded ed25519 pubkey for receiving)
 */
export async function handleInitGrinWallet(): Promise<MessageResponse<{
  slatepackAddress: string;
}>> {
  if (!isUnlocked) {
    return { success: false, error: 'Wallet is locked' };
  }

  // Return cached keys if already initialized (or restored from session)
  if (grinWasmKeys) {
    return {
      success: true,
      data: { slatepackAddress: grinWasmKeys.slatepackAddress },
    };
  }

  // MWC Seed class requires the mnemonic string, not the 64-byte BIP39 seed
  // Valid seed lengths for MWC are 16/20/24/28/32 bytes (raw entropy), not 64 bytes
  if (!unlockedMnemonic) {
    return { success: false, error: 'Mnemonic not available - please re-unlock wallet' };
  }

  try {
    // Initialize Grin WASM wallet with mnemonic
    const keys = await (await getGrinModule()).initGrinWallet(unlockedMnemonic);
    setGrinWasmKeys(keys);

    // Persist the extended key to session storage so it survives service worker restarts
    // NOTE: We only store the extended key, NOT the mnemonic - this limits exposure to Grin only
    await persistSessionKeys();

    return {
      success: true,
      data: { slatepackAddress: keys.slatepackAddress },
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to initialize Grin wallet',
    };
  }
}
