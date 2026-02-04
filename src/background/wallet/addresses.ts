/**
 * Wallet Addresses Module
 *
 * Address derivation for all asset types.
 */

import type { MessageResponse, AssetType } from '@/types';
import {
  btcAddress,
  ltcAddress,
  xmrAddress,
  wowAddress,
  grinSlatpackAddress,
  hexToBytes,
} from '@/lib/address';
import { getWalletState } from '@/lib/storage';

/**
 * Derive address from wallet key for a specific asset.
 *
 * Different chains use different address formats:
 * - BTC: P2WPKH (bech32, bc1...)
 * - LTC: P2WPKH (bech32, ltc1...)
 * - XMR: Standard Monero address (4...)
 * - WOW: Standard Wownero address (Wo...)
 * - Grin: Slatepack address (bech32-encoded ed25519 pubkey)
 *
 * @param asset - Asset type
 * @param key - Key data with public keys
 * @returns Address string for the asset
 */
export function getAddressForAsset(
  asset: AssetType,
  key: { publicKey: string; publicSpendKey?: string; publicViewKey?: string }
): string {
  switch (asset) {
    case 'btc':
      return btcAddress(hexToBytes(key.publicKey));
    case 'ltc':
      return ltcAddress(hexToBytes(key.publicKey));
    case 'xmr':
      if (!key.publicSpendKey || !key.publicViewKey) {
        return 'Address unavailable';
      }
      return xmrAddress(hexToBytes(key.publicSpendKey), hexToBytes(key.publicViewKey));
    case 'wow':
      if (!key.publicSpendKey || !key.publicViewKey) {
        return 'Address unavailable';
      }
      return wowAddress(hexToBytes(key.publicSpendKey), hexToBytes(key.publicViewKey));
    case 'grin':
      // Grin slatepack address from ed25519 public key
      // Must be 64 hex chars (32 bytes)
      if (!key.publicKey || key.publicKey.length !== 64) {
        return 'Address unavailable';
      }
      return grinSlatpackAddress(hexToBytes(key.publicKey));
    default:
      return 'Unknown asset';
  }
}

/**
 * Get all wallet addresses.
 *
 * Returns addresses for all configured assets.
 *
 * @returns Array of address info objects
 */
export async function handleGetAddresses(): Promise<MessageResponse<{
  addresses: Array<{
    asset: AssetType;
    address: string;
    publicKey: string;
  }>;
}>> {
  const state = await getWalletState();
  const addresses: Array<{ asset: AssetType; address: string; publicKey: string }> = [];

  for (const asset of ['btc', 'ltc', 'xmr', 'wow', 'grin'] as AssetType[]) {
    const key = state.keys[asset];
    if (key) {
      const address = getAddressForAsset(asset, key);
      addresses.push({
        asset,
        address,
        publicKey: key.publicKey,
      });
    }
  }

  return { success: true, data: { addresses } };
}
