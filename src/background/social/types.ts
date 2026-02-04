/**
 * Social Tipping Types
 *
 * Shared interfaces used across social tipping modules.
 */

import type { AssetType } from '@/types';

/**
 * Grin voucher data structure (parsed from encrypted JSON).
 */
export interface GrinVoucherData {
  blindingFactor: string;
  commitment: string;
  proof: string;
  nChild: number;
  amount: number;
  features: number;
}

/**
 * Result of a sweep operation.
 */
export interface SweepResult {
  txid: string;
  amount: number;
}

/**
 * Parameters for BTC/LTC sweep.
 */
export interface UtxoSweepParams {
  asset: 'btc' | 'ltc';
  tipPrivateKey: Uint8Array;
  tipAddress: string;
  recipientAddress: string;
}

/**
 * Parameters for XMR/WOW sweep.
 */
export interface XmrWowSweepParams {
  asset: 'xmr' | 'wow';
  tipSpendKey: Uint8Array;
  tipAddress: string;
  recipientAddress: string;
}

/**
 * Parameters for Grin voucher sweep.
 */
export interface GrinSweepParams {
  asset: 'grin';
  voucherData: GrinVoucherData;
  recipientUserId: string;
}

/**
 * Union type for all sweep parameters.
 */
export type SweepParams = UtxoSweepParams | XmrWowSweepParams | GrinSweepParams;

/**
 * XMR/WOW tip wallet keys.
 */
export interface XmrWowTipKeys {
  spendKey: Uint8Array;
  viewKey: Uint8Array;
  publicSpendKey: Uint8Array;
  publicViewKey: Uint8Array;
  address: string;
}
