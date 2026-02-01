/**
 * Unit tests for address.ts
 *
 * Tests cover:
 * - Bitcoin P2WPKH address generation
 * - Litecoin P2WPKH address generation
 * - Monero standard address generation
 * - Wownero standard address generation
 * - Grin slatepack address generation
 * - Address validation functions
 */

import { describe, it, expect } from 'vitest';
import {
  btcAddress,
  ltcAddress,
  xmrAddress,
  wowAddress,
  grinSlatpackAddress,
  isValidBtcAddress,
  isValidLtcAddress,
  hexToBytes,
} from './address';

// Test vectors - known public keys and their expected addresses
const TEST_VECTORS = {
  // Compressed public key for private key = 1
  publicKey1: hexToBytes('0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798'),

  // Another test public key (private key = 2)
  publicKey2: hexToBytes('02c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5'),

  // 32-byte keys for XMR/WOW/Grin (ed25519 format)
  spendKey32: hexToBytes('0000000000000000000000000000000000000000000000000000000000000001'),
  viewKey32: hexToBytes('0000000000000000000000000000000000000000000000000000000000000002'),
  grinKey32: hexToBytes('0000000000000000000000000000000000000000000000000000000000000001'),
};

describe('Bitcoin Address Generation', () => {
  it('btcAddress generates valid bech32 address', () => {
    const address = btcAddress(TEST_VECTORS.publicKey1);

    expect(address).toMatch(/^bc1q[a-z0-9]+$/);
    expect(address.length).toBe(42); // P2WPKH addresses are 42 chars
  });

  it('btcAddress generates correct address for known public key', () => {
    // Known address for public key 1
    const address = btcAddress(TEST_VECTORS.publicKey1);

    // This is the correct P2WPKH address for this public key
    expect(address).toBe('bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4');
  });

  it('btcAddress is deterministic', () => {
    const addr1 = btcAddress(TEST_VECTORS.publicKey1);
    const addr2 = btcAddress(TEST_VECTORS.publicKey1);

    expect(addr1).toBe(addr2);
  });

  it('different public keys produce different addresses', () => {
    const addr1 = btcAddress(TEST_VECTORS.publicKey1);
    const addr2 = btcAddress(TEST_VECTORS.publicKey2);

    expect(addr1).not.toBe(addr2);
  });

  it('btcAddress uses lowercase', () => {
    const address = btcAddress(TEST_VECTORS.publicKey1);
    expect(address).toBe(address.toLowerCase());
  });
});

describe('Litecoin Address Generation', () => {
  it('ltcAddress generates valid bech32 address', () => {
    const address = ltcAddress(TEST_VECTORS.publicKey1);

    expect(address).toMatch(/^ltc1q[a-z0-9]+$/);
    expect(address.length).toBe(43); // LTC bech32 addresses are 43 chars
  });

  it('ltcAddress is deterministic', () => {
    const addr1 = ltcAddress(TEST_VECTORS.publicKey1);
    const addr2 = ltcAddress(TEST_VECTORS.publicKey1);

    expect(addr1).toBe(addr2);
  });

  it('same public key produces different BTC and LTC addresses', () => {
    const btc = btcAddress(TEST_VECTORS.publicKey1);
    const ltc = ltcAddress(TEST_VECTORS.publicKey1);

    expect(btc).not.toBe(ltc);
    expect(btc.startsWith('bc1')).toBe(true);
    expect(ltc.startsWith('ltc1')).toBe(true);
  });
});

describe('Monero Address Generation', () => {
  it('xmrAddress generates address starting with 4', () => {
    const address = xmrAddress(TEST_VECTORS.spendKey32, TEST_VECTORS.viewKey32);

    expect(address).toMatch(/^4[0-9A-Za-z]+$/);
  });

  it('xmrAddress generates 95-character address', () => {
    const address = xmrAddress(TEST_VECTORS.spendKey32, TEST_VECTORS.viewKey32);

    expect(address.length).toBe(95);
  });

  it('xmrAddress is deterministic', () => {
    const addr1 = xmrAddress(TEST_VECTORS.spendKey32, TEST_VECTORS.viewKey32);
    const addr2 = xmrAddress(TEST_VECTORS.spendKey32, TEST_VECTORS.viewKey32);

    expect(addr1).toBe(addr2);
  });

  it('swapping spend and view keys produces different address', () => {
    const addr1 = xmrAddress(TEST_VECTORS.spendKey32, TEST_VECTORS.viewKey32);
    const addr2 = xmrAddress(TEST_VECTORS.viewKey32, TEST_VECTORS.spendKey32);

    expect(addr1).not.toBe(addr2);
  });

  it('xmrAddress uses correct Monero base58 alphabet', () => {
    const address = xmrAddress(TEST_VECTORS.spendKey32, TEST_VECTORS.viewKey32);

    // Monero base58 doesn't include 0, O, I, l
    expect(address).not.toMatch(/[0OIl]/);
    // Should only contain valid base58 chars
    expect(address).toMatch(/^[123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]+$/);
  });
});

describe('Wownero Address Generation', () => {
  it('wowAddress generates address starting with Wo', () => {
    const address = wowAddress(TEST_VECTORS.spendKey32, TEST_VECTORS.viewKey32);

    expect(address).toMatch(/^Wo[0-9A-Za-z]+$/);
  });

  it('wowAddress generates 97-character address', () => {
    const address = wowAddress(TEST_VECTORS.spendKey32, TEST_VECTORS.viewKey32);

    expect(address.length).toBe(97);
  });

  it('wowAddress is deterministic', () => {
    const addr1 = wowAddress(TEST_VECTORS.spendKey32, TEST_VECTORS.viewKey32);
    const addr2 = wowAddress(TEST_VECTORS.spendKey32, TEST_VECTORS.viewKey32);

    expect(addr1).toBe(addr2);
  });

  it('same keys produce different XMR and WOW addresses', () => {
    const xmr = xmrAddress(TEST_VECTORS.spendKey32, TEST_VECTORS.viewKey32);
    const wow = wowAddress(TEST_VECTORS.spendKey32, TEST_VECTORS.viewKey32);

    expect(xmr).not.toBe(wow);
    expect(xmr[0]).toBe('4');
    expect(wow.slice(0, 2)).toBe('Wo');
  });
});

describe('Grin Slatepack Address Generation', () => {
  it('grinSlatpackAddress generates grin1 prefix address', () => {
    const address = grinSlatpackAddress(TEST_VECTORS.grinKey32);

    expect(address).toMatch(/^grin1[a-z0-9]+$/);
  });

  it('grinSlatpackAddress is deterministic', () => {
    const addr1 = grinSlatpackAddress(TEST_VECTORS.grinKey32);
    const addr2 = grinSlatpackAddress(TEST_VECTORS.grinKey32);

    expect(addr1).toBe(addr2);
  });

  it('grinSlatpackAddress requires 32-byte key', () => {
    const shortKey = hexToBytes('0102030405060708');

    expect(() => grinSlatpackAddress(shortKey)).toThrow('32-byte');
  });

  it('grinSlatpackAddress uses lowercase', () => {
    const address = grinSlatpackAddress(TEST_VECTORS.grinKey32);
    expect(address).toBe(address.toLowerCase());
  });

  it('different keys produce different addresses', () => {
    const key1 = hexToBytes('0000000000000000000000000000000000000000000000000000000000000001');
    const key2 = hexToBytes('0000000000000000000000000000000000000000000000000000000000000002');

    const addr1 = grinSlatpackAddress(key1);
    const addr2 = grinSlatpackAddress(key2);

    expect(addr1).not.toBe(addr2);
  });
});

describe('Bitcoin Address Validation', () => {
  it('validates correct bech32 mainnet address', () => {
    expect(isValidBtcAddress('bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4')).toBe(true);
  });

  it('validates P2WSH bech32 address', () => {
    // P2WSH addresses are longer (62 chars)
    expect(isValidBtcAddress('bc1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3qccfmv3')).toBe(true);
  });

  it('rejects testnet addresses', () => {
    expect(isValidBtcAddress('tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx')).toBe(false);
  });

  it('rejects invalid bech32 checksum', () => {
    // Last character changed
    expect(isValidBtcAddress('bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t5')).toBe(false);
  });

  it('rejects empty string', () => {
    expect(isValidBtcAddress('')).toBe(false);
  });

  it('rejects random string', () => {
    expect(isValidBtcAddress('not-an-address')).toBe(false);
  });

  it('rejects address without separator', () => {
    expect(isValidBtcAddress('bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4'.replace('1', ''))).toBe(false);
  });

  it('rejects legacy P2PKH addresses (for bech32 validation)', () => {
    // Legacy address starting with 1
    expect(isValidBtcAddress('1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2')).toBe(false);
  });

  it('rejects P2SH addresses (for bech32 validation)', () => {
    // P2SH address starting with 3
    expect(isValidBtcAddress('3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy')).toBe(false);
  });
});

describe('Litecoin Address Validation', () => {
  it('validates correct bech32 mainnet address', () => {
    // Generate a valid address and validate it
    const validAddr = ltcAddress(TEST_VECTORS.publicKey1);
    expect(isValidLtcAddress(validAddr)).toBe(true);
  });

  it('rejects Bitcoin addresses', () => {
    expect(isValidLtcAddress('bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4')).toBe(false);
  });

  it('rejects empty string', () => {
    expect(isValidLtcAddress('')).toBe(false);
  });

  it('rejects random string', () => {
    expect(isValidLtcAddress('not-an-address')).toBe(false);
  });

  it('rejects legacy L-addresses (for bech32 validation)', () => {
    expect(isValidLtcAddress('LhyLNfBkoKshT7R8Pce6vkB9T2cP2o84hx')).toBe(false);
  });

  it('rejects M-addresses (P2SH)', () => {
    expect(isValidLtcAddress('MQaYVLLd8rJbHBFukhxkBsJsT1FgqL7f9N')).toBe(false);
  });
});

describe('hexToBytes Utility', () => {
  it('converts valid hex string', () => {
    expect(hexToBytes('deadbeef')).toEqual(new Uint8Array([0xde, 0xad, 0xbe, 0xef]));
  });

  it('handles empty string', () => {
    expect(hexToBytes('')).toEqual(new Uint8Array([]));
  });

  it('throws on odd-length hex string', () => {
    expect(() => hexToBytes('abc')).toThrow('Invalid hex string');
  });

  it('handles uppercase hex', () => {
    expect(hexToBytes('DEADBEEF')).toEqual(new Uint8Array([0xde, 0xad, 0xbe, 0xef]));
  });

  it('handles mixed case', () => {
    expect(hexToBytes('DeAdBeEf')).toEqual(new Uint8Array([0xde, 0xad, 0xbe, 0xef]));
  });

  it('handles leading zeros', () => {
    expect(hexToBytes('00000001')).toEqual(new Uint8Array([0x00, 0x00, 0x00, 0x01]));
  });
});

describe('Address Generation Consistency', () => {
  it('generates consistent addresses from random keys', () => {
    // Generate addresses multiple times with same input
    const iterations = 10;
    const btcAddresses: string[] = [];
    const ltcAddresses: string[] = [];

    for (let i = 0; i < iterations; i++) {
      btcAddresses.push(btcAddress(TEST_VECTORS.publicKey1));
      ltcAddresses.push(ltcAddress(TEST_VECTORS.publicKey1));
    }

    // All should be identical
    expect(new Set(btcAddresses).size).toBe(1);
    expect(new Set(ltcAddresses).size).toBe(1);
  });

  it('BTC and LTC addresses have correct HRP', () => {
    const btc = btcAddress(TEST_VECTORS.publicKey1);
    const ltc = ltcAddress(TEST_VECTORS.publicKey1);

    expect(btc.slice(0, 3)).toBe('bc1');
    expect(ltc.slice(0, 4)).toBe('ltc1');
  });

  it('all address types are distinct', () => {
    const btc = btcAddress(TEST_VECTORS.publicKey1);
    const ltc = ltcAddress(TEST_VECTORS.publicKey1);
    const xmr = xmrAddress(TEST_VECTORS.spendKey32, TEST_VECTORS.viewKey32);
    const wow = wowAddress(TEST_VECTORS.spendKey32, TEST_VECTORS.viewKey32);
    const grin = grinSlatpackAddress(TEST_VECTORS.grinKey32);

    const addresses = [btc, ltc, xmr, wow, grin];
    const unique = new Set(addresses);

    expect(unique.size).toBe(5);
  });
});
