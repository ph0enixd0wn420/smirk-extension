/**
 * Social Tipping Crypto Helpers
 *
 * Pure cryptographic helpers for social tipping.
 * NO WASM DEPENDENCIES - safe for service worker startup.
 */

import { sha256 } from '@noble/hashes/sha256';
import { ed25519 } from '@noble/curves/ed25519';
import { getPublicKey, randomBytes } from '@/lib/crypto';
import { btcAddress, ltcAddress, xmrAddress, wowAddress } from '@/lib/address';
import type { XmrWowTipKeys } from './types';

/**
 * Generate tip address from a private key for BTC or LTC.
 */
export function getBtcLtcTipAddress(asset: 'btc' | 'ltc', privateKey: Uint8Array): string {
  const publicKey = getPublicKey(privateKey, true); // compressed
  return asset === 'btc' ? btcAddress(publicKey) : ltcAddress(publicKey);
}

/**
 * Convert 32 bytes to a valid ed25519 scalar (reduce mod l).
 */
export function bytesToScalar(bytes: Uint8Array): bigint {
  let scalar = 0n;
  for (let i = 0; i < 32; i++) {
    scalar += BigInt(bytes[i]) << BigInt(8 * i);
  }
  // Reduce mod l (ed25519 curve order)
  const l = 2n ** 252n + 27742317777372353535851937790883648493n;
  return scalar % l;
}

/**
 * Convert a BigInt scalar to 32 bytes (little-endian).
 */
export function scalarToBytes(scalar: bigint): Uint8Array {
  const bytes = new Uint8Array(32);
  let remaining = scalar;
  for (let i = 0; i < 32; i++) {
    bytes[i] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }
  return bytes;
}

/**
 * Generate XMR/WOW tip wallet keys from a random seed.
 * Returns spend key, view key, and address.
 */
export function generateXmrWowTipKeys(asset: 'xmr' | 'wow'): XmrWowTipKeys {
  // Generate random bytes for spend key
  const spendKeySeed = randomBytes(32);
  const spendKeyScalar = bytesToScalar(spendKeySeed);
  const spendKey = scalarToBytes(spendKeyScalar);

  // Derive view key from spend key (Monero standard: Hs(private_spend_key))
  const viewKeySeed = sha256(spendKey);
  const viewKeyScalar = bytesToScalar(viewKeySeed);
  const viewKey = scalarToBytes(viewKeyScalar);

  // Derive public keys
  const publicSpendKey = ed25519.ExtendedPoint.BASE.multiply(spendKeyScalar).toRawBytes();
  const publicViewKey = ed25519.ExtendedPoint.BASE.multiply(viewKeyScalar).toRawBytes();

  // Generate address
  const address = asset === 'xmr'
    ? xmrAddress(publicSpendKey, publicViewKey)
    : wowAddress(publicSpendKey, publicViewKey);

  return { spendKey, viewKey, publicSpendKey, publicViewKey, address };
}

/**
 * Derive view key from spend key (Monero standard).
 */
export function deriveViewKeyFromSpendKey(spendKey: Uint8Array): Uint8Array {
  const viewKeySeed = sha256(spendKey);
  const viewKeyScalar = bytesToScalar(viewKeySeed);
  return scalarToBytes(viewKeyScalar);
}

/**
 * Helper to retry an async operation with exponential backoff.
 * @param fn - Async function to retry
 * @param maxRetries - Maximum number of retries (default: 3)
 * @param baseDelayMs - Base delay in milliseconds (default: 500)
 * @returns Result of the function or throws on all retries failed
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  baseDelayMs: number = 500
): Promise<T> {
  let lastError: Error | undefined;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < maxRetries - 1) {
        const delay = baseDelayMs * Math.pow(2, attempt);
        console.log(`[Retry] Attempt ${attempt + 1} failed, retrying in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  throw lastError;
}
