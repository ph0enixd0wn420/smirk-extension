/**
 * Social Tipping Create Module
 *
 * Tip creation handler for all asset types.
 */

import type { MessageResponse, AssetType, SocialTipResult } from '@/types';
import type { GrinOutput } from '@/lib/grin';
// Static imports — import() is blocked in Chrome MV3 service workers
import * as xmrTx from '@/lib/xmr-tx';
import * as grinModule from '@/lib/grin';
import { api } from '@/lib/api';
import { sha256 } from '@noble/hashes/sha256';
import {
  createEncryptedTipPayload,
  createPublicTipPayload,
  generatePrivateKey,
  generateUrlFragmentKey,
  bytesToHex,
  hexToBytes,
  encrypt,
} from '@/lib/crypto';
import { createSignedTransaction as createBtcSignedTransaction, type Utxo } from '@/lib/btc-tx';
import {
  getWalletState,
  getAuthState,
  addPendingSocialTip,
  type PendingSocialTip,
} from '@/lib/storage';
import { isUnlocked, unlockedKeys, unlockedViewKeys, grinWasmKeys, setGrinWasmKeys, unlockedMnemonic, addPendingTx } from '../state';
import { getAddressForAsset } from '../wallet';
import { getBtcLtcTipAddress, generateXmrWowTipKeys, retryWithBackoff } from './crypto';

// =============================================================================
// Tip Creation Handler
// =============================================================================

/**
 * Create a social tip with ACTUAL fund transfer.
 *
 * For BTC/LTC targeted tips:
 * 1. Generate ephemeral tip keypair
 * 2. Derive tip address from tip public key
 * 3. Send funds from sender's wallet to tip address
 * 4. Encrypt tip private key with recipient's BTC public key (ECIES)
 * 5. Store encrypted_key, tip_address, funding_txid on backend
 *
 * For XMR/WOW targeted tips:
 * 1. Generate random spend key, derive view key and address
 * 2. Send funds from sender's wallet to tip address
 * 3. Encrypt spend key with recipient's BTC public key (ECIES)
 * 4. Store encrypted_key, tip_address, funding_txid on backend
 *
 * For GRIN tips (voucher model):
 * 1. Create voucher transaction with sender's funds
 * 2. Extract blinding factor
 * 3. Encrypt blinding factor + voucher data with recipient's key
 * 4. Store on backend
 */
export async function handleCreateSocialTip(
  platform: string,
  username: string,
  asset: AssetType,
  amount: number,
  recipientBtcPubkey?: string,
  senderAnonymous: boolean = false
): Promise<MessageResponse<SocialTipResult>> {
  try {
    if (!isUnlocked) {
      return { success: false, error: 'Wallet is locked' };
    }

    const isPublic = !platform || !username;

    // Targeted tip: requires recipient's BTC public key for encryption
    if (!isPublic && !recipientBtcPubkey) {
      return { success: false, error: 'Recipient BTC public key required for targeted tips' };
    }

    // For public tips, generate URL fragment key
    let urlFragmentKey: { bytes: Uint8Array; encoded: string } | null = null;
    if (isPublic) {
      urlFragmentKey = generateUrlFragmentKey();
      console.log('[SocialTip] Creating public tip with URL fragment');
    }

    // Get sender's wallet state
    const state = await getWalletState();
    const senderKey = state.keys[asset];
    if (!senderKey) {
      return { success: false, error: `No ${asset} key found in wallet` };
    }
    const senderAddress = getAddressForAsset(asset, senderKey);

    let tipAddress: string;
    let tipPrivateKey: Uint8Array;
    let fundingTxid: string;
    let actualAmount: number;
    let tipViewKeyHex: string | undefined;
    let grinVoucherProof: string | undefined;
    let grinVoucherNChild: number | undefined;

    if (asset === 'btc' || asset === 'ltc') {
      const result = await createBtcLtcTip(asset, senderAddress, amount);
      tipPrivateKey = result.tipPrivateKey;
      tipAddress = result.tipAddress;
      fundingTxid = result.fundingTxid;
      actualAmount = result.actualAmount;
    } else if (asset === 'xmr' || asset === 'wow') {
      const result = await createXmrWowTip(asset, senderAddress, amount);
      tipPrivateKey = result.tipPrivateKey;
      tipAddress = result.tipAddress;
      fundingTxid = result.fundingTxid;
      actualAmount = result.actualAmount;
      tipViewKeyHex = result.tipViewKeyHex;
    } else if (asset === 'grin') {
      const result = await createGrinTip(amount);
      tipPrivateKey = result.tipPrivateKey;
      tipAddress = result.tipAddress;
      fundingTxid = result.fundingTxid;
      actualAmount = result.actualAmount;
      grinVoucherProof = result.grinVoucherProof;
      grinVoucherNChild = result.grinVoucherNChild;
    } else {
      return { success: false, error: `Social tips not supported for ${asset}` };
    }

    // Track pending outgoing for immediate balance deduction (XMR/WOW only —
    // Grin records in backend DB, BTC/LTC have 0-conf so less critical)
    if (asset === 'xmr' || asset === 'wow') {
      await addPendingTx({
        txHash: fundingTxid,
        asset,
        amount: actualAmount,
        fee: 0, // Fee already deducted from sender balance by WASM tx builder
        timestamp: Date.now(),
      });
    }

    // Encrypt tip private key
    let encrypted_key: string;

    if (isPublic) {
      encrypted_key = encryptPublicTip(asset, tipPrivateKey, tipAddress, grinVoucherProof, grinVoucherNChild, actualAmount, urlFragmentKey!.bytes);
    } else {
      encrypted_key = encryptTargetedTip(asset, tipPrivateKey, tipAddress, grinVoucherProof, grinVoucherNChild, actualAmount, recipientBtcPubkey!);
    }

    // Compute claim_key_hash for public tips
    const claim_key_hash = isPublic ? bytesToHex(sha256(urlFragmentKey!.bytes)) : undefined;

    // Create tip on backend
    const result = await api.createSocialTip({
      platform: isPublic ? undefined : platform,
      username: isPublic ? undefined : username,
      asset,
      amount: actualAmount!,
      is_public: isPublic,
      encrypted_key,
      claim_key_hash,
      tip_address: tipAddress,
      funding_txid: fundingTxid!,
      tip_view_key: tipViewKeyHex,
      sender_anonymous: senderAnonymous,
    });

    if (result.error) {
      console.error('[SocialTip] Backend failed after broadcast:', result.error);
      return {
        success: false,
        error: `Tip funded but backend error: ${result.error}. Funds at ${tipAddress}`,
      };
    }

    console.log(`[SocialTip] Tip created successfully: ${result.data!.tip_id}`);

    // Store tip key locally for clawback
    await storeTipKeyLocally(
      result.data!.tip_id,
      asset,
      actualAmount,
      tipAddress,
      fundingTxid,
      tipPrivateKey,
      grinVoucherProof,
      grinVoucherNChild,
      platform,
      username,
      isPublic,
      urlFragmentKey?.encoded,
      state.seedSalt
    );

    return {
      success: true,
      data: {
        tipId: result.data!.tip_id,
        status: result.data!.status,
        isPublic,
      },
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to create tip',
    };
  }
}

// =============================================================================
// Asset-Specific Tip Creation
// =============================================================================

interface TipCreationResult {
  tipPrivateKey: Uint8Array;
  tipAddress: string;
  fundingTxid: string;
  actualAmount: number;
  tipViewKeyHex?: string;
  grinVoucherProof?: string;
  grinVoucherNChild?: number;
}

async function createBtcLtcTip(
  asset: 'btc' | 'ltc',
  senderAddress: string,
  amount: number
): Promise<TipCreationResult> {
  const senderPrivateKey = unlockedKeys.get(asset);
  if (!senderPrivateKey) {
    throw new Error(`No ${asset} key available`);
  }

  // Generate ephemeral tip keypair
  const tipPrivateKey = generatePrivateKey();
  const tipAddress = getBtcLtcTipAddress(asset, tipPrivateKey);

  console.log(`[SocialTip] Generated ${asset} tip address: ${tipAddress}`);

  // Fetch UTXOs
  const utxoResult = await api.getUtxos(asset, senderAddress);
  if (utxoResult.error || !utxoResult.data) {
    throw new Error(utxoResult.error || 'Failed to fetch UTXOs');
  }

  const utxos: Utxo[] = utxoResult.data.utxos;
  if (utxos.length === 0) {
    throw new Error('No UTXOs available');
  }

  // Estimate fee
  const feeResult = await api.estimateFee(asset);
  const feeRate = feeResult.data?.normal ?? 10;

  // Build and sign transaction
  const txResult = createBtcSignedTransaction(
    asset,
    utxos,
    tipAddress,
    amount,
    senderAddress,
    senderPrivateKey,
    feeRate,
    false
  );

  // Broadcast
  const broadcastResult = await api.broadcastTx(asset, txResult.txHex);
  if (broadcastResult.error) {
    throw new Error(`Broadcast failed: ${broadcastResult.error}`);
  }

  console.log(`[SocialTip] ${asset.toUpperCase()} broadcast successful: ${broadcastResult.data!.txid}`);

  return {
    tipPrivateKey,
    tipAddress,
    fundingTxid: broadcastResult.data!.txid,
    actualAmount: txResult.actualAmount,
  };
}

async function createXmrWowTip(
  asset: 'xmr' | 'wow',
  senderAddress: string,
  amount: number
): Promise<TipCreationResult> {
  const senderSpendKey = unlockedKeys.get(asset);
  const senderViewKey = unlockedViewKeys.get(asset);
  if (!senderSpendKey || !senderViewKey) {
    throw new Error(`No ${asset} keys available`);
  }

  // Get auth state for LWS registration
  const authState = await getAuthState();
  if (!authState?.userId) {
    throw new Error('Not authenticated');
  }

  // Generate tip wallet keys
  const tipKeys = generateXmrWowTipKeys(asset);
  const tipPrivateKey = tipKeys.spendKey;
  const tipAddress = tipKeys.address;

  console.log(`[SocialTip] Generated ${asset} tip address: ${tipAddress}`);

  // Register tip address with LWS
  const viewKeyHexForRegistration = bytesToHex(tipKeys.viewKey);
  console.log(`[SocialTip] Registering ${asset} tip address with LWS...`);
  await retryWithBackoff(async () => {
    const registerResult = await api.registerLws(authState.userId, asset, tipAddress, viewKeyHexForRegistration);
    if (registerResult.error) {
      throw new Error(registerResult.error);
    }
  }, 3, 500);
  console.log(`[SocialTip] Tip address registered with LWS`);

  // Send funds to tip address
  const txResult = await xmrTx.sendTransaction(
    asset,
    senderAddress,
    bytesToHex(senderViewKey),
    bytesToHex(senderSpendKey),
    tipAddress,
    amount,
    'mainnet',
    false
  );

  console.log(`[SocialTip] ${asset.toUpperCase()} tx sent: ${txResult.txHash}, amount: ${txResult.actualAmount}`);

  return {
    tipPrivateKey,
    tipAddress,
    fundingTxid: txResult.txHash,
    actualAmount: txResult.actualAmount,
    tipViewKeyHex: viewKeyHexForRegistration,
  };
}

async function createGrinTip(amount: number): Promise<TipCreationResult> {
  // Ensure Grin WASM wallet is initialized
  let keys = grinWasmKeys;
  if (!keys) {
    if (!unlockedMnemonic) {
      throw new Error('Grin wallet not initialized - please re-unlock wallet');
    }
    keys = await grinModule.initGrinWallet(unlockedMnemonic);
    setGrinWasmKeys(keys);
  }

  // Get auth state
  const authState = await getAuthState();
  if (!authState?.userId) {
    throw new Error('Not authenticated');
  }

  // Fetch UTXOs
  const outputsResult = await api.getGrinOutputs(authState.userId);
  if (outputsResult.error) {
    throw new Error(`Failed to fetch Grin outputs: ${outputsResult.error}`);
  }

  const { outputs: rawOutputs, next_child_index: nextChildIndex } = outputsResult.data!;

  // Filter to unspent outputs
  const grinOutputs: GrinOutput[] = rawOutputs
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

  if (grinOutputs.length === 0) {
    throw new Error('No unspent Grin outputs available');
  }

  // Get blockchain height
  const heightsResult = await api.getBlockchainHeights();
  if (heightsResult.error || !heightsResult.data?.grin) {
    throw new Error('Failed to get Grin blockchain height');
  }
  const currentHeight = BigInt(heightsResult.data.grin);

  console.log(`[SocialTip] Creating Grin voucher for ${amount} nanogrin`);

  // Create voucher transaction
  const voucherResult = await grinModule.createGrinVoucherTransaction(
    keys,
    grinOutputs,
    BigInt(amount),
    currentHeight,
    nextChildIndex
  );

  // Record send transaction FIRST
  await api.recordGrinTransaction({
    userId: authState.userId,
    slateId: voucherResult.slate.id,
    amount: Number(voucherResult.voucherOutput.amount),
    fee: Number(voucherResult.slate.fee),
    direction: 'send',
  });

  // Broadcast
  const txJson = grinModule.getTransactionJson(voucherResult.slate);
  console.log('[SocialTip] Broadcasting Grin voucher transaction...');

  const broadcastResult = await api.broadcastGrinTransaction({
    userId: authState.userId,
    slateId: voucherResult.slate.id,
    tx: txJson,
  });

  if (broadcastResult.error) {
    throw new Error(`Grin broadcast failed: ${broadcastResult.error}`);
  }

  console.log(`[SocialTip] Grin voucher tx broadcast: ${voucherResult.slate.id}`);

  // Mark inputs as spent
  await api.spendGrinOutputs({
    userId: authState.userId,
    txSlateId: voucherResult.slate.id,
  });

  // Record voucher output
  await api.recordGrinOutput({
    userId: authState.userId,
    keyId: voucherResult.voucherOutput.keyId,
    nChild: voucherResult.voucherOutput.nChild,
    amount: Number(voucherResult.voucherOutput.amount),
    commitment: voucherResult.voucherOutput.commitment,
    txSlateId: voucherResult.slate.id,
  });

  // Record change output if any
  if (voucherResult.changeOutput) {
    await api.recordGrinOutput({
      userId: authState.userId,
      keyId: voucherResult.changeOutput.keyId,
      nChild: voucherResult.changeOutput.nChild,
      amount: Number(voucherResult.changeOutput.amount),
      commitment: voucherResult.changeOutput.commitment,
      txSlateId: voucherResult.slate.id,
    });
  }

  return {
    tipPrivateKey: voucherResult.voucherBlindingFactor,
    tipAddress: voucherResult.voucherOutput.commitment,
    fundingTxid: voucherResult.slate.id,
    actualAmount: Number(voucherResult.voucherOutput.amount),
    grinVoucherProof: voucherResult.voucherOutput.proof,
    grinVoucherNChild: voucherResult.voucherOutput.nChild,
  };
}

// =============================================================================
// Encryption Helpers
// =============================================================================

function encryptPublicTip(
  asset: AssetType,
  tipPrivateKey: Uint8Array,
  tipAddress: string,
  grinVoucherProof: string | undefined,
  grinVoucherNChild: number | undefined,
  actualAmount: number,
  fragmentKey: Uint8Array
): string {
  if (asset === 'grin') {
    const grinVoucherDataJson = JSON.stringify({
      blindingFactor: bytesToHex(tipPrivateKey),
      commitment: tipAddress,
      proof: grinVoucherProof,
      nChild: grinVoucherNChild,
      amount: actualAmount,
      features: 0,
    });
    const voucherDataBytes = new TextEncoder().encode(grinVoucherDataJson);
    return createPublicTipPayload(voucherDataBytes, fragmentKey);
  } else {
    return createPublicTipPayload(tipPrivateKey, fragmentKey);
  }
}

function encryptTargetedTip(
  asset: AssetType,
  tipPrivateKey: Uint8Array,
  tipAddress: string,
  grinVoucherProof: string | undefined,
  grinVoucherNChild: number | undefined,
  actualAmount: number,
  recipientBtcPubkey: string
): string {
  const recipientPubkeyBytes = hexToBytes(recipientBtcPubkey);

  if (asset === 'grin') {
    const grinVoucherDataJson = JSON.stringify({
      blindingFactor: bytesToHex(tipPrivateKey),
      commitment: tipAddress,
      proof: grinVoucherProof,
      nChild: grinVoucherNChild,
      amount: actualAmount,
      features: 0,
    });
    const voucherDataBytes = new TextEncoder().encode(grinVoucherDataJson);
    const { encryptedKey, ephemeralPubkey } = createEncryptedTipPayload(voucherDataBytes, recipientPubkeyBytes);
    console.log(`[SocialTip] Encrypted Grin voucher data (${voucherDataBytes.length} bytes)`);
    return ephemeralPubkey + encryptedKey;
  } else {
    const { encryptedKey, ephemeralPubkey } = createEncryptedTipPayload(tipPrivateKey, recipientPubkeyBytes);
    return ephemeralPubkey + encryptedKey;
  }
}

// =============================================================================
// Local Storage
// =============================================================================

async function storeTipKeyLocally(
  tipId: string,
  asset: AssetType,
  actualAmount: number,
  tipAddress: string,
  fundingTxid: string,
  tipPrivateKey: Uint8Array,
  grinVoucherProof: string | undefined,
  grinVoucherNChild: number | undefined,
  platform: string,
  username: string,
  isPublic: boolean,
  publicFragmentKey: string | undefined,
  seedSalt: string | undefined
): Promise<void> {
  if (!seedSalt) return;

  try {
    const senderBtcKey = unlockedKeys.get('btc');
    if (!senderBtcKey) return;

    // Use BTC private key hash as encryption key for tip storage
    const tipStorageKey = sha256(senderBtcKey);

    // For Grin, store the full voucher data
    let dataToEncrypt: Uint8Array;
    if (asset === 'grin') {
      const grinVoucherDataJson = JSON.stringify({
        blindingFactor: bytesToHex(tipPrivateKey),
        commitment: tipAddress,
        proof: grinVoucherProof,
        nChild: grinVoucherNChild,
        amount: actualAmount,
        features: 0,
      });
      dataToEncrypt = new TextEncoder().encode(grinVoucherDataJson);
    } else {
      dataToEncrypt = tipPrivateKey;
    }

    const encryptedTipKey = encrypt(dataToEncrypt, tipStorageKey);
    const encryptedTipKeyHex = bytesToHex(encryptedTipKey);

    const pendingTip: PendingSocialTip = {
      tipId,
      asset,
      amount: actualAmount,
      tipAddress,
      fundingTxid,
      encryptedTipKey: encryptedTipKeyHex,
      encryptedTipKeySalt: seedSalt,
      recipientPlatform: platform,
      recipientUsername: username,
      createdAt: Date.now(),
      status: 'pending',
      isPublic,
      publicFragmentKey,
    };

    await addPendingSocialTip(pendingTip);
    console.log(`[SocialTip] Stored tip key locally for clawback`);
  } catch (err) {
    console.warn('[SocialTip] Failed to store tip key locally:', err);
  }
}
