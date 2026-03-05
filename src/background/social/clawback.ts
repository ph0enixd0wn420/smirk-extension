/**
 * Social Tipping Clawback Module
 *
 * Handler for sender to reclaim unclaimed tip funds.
 */

import type { MessageResponse, AssetType } from '@/types';
import { api } from '@/lib/api';
import { bytesToHex, hexToBytes, decrypt } from '@/lib/crypto';
import { sha256 } from '@noble/hashes/sha256';
// Static import — import() is blocked in Chrome MV3 service workers
import * as grinModule from '@/lib/grin';
import { isUnlocked, unlockedKeys, grinWasmKeys, setGrinWasmKeys, unlockedMnemonic } from '../state';
import {
  getWalletState,
  getAuthState,
  getPendingSocialTip,
  updatePendingSocialTipStatus,
} from '@/lib/storage';
import { getAddressForAsset } from '../wallet';
import { deriveViewKeyFromSpendKey } from './crypto';
import { sweepUtxo, sweepXmrWow } from './sweep';
import type { GrinVoucherData } from './types';

/**
 * Clawback a tip (sender reclaims unclaimed funds).
 *
 * 1. Get stored tip key from local storage
 * 2. Decrypt tip private key using sender's BTC key
 * 3. Sweep funds from tip address back to sender's wallet
 * 4. Mark as clawed back on backend
 */
export async function handleClawbackSocialTip(
  tipId: string
): Promise<MessageResponse<{ success: boolean; txid?: string }>> {
  try {
    if (!isUnlocked) {
      return { success: false, error: 'Wallet is locked' };
    }

    // Get stored tip info
    const pendingTip = await getPendingSocialTip(tipId);
    if (!pendingTip) {
      return { success: false, error: 'Tip not found in local storage - cannot clawback' };
    }

    if (pendingTip.status !== 'pending') {
      return { success: false, error: `Tip already ${pendingTip.status}` };
    }

    const tipAsset = pendingTip.asset as AssetType;

    // Get sender's BTC key to decrypt the stored tip key
    const senderBtcKey = unlockedKeys.get('btc');
    if (!senderBtcKey) {
      return { success: false, error: 'BTC key not available' };
    }

    // Decrypt the stored tip key
    const tipStorageKey = sha256(senderBtcKey);
    let tipPrivateKey: Uint8Array;
    try {
      tipPrivateKey = decrypt(hexToBytes(pendingTip.encryptedTipKey), tipStorageKey);
    } catch (err) {
      return { success: false, error: 'Failed to decrypt stored tip key' };
    }

    // Get sender's address for this asset (where to sweep funds back)
    const state = await getWalletState();
    const senderKey = state.keys[tipAsset];
    if (!senderKey) {
      return { success: false, error: `No ${tipAsset} key found in wallet` };
    }
    const senderAddress = getAddressForAsset(tipAsset, senderKey);

    console.log(`[Clawback] Sweeping ${tipAsset} from ${pendingTip.tipAddress} to ${senderAddress}`);

    let finalTxid: string;

    if (tipAsset === 'btc' || tipAsset === 'ltc') {
      // BTC/LTC sweep using unified sweep logic
      try {
        const result = await sweepUtxo(tipAsset, tipPrivateKey, pendingTip.tipAddress, senderAddress);
        finalTxid = result.txid;
      } catch (err) {
        // Check if no UTXOs - tip may have already been claimed
        const errorMessage = err instanceof Error ? err.message : 'Failed to sweep';
        if (errorMessage.includes('No UTXOs') || errorMessage.includes('No funds')) {
          // Mark as clawed back anyway on backend
          await api.clawbackSocialTip(tipId);
          await updatePendingSocialTipStatus(tipId, 'clawed_back');
          return { success: false, error: 'No funds at tip address - may have been claimed' };
        }
        return { success: false, error: errorMessage };
      }
    } else if (tipAsset === 'xmr' || tipAsset === 'wow') {
      // XMR/WOW sweep using unified sweep logic
      const tipSpendKey = tipPrivateKey;

      try {
        const result = await sweepXmrWow(tipAsset, tipSpendKey, pendingTip.tipAddress, senderAddress);
        finalTxid = result.txid;
      } catch (err) {
        return {
          success: false,
          error: err instanceof Error ? err.message : 'Failed to sweep funds',
        };
      }
    } else if (tipAsset === 'grin') {
      // GRIN clawback - sender sweeps the voucher
      const result = await sweepGrinVoucherForClawback(tipPrivateKey);
      if (!result.success) {
        return { success: false, error: result.error || 'Clawback failed' };
      }
      finalTxid = result.txid!;
    } else {
      return { success: false, error: `Clawback not supported for ${tipAsset}` };
    }

    console.log(`[Clawback] Sweep successful: ${finalTxid}`);

    // Mark as clawed back on backend and locally
    await api.clawbackSocialTip(tipId);
    await updatePendingSocialTipStatus(tipId, 'clawed_back');

    return {
      success: true,
      data: { success: true, txid: finalTxid },
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to clawback tip',
    };
  }
}

/**
 * Sweep a Grin voucher for clawback operation.
 */
async function sweepGrinVoucherForClawback(
  tipPrivateKeyData: Uint8Array
): Promise<{ success: boolean; txid?: string; error?: string }> {
  // The stored tip data is JSON containing the full voucher info
  let voucherData: GrinVoucherData;

  try {
    const jsonStr = new TextDecoder().decode(tipPrivateKeyData);
    voucherData = JSON.parse(jsonStr);
  } catch (err) {
    return { success: false, error: 'Failed to parse stored Grin voucher data' };
  }

  console.log(`[Clawback] Grin voucher: commitment=${voucherData.commitment.slice(0, 16)}..., amount=${voucherData.amount}`);

  // Ensure Grin WASM wallet is initialized
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

  // Build the voucher sweep transaction (same as claiming)
  let claimResult;
  try {
    claimResult = await grinModule.claimGrinVoucher(
      keys,
      {
        commitment: voucherData.commitment,
        proof: voucherData.proof,
        amount: voucherData.amount,
        features: voucherData.features,
        txSlateId: '',
        keyId: '',
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
      error: err instanceof Error ? err.message : 'Failed to build clawback transaction',
    };
  }

  // Record the receive transaction FIRST so broadcastGrinTransaction can update it with kernel_excess
  // (clawback is a receive for the sender)
  await api.recordGrinTransaction({
    userId: authState.userId,
    slateId: claimResult.slate.id,
    amount: Number(claimResult.outputInfo.amount),
    fee: Number(claimResult.slate.fee),
    direction: 'receive',
  });

  // Broadcast the clawback transaction (this will UPDATE the record with kernel_excess)
  const txJson = grinModule.getTransactionJson(claimResult.slate);
  console.log('[Clawback] Broadcasting Grin voucher clawback transaction...');

  const broadcastResult = await api.broadcastGrinTransaction({
    userId: authState.userId,
    slateId: claimResult.slate.id,
    tx: txJson,
  });

  if (broadcastResult.error) {
    return { success: false, error: `Grin broadcast failed: ${broadcastResult.error}` };
  }

  console.log(`[Clawback] Grin voucher clawback broadcast: ${claimResult.slate.id}`);

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

  console.log(`[Clawback] Grin voucher clawed back: ${finalTxid}, recovered: ${actualAmount} nanogrin`);

  return { success: true, txid: finalTxid };
}
