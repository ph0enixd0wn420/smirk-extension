/**
 * Wallet Module Types
 *
 * Shared interfaces used across wallet modules.
 */

/** Keys derived from mnemonic for a specific asset */
export interface DerivedKeys {
  btc: { privateKey: Uint8Array };
  ltc: { privateKey: Uint8Array };
  xmr: {
    privateSpendKey: Uint8Array;
    publicSpendKey: Uint8Array;
    privateViewKey: Uint8Array;
    publicViewKey: Uint8Array;
  };
  wow: {
    privateSpendKey: Uint8Array;
    publicSpendKey: Uint8Array;
    privateViewKey: Uint8Array;
    publicViewKey: Uint8Array;
  };
  grin: {
    privateKey: Uint8Array;
    publicKey: Uint8Array;
  };
}

/** Restore heights from backend (for wallet restore) */
export interface RestoreHeights {
  xmr?: number;
  wow?: number;
}
