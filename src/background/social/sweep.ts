/**
 * Social Tipping Sweep Module
 *
 * Unified sweep logic for all asset types. This module consolidates the
 * duplicated sweep code from claim, public claim, clawback, and retry functions.
 */

import type { MessageResponse } from '@/types';
import { api } from '@/lib/api';
import { bytesToHex, hexToBytes } from '@/lib/crypto';
import { createSignedTransaction as createBtcSignedTransaction, type Utxo } from '@/lib/btc-tx';
// Static imports — import() is blocked in Chrome MV3 service workers
import * as xmrTx from '@/lib/xmr-tx';
import * as grinModule from '@/lib/grin';
import { getAuthState, getWalletState, getPendingSweep, getPendingSweeps, savePendingSweep, removePendingSweep, type PendingSweep } from '@/lib/storage';
import { isUnlocked, unlockedKeys, grinWasmKeys, setGrinWasmKeys, unlockedMnemonic } from '../state';
import { getAddressForAsset } from '../wallet';
import { deriveViewKeyFromSpendKey } from './crypto';
import type { GrinVoucherData, SweepResult } from './types';

// =============================================================================
// UTXO Sweep (BTC/LTC)
// =============================================================================

/**
 * Sweep funds from a BTC/LTC tip address.
 */
export async function sweepUtxo(
  asset: 'btc' | 'ltc',
  tipPrivateKey: Uint8Array,
  tipAddress: string,
  recipientAddress: string
): Promise<SweepResult> {
  // Fetch UTXOs from tip address
  const utxoResult = await api.getUtxos(asset, tipAddress);
  if (utxoResult.error || !utxoResult.data) {
    throw new Error(utxoResult.error || 'Failed to fetch tip UTXOs');
  }

  const utxos: Utxo[] = utxoResult.data.utxos;
  if (utxos.length === 0) {
    throw new Error('No UTXOs at tip address - funds may already be claimed');
  }

  const totalValue = utxos.reduce((sum, u) => sum + u.value, 0);
  console.log(`[Sweep] Found ${utxos.length} UTXOs with total value: ${totalValue}`);

  // Get fee estimate
  const feeResult = await api.estimateFee(asset);
  const feeRate = feeResult.data?.normal ?? 10;

  // Build sweep transaction
  const txResult = createBtcSignedTransaction(
    asset,
    utxos,
    recipientAddress,
    0,
    recipientAddress,
    tipPrivateKey,
    feeRate,
    true // sweep mode
  );

  // Broadcast
  const broadcastResult = await api.broadcastTx(asset, txResult.txHex);
  if (broadcastResult.error) {
    throw new Error(`Sweep broadcast failed: ${broadcastResult.error}`);
  }

  return {
    txid: broadcastResult.data!.txid,
    amount: txResult.actualAmount,
  };
}

// =============================================================================
// XMR/WOW Sweep
// =============================================================================

/**
 * Sweep funds from an XMR/WOW tip address.
 */
export async function sweepXmrWow(
  asset: 'xmr' | 'wow',
  tipSpendKey: Uint8Array,
  tipAddress: string,
  recipientAddress: string
): Promise<SweepResult> {
  const tipViewKey = deriveViewKeyFromSpendKey(tipSpendKey);

  console.log(`[Sweep] Sweeping ${asset} from ${tipAddress} to ${recipientAddress}`);

  const txResult = await xmrTx.sendTransaction(
    asset,
    tipAddress,
    bytesToHex(tipViewKey),
    bytesToHex(tipSpendKey),
    recipientAddress,
    0, // amount ignored for sweep
    'mainnet',
    true // sweep mode
  );

  // Deactivate tip address from LWS to save server resources
  console.log(`[Sweep] Deactivating ${asset} tip address from LWS...`);
  api.deactivateLws(asset, tipAddress).then(result => {
    if (result.error) {
      console.warn(`[Sweep] Failed to deactivate LWS address:`, result.error);
    } else {
      console.log(`[Sweep] LWS address deactivated`);
    }
  }).catch(err => {
    console.warn(`[Sweep] Failed to deactivate LWS address:`, err);
  });

  return {
    txid: txResult.txHash,
    amount: txResult.actualAmount,
  };
}

// =============================================================================
// Grin Voucher Sweep
// =============================================================================

/**
 * Claim a Grin voucher (sweep to recipient's wallet).
 */
export async function sweepGrinVoucher(
  voucherData: GrinVoucherData,
  recipientUserId: string
): Promise<SweepResult> {
  console.log(`[Sweep] Grin voucher: commitment=${voucherData.commitment.slice(0, 16)}..., amount=${voucherData.amount}`);

  // Ensure Grin WASM wallet is initialized
  let keys = grinWasmKeys;
  if (!keys) {
    if (!unlockedMnemonic) {
      throw new Error('Grin wallet not initialized - please re-unlock wallet');
    }
    keys = await grinModule.initGrinWallet(unlockedMnemonic);
    setGrinWasmKeys(keys);
  }

  // Get next child index for the new output
  const outputsResult = await api.getGrinOutputs(recipientUserId);
  if (outputsResult.error) {
    throw new Error(`Failed to fetch Grin outputs: ${outputsResult.error}`);
  }
  const nextChildIndex = outputsResult.data?.next_child_index ?? 0;

  // Get current blockchain height
  const heightsResult = await api.getBlockchainHeights();
  if (heightsResult.error || !heightsResult.data?.grin) {
    throw new Error('Failed to get Grin blockchain height');
  }
  const currentHeight = BigInt(heightsResult.data.grin);

  // Convert blinding factor from hex to bytes
  const voucherBlindingFactor = hexToBytes(voucherData.blindingFactor);

  // Build the voucher claim transaction
  const claimResult = await grinModule.claimGrinVoucher(
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

  // Record the receive transaction FIRST so broadcastGrinTransaction can update it with kernel_excess
  await api.recordGrinTransaction({
    userId: recipientUserId,
    slateId: claimResult.slate.id,
    amount: Number(claimResult.outputInfo.amount),
    fee: Number(claimResult.slate.fee),
    direction: 'receive',
  });

  // Broadcast the claim transaction
  const txJson = grinModule.getTransactionJson(claimResult.slate);
  console.log('[Sweep] Broadcasting Grin voucher claim transaction...');

  const broadcastResult = await api.broadcastGrinTransaction({
    userId: recipientUserId,
    slateId: claimResult.slate.id,
    tx: txJson,
  });

  if (broadcastResult.error) {
    throw new Error(`Grin broadcast failed: ${broadcastResult.error}`);
  }

  console.log(`[Sweep] Grin voucher claim broadcast: ${claimResult.slate.id}`);

  // Record the new output
  await api.recordGrinOutput({
    userId: recipientUserId,
    keyId: claimResult.outputInfo.keyId,
    nChild: claimResult.outputInfo.nChild,
    amount: Number(claimResult.outputInfo.amount),
    commitment: claimResult.outputInfo.commitment,
    txSlateId: claimResult.slate.id,
  });

  return {
    txid: claimResult.slate.id,
    amount: Number(claimResult.outputInfo.amount),
  };
}

// =============================================================================
// Retry Sweep Handler
// =============================================================================

/**
 * Retry a failed sweep for a claimed tip.
 *
 * When a tip is claimed but the sweep broadcast fails (network error, etc.),
 * the tip data is saved locally. This function retries the sweep.
 */
export async function handleRetrySweep(
  tipId: string,
  decryptTipPayload: (encryptedKeyHex: string, ephemeralPubkeyHex: string, privateKey: Uint8Array) => Uint8Array
): Promise<MessageResponse<{ success: boolean; txid?: string }>> {
  try {
    if (!isUnlocked) {
      return { success: false, error: 'Wallet is locked' };
    }

    // Get pending sweep data
    const pendingSweep = await getPendingSweep(tipId);
    if (!pendingSweep) {
      return { success: false, error: 'No pending sweep found for this tip' };
    }

    const { asset: tipAsset, encryptedKey: encrypted_key, tipAddress: tip_address } = pendingSweep;

    console.log(`[RetrySweep] Retrying sweep for ${tipAsset} tip ${tipId}, attempt ${pendingSweep.retryCount + 1}`);

    // Get recipient's BTC private key for decryption
    const btcPrivateKey = unlockedKeys.get('btc');
    if (!btcPrivateKey) {
      return { success: false, error: 'BTC key not available for decryption' };
    }

    // Decrypt tip key
    const ephemeralPubkeyHex = encrypted_key.slice(0, 66);
    const encryptedKeyHex = encrypted_key.slice(66);

    let decryptedData: Uint8Array;
    try {
      decryptedData = decryptTipPayload(encryptedKeyHex, ephemeralPubkeyHex, btcPrivateKey);
    } catch (err) {
      return { success: false, error: 'Failed to decrypt tip data' };
    }

    // Get recipient address from wallet state
    const state = await getWalletState();
    const recipientKey = state.keys[tipAsset];
    if (!recipientKey) {
      return { success: false, error: `No ${tipAsset.toUpperCase()} key found in wallet` };
    }
    const recipientAddress = getAddressForAsset(tipAsset, recipientKey);

    let sweepResult: SweepResult;

    try {
      if (tipAsset === 'btc' || tipAsset === 'ltc') {
        sweepResult = await sweepUtxo(tipAsset, decryptedData, tip_address, recipientAddress);
      } else if (tipAsset === 'xmr' || tipAsset === 'wow') {
        sweepResult = await sweepXmrWow(tipAsset, decryptedData, tip_address, recipientAddress);
      } else {
        return { success: false, error: `Retry not supported for ${tipAsset}` };
      }
    } catch (err) {
      // Update retry count and error
      const errorMessage = err instanceof Error ? err.message : 'Failed to sweep funds';

      // Check if error indicates no funds (already swept)
      if (errorMessage.includes('No UTXOs') || errorMessage.includes('No funds')) {
        await removePendingSweep(tipId);
        return { success: false, error: 'No funds found at tip address - may have already been swept' };
      }

      await savePendingSweep({
        ...pendingSweep,
        retryCount: pendingSweep.retryCount + 1,
        lastError: errorMessage,
      });
      return {
        success: false,
        error: `${errorMessage}. You can retry again.`,
      };
    }

    // Success - remove pending sweep and confirm on backend
    await removePendingSweep(tipId);
    console.log(`[RetrySweep] Sweep successful: ${sweepResult.txid}`);

    // Confirm sweep on backend
    const confirmResult = await api.confirmTipSweep(tipId, sweepResult.txid);
    if (confirmResult.error) {
      console.warn(`[RetrySweep] Failed to confirm sweep: ${confirmResult.error}`);
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
      error: err instanceof Error ? err.message : 'Failed to retry sweep',
    };
  }
}

/**
 * Get all pending sweeps that need retry.
 */
export async function handleGetPendingSweeps(): Promise<MessageResponse<PendingSweep[]>> {
  try {
    const sweeps = await getPendingSweeps();
    return { success: true, data: sweeps };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to get pending sweeps',
    };
  }
}

/**
 * Save a failed sweep for later retry.
 */
export async function saveFailedSweep(
  tipId: string,
  asset: 'btc' | 'ltc' | 'xmr' | 'wow',
  encryptedKey: string,
  tipAddress: string,
  errorMessage: string
): Promise<void> {
  const existingSweep = await getPendingSweep(tipId);
  await savePendingSweep({
    tipId,
    asset,
    encryptedKey,
    tipAddress,
    createdAt: existingSweep?.createdAt ?? Date.now(),
    retryCount: (existingSweep?.retryCount ?? 0) + 1,
    lastError: errorMessage,
  });
  console.error(`[Sweep] Sweep failed, saved for retry: ${errorMessage}`);
}
