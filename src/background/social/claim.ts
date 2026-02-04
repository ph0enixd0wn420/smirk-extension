/**
 * Social Tipping Claim Module
 *
 * Handlers for claiming tips (both targeted and public).
 * Uses unified sweep logic from sweep.ts.
 *
 * WASM MODULES - Dynamic import only!
 * - @/lib/grin (Grin voucher claiming)
 */

import type { MessageResponse, AssetType } from '@/types';
import { api } from '@/lib/api';
import {
  decryptTipPayload,
  decryptPublicTipPayload,
  decodeUrlFragmentKey,
  bytesToHex,
  hexToBytes,
} from '@/lib/crypto';
import { isUnlocked, unlockedKeys, grinWasmKeys, setGrinWasmKeys, unlockedMnemonic } from '../state';
import { getWalletState, getAuthState } from '@/lib/storage';
import { getAddressForAsset } from '../wallet';
import { deriveViewKeyFromSpendKey } from './crypto';
import { sweepUtxo, sweepXmrWow, saveFailedSweep } from './sweep';
import type { GrinVoucherData } from './types';

/** Dynamically import Grin wallet module */
async function getGrinModule() {
  return import('@/lib/grin');
}

/**
 * Claim a social tip by decrypting the key and sweeping funds.
 *
 * For BTC/LTC:
 * 1. Claim tip on backend to get encrypted_key + tip_address
 * 2. Decrypt tip private key using recipient's BTC private key
 * 3. Fetch UTXOs from tip address
 * 4. Sweep all funds to recipient's wallet
 *
 * For XMR/WOW:
 * 1. Claim tip on backend to get encrypted_key + tip_address
 * 2. Decrypt spend key using recipient's BTC private key
 * 3. Derive view key from spend key
 * 4. Sweep funds from tip address to recipient's wallet
 *
 * For GRIN (voucher):
 * 1. Claim tip on backend to get encrypted voucher data
 * 2. Decrypt voucher data (blinding factor, commitment, proof, etc.)
 * 3. Build voucher sweep transaction using claimGrinVoucher
 * 4. Broadcast and record the new output
 */
export async function handleClaimSocialTip(
  tipId: string,
  tipAsset: AssetType
): Promise<MessageResponse<{ success: boolean; encryptedKey: string | null; txid?: string }>> {
  try {
    if (!isUnlocked) {
      return { success: false, error: 'Wallet is locked' };
    }

    // Get recipient's BTC private key for decryption (always use BTC key for ECIES)
    const btcPrivateKey = unlockedKeys.get('btc');
    if (!btcPrivateKey) {
      return { success: false, error: 'BTC key not available for decryption' };
    }

    // Step 1: Claim tip on backend to get encrypted_key and tip_address
    const result = await api.claimSocialTip(tipId);

    if (result.error) {
      return { success: false, error: result.error };
    }

    const { encrypted_key, tip_address } = result.data!;

    if (!encrypted_key) {
      return { success: false, error: 'No encrypted key in tip' };
    }

    if (!tip_address) {
      return { success: false, error: 'No tip address - this tip may not have real funds' };
    }

    console.log(`[ClaimTip] Claiming ${tipAsset} from tip address: ${tip_address}`);

    // Step 2: Decrypt tip data
    // Format: ephemeralPubkey (66 hex chars = 33 bytes compressed) || encryptedData
    const ephemeralPubkeyHex = encrypted_key.slice(0, 66);
    const encryptedKeyHex = encrypted_key.slice(66);

    let decryptedData: Uint8Array;
    try {
      decryptedData = decryptTipPayload(encryptedKeyHex, ephemeralPubkeyHex, btcPrivateKey);
    } catch (err) {
      return { success: false, error: 'Failed to decrypt tip data' };
    }

    console.log(`[ClaimTip] Decrypted tip data (${decryptedData.length} bytes)`);

    // Sweep funds based on asset type
    const sweepResult = await sweepFundsForClaim(tipId, tipAsset, decryptedData, tip_address, encrypted_key);

    if (!sweepResult.success) {
      return { success: false, error: sweepResult.error || 'Sweep failed' };
    }

    console.log(`[ClaimTip] Sweep successful: ${sweepResult.txid}`);

    // Confirm sweep on backend - moves tip from 'claiming' to 'claimed'
    const confirmResult = await api.confirmTipSweep(tipId, sweepResult.txid!);
    if (confirmResult.error) {
      console.warn(`[ClaimTip] Failed to confirm sweep: ${confirmResult.error}`);
      // Don't fail the claim - funds were swept successfully
    }

    return {
      success: true,
      data: {
        success: true,
        encryptedKey: encrypted_key,
        txid: sweepResult.txid,
      },
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to claim tip',
    };
  }
}

/**
 * Claim a public tip using URL fragment key (called from website via window.smirk API).
 *
 * Flow:
 * 1. Get tip info from backend
 * 2. Check if tip is claimable (enough confirmations)
 * 3. Decrypt tip data using URL fragment key (symmetric decryption)
 * 4. Sweep funds to user's wallet
 * 5. Mark as claimed on backend
 */
export async function handleClaimPublicTip(
  tipId: string,
  fragmentKey: string
): Promise<MessageResponse<{ success: boolean; txid?: string }>> {
  try {
    if (!isUnlocked) {
      return { success: false, error: 'Wallet is locked' };
    }

    // Step 1: Get public tip info from backend
    const tipInfoResult = await api.getPublicSocialTip(tipId);
    if (tipInfoResult.error || !tipInfoResult.data) {
      return { success: false, error: tipInfoResult.error || 'Failed to get tip info' };
    }

    const tipInfo = tipInfoResult.data;
    const tipAsset = tipInfo.asset as AssetType;

    // Step 2: Check confirmations
    if (tipInfo.funding_confirmations < tipInfo.confirmations_required) {
      return {
        success: false,
        error: `Tip needs ${tipInfo.confirmations_required - tipInfo.funding_confirmations} more confirmations`,
      };
    }

    if (tipInfo.status !== 'pending') {
      return { success: false, error: `Tip is not claimable (status: ${tipInfo.status})` };
    }

    // Step 3: Claim on backend to get encrypted_key
    const claimResult = await api.claimSocialTip(tipId);
    if (claimResult.error || !claimResult.data) {
      return { success: false, error: claimResult.error || 'Failed to claim tip' };
    }

    const { encrypted_key, tip_address } = claimResult.data;

    if (!encrypted_key) {
      return { success: false, error: 'No encrypted key in tip' };
    }

    if (!tip_address) {
      return { success: false, error: 'No tip address - this tip may not have real funds' };
    }

    console.log(`[ClaimPublicTip] Claiming ${tipAsset} from tip address: ${tip_address}`);

    // Step 4: Decrypt tip data using URL fragment key (symmetric)
    let decryptedData: Uint8Array;
    try {
      const keyBytes = decodeUrlFragmentKey(fragmentKey);
      decryptedData = decryptPublicTipPayload(encrypted_key, keyBytes);
    } catch (err) {
      return { success: false, error: 'Invalid claim key - failed to decrypt tip data' };
    }

    console.log(`[ClaimPublicTip] Decrypted tip data (${decryptedData.length} bytes)`);

    // Step 5: Sweep funds
    const sweepResult = await sweepFundsForClaim(tipId, tipAsset, decryptedData, tip_address, encrypted_key);

    if (!sweepResult.success) {
      return { success: false, error: sweepResult.error || 'Sweep failed' };
    }

    console.log(`[ClaimPublicTip] Success! txid=${sweepResult.txid}`);

    // Confirm sweep on backend - moves tip from 'claiming' to 'claimed'
    const confirmResult = await api.confirmTipSweep(tipId, sweepResult.txid!);
    if (confirmResult.error) {
      console.warn(`[ClaimPublicTip] Failed to confirm sweep: ${confirmResult.error}`);
      // Don't fail the claim - funds were swept successfully
    }

    return {
      success: true,
      data: {
        success: true,
        txid: sweepResult.txid,
      },
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to claim tip',
    };
  }
}

/**
 * Internal helper to sweep funds for a claimed tip.
 * Handles all asset types and saves failed sweeps for retry.
 */
async function sweepFundsForClaim(
  tipId: string,
  tipAsset: AssetType,
  decryptedData: Uint8Array,
  tipAddress: string,
  encryptedKey: string
): Promise<{ success: boolean; txid?: string; error?: string }> {
  // Get recipient's address for the tip asset (where to sweep funds)
  const state = await getWalletState();
  const recipientKey = state.keys[tipAsset];
  if (!recipientKey) {
    return { success: false, error: `No ${tipAsset} key found in wallet` };
  }
  const recipientAddress = getAddressForAsset(tipAsset, recipientKey);

  // Handle Grin voucher claiming specially
  if (tipAsset === 'grin') {
    return sweepGrinVoucherForClaim(tipId, decryptedData, recipientAddress);
  }

  // For non-Grin assets, decrypted data is the private key directly
  const tipPrivateKey = decryptedData;

  if (tipAsset === 'btc' || tipAsset === 'ltc') {
    // BTC/LTC sweep using unified sweep logic
    try {
      const result = await sweepUtxo(tipAsset, tipPrivateKey, tipAddress, recipientAddress);
      return { success: true, txid: result.txid };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to sweep funds';
      // Save for retry
      await saveFailedSweep(tipId, tipAsset, encryptedKey, tipAddress, errorMessage);
      return { success: false, error: `${errorMessage}. You can retry claiming this tip.` };
    }
  }

  if (tipAsset === 'xmr' || tipAsset === 'wow') {
    // XMR/WOW sweep using unified sweep logic
    const tipSpendKey = tipPrivateKey;

    console.log(`[ClaimTip] Tip address: ${tipAddress}`);
    console.log(`[ClaimTip] Recipient address: ${recipientAddress}`);

    try {
      const result = await sweepXmrWow(tipAsset, tipSpendKey, tipAddress, recipientAddress);
      return { success: true, txid: result.txid };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to sweep funds';
      // Save for retry
      await saveFailedSweep(tipId, tipAsset, encryptedKey, tipAddress, errorMessage);
      return { success: false, error: `${errorMessage}. You can retry claiming this tip.` };
    }
  }

  return { success: false, error: `Claiming not supported for ${tipAsset}` };
}

/**
 * Sweep a Grin voucher for a claim operation.
 */
async function sweepGrinVoucherForClaim(
  tipId: string,
  decryptedData: Uint8Array,
  recipientAddress: string
): Promise<{ success: boolean; txid?: string; error?: string }> {
  // Decrypted data is JSON containing voucher info
  let voucherData: GrinVoucherData;

  try {
    const jsonStr = new TextDecoder().decode(decryptedData);
    voucherData = JSON.parse(jsonStr);
  } catch (err) {
    return { success: false, error: 'Failed to parse Grin voucher data' };
  }

  console.log(`[ClaimTip] Grin voucher: commitment=${voucherData.commitment.slice(0, 16)}..., amount=${voucherData.amount}`);

  // Ensure Grin WASM wallet is initialized
  const grinModule = await getGrinModule();
  let keys = grinWasmKeys;
  if (!keys) {
    if (!unlockedMnemonic) {
      return { success: false, error: 'Grin wallet not initialized - please re-unlock wallet' };
    }
    keys = await grinModule.initGrinWallet(unlockedMnemonic);
    setGrinWasmKeys(keys);
  }

  // Get auth state for API calls
  const authState = await getAuthState();
  if (!authState?.userId) {
    return { success: false, error: 'Not authenticated' };
  }

  // Get next child index for the new output
  const outputsResult = await api.getGrinOutputs(authState.userId);
  if (outputsResult.error) {
    return { success: false, error: `Failed to fetch Grin outputs: ${outputsResult.error}` };
  }
  const nextChildIndex = outputsResult.data?.next_child_index ?? 0;

  // Get current blockchain height
  const heightsResult = await api.getBlockchainHeights();
  if (heightsResult.error || !heightsResult.data?.grin) {
    return { success: false, error: 'Failed to get Grin blockchain height' };
  }
  const currentHeight = BigInt(heightsResult.data.grin);

  // Convert blinding factor from hex to bytes
  const voucherBlindingFactor = hexToBytes(voucherData.blindingFactor);

  // Build the voucher claim transaction
  let claimResult;
  try {
    claimResult = await grinModule.claimGrinVoucher(
      keys,
      {
        commitment: voucherData.commitment,
        proof: voucherData.proof,
        amount: voucherData.amount,
        features: voucherData.features,
        txSlateId: '', // Not needed for claiming
        keyId: '', // Not needed for claiming
        nChild: voucherData.nChild,
        createdAt: 0,
      },
      voucherBlindingFactor,
      nextChildIndex,
      currentHeight
    );
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to build voucher claim transaction',
    };
  }

  // Record the receive transaction FIRST so broadcastGrinTransaction can update it with kernel_excess
  await api.recordGrinTransaction({
    userId: authState.userId,
    slateId: claimResult.slate.id,
    amount: Number(claimResult.outputInfo.amount),
    fee: Number(claimResult.slate.fee),
    direction: 'receive',
  });

  // Broadcast the claim transaction (this will UPDATE the record with kernel_excess)
  const txJson = grinModule.getTransactionJson(claimResult.slate);
  console.log('[ClaimTip] Broadcasting Grin voucher claim transaction...');

  const broadcastResult = await api.broadcastGrinTransaction({
    userId: authState.userId,
    slateId: claimResult.slate.id,
    tx: txJson,
  });

  if (broadcastResult.error) {
    return { success: false, error: `Grin broadcast failed: ${broadcastResult.error}` };
  }

  console.log(`[ClaimTip] Grin voucher claim broadcast: ${claimResult.slate.id}`);

  // Record the new output
  await api.recordGrinOutput({
    userId: authState.userId,
    keyId: claimResult.outputInfo.keyId,
    nChild: claimResult.outputInfo.nChild,
    amount: Number(claimResult.outputInfo.amount),
    commitment: claimResult.outputInfo.commitment,
    txSlateId: claimResult.slate.id,
  });

  const finalTxid = claimResult.slate.id;
  const actualAmount = Number(claimResult.outputInfo.amount);

  console.log(`[ClaimTip] Grin voucher claimed successfully: ${finalTxid}, received: ${actualAmount} nanogrin`);

  return { success: true, txid: finalTxid };
}
