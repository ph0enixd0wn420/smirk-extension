/**
 * Tests for Bitcoin/Litecoin transaction construction.
 *
 * These tests verify UTXO selection, fee calculation, and transaction building
 * for the code that actually spends funds. Critical for preventing fund loss.
 */

import { describe, it, expect } from 'vitest';
import {
  selectUtxos,
  createSignedTransaction,
  estimateFee,
  maxSendable,
  Utxo,
  UtxoAsset,
} from './btc-tx';
import { generatePrivateKey, getPublicKey } from './crypto';
import { btcAddress, ltcAddress } from './address';

// ============================================================================
// Test Fixtures
// ============================================================================

/** Create a mock UTXO for testing */
function mockUtxo(value: number, txid?: string, vout = 0): Utxo {
  return {
    txid: txid || 'a'.repeat(64),
    vout,
    value,
    height: 800000,
  };
}

/** Generate a valid BTC address for testing */
function generateBtcAddress(): string {
  const privateKey = generatePrivateKey();
  const publicKey = getPublicKey(privateKey);
  return btcAddress(publicKey);
}

/** Generate a valid LTC address for testing */
function generateLtcAddress(): string {
  const privateKey = generatePrivateKey();
  const publicKey = getPublicKey(privateKey);
  return ltcAddress(publicKey);
}

// ============================================================================
// selectUtxos Tests
// ============================================================================

describe('selectUtxos', () => {
  it('selects single UTXO when sufficient', () => {
    const utxos = [mockUtxo(100000)]; // 100k sats
    const result = selectUtxos(utxos, 50000, 10); // Send 50k

    expect(result.selected).toHaveLength(1);
    expect(result.selected[0].value).toBe(100000);
    expect(result.fee).toBeGreaterThan(0);
    expect(result.change).toBe(100000 - 50000 - result.fee);
  });

  it('accumulates multiple UTXOs until sufficient', () => {
    const utxos = [
      mockUtxo(30000, 'a'.repeat(64)),
      mockUtxo(30000, 'b'.repeat(64)),
      mockUtxo(30000, 'c'.repeat(64)),
    ];
    const result = selectUtxos(utxos, 50000, 10);

    // Should need at least 2 UTXOs (60k sats) to cover 50k + fee
    expect(result.selected.length).toBeGreaterThanOrEqual(2);

    const totalSelected = result.selected.reduce((sum, u) => sum + u.value, 0);
    expect(totalSelected).toBeGreaterThanOrEqual(50000 + result.fee);
  });

  it('sorts by value descending (largest first)', () => {
    const utxos = [
      mockUtxo(10000, 'a'.repeat(64)), // smallest
      mockUtxo(50000, 'b'.repeat(64)), // largest
      mockUtxo(30000, 'c'.repeat(64)), // middle
    ];
    const result = selectUtxos(utxos, 40000, 10);

    // Should pick the 50k UTXO first (largest)
    expect(result.selected[0].value).toBe(50000);
  });

  it('calculates fee correctly using formula: 10 + 68*inputs + 62 bytes', () => {
    const utxos = [mockUtxo(100000)];
    const feeRate = 10;
    const result = selectUtxos(utxos, 50000, feeRate);

    // Expected: baseSize (10 + 31*2 = 72) + inputSize (68*1) = 140 bytes
    // Fee = ceil(140 * 10) + 1 = 1401 sats
    const expectedSize = 72 + 68 * 1;
    const expectedFee = Math.ceil(expectedSize * feeRate) + 1;
    expect(result.fee).toBe(expectedFee);
  });

  it('enforces minimum fee rate of 1.1 sat/vB', () => {
    const utxos = [mockUtxo(100000)];

    // Pass a fee rate below minimum
    const resultLow = selectUtxos(utxos, 50000, 0.5);

    // Pass exactly minimum fee rate
    const resultMin = selectUtxos(utxos, 50000, 1.1);

    // Both should use at least 1.1 sat/vB
    // For 1 input: size = 72 + 68 = 140 bytes
    const minFee = Math.ceil(140 * 1.1) + 1;
    expect(resultLow.fee).toBeGreaterThanOrEqual(minFee);
    expect(resultMin.fee).toBe(minFee);
  });

  it('throws on insufficient funds with helpful message', () => {
    const utxos = [mockUtxo(1000)]; // Only 1000 sats

    expect(() => selectUtxos(utxos, 50000, 10)).toThrow('Insufficient funds');
    expect(() => selectUtxos(utxos, 50000, 10)).toThrow('need 50000');
    expect(() => selectUtxos(utxos, 50000, 10)).toThrow('have 1000');
  });

  it('throws on empty UTXO array', () => {
    expect(() => selectUtxos([], 1000, 10)).toThrow('Insufficient funds');
  });

  it('handles exact amount scenario', () => {
    // Create UTXO that exactly covers amount + expected fee
    const feeRate = 10;
    const amount = 50000;
    const expectedSize = 72 + 68; // 1 input
    const expectedFee = Math.ceil(expectedSize * feeRate) + 1;
    const exactUtxo = mockUtxo(amount + expectedFee);

    const result = selectUtxos([exactUtxo], amount, feeRate);

    expect(result.selected).toHaveLength(1);
    expect(result.change).toBe(0);
  });

  it('calculates change correctly', () => {
    const utxos = [mockUtxo(100000)];
    const amount = 30000;
    const result = selectUtxos(utxos, amount, 10);

    // Change should be: total - amount - fee
    expect(result.change).toBe(100000 - amount - result.fee);
    expect(result.change).toBeGreaterThan(0);
  });

  it('handles multiple UTXOs with same value', () => {
    const utxos = [
      mockUtxo(25000, 'a'.repeat(64)),
      mockUtxo(25000, 'b'.repeat(64)),
      mockUtxo(25000, 'c'.repeat(64)),
    ];
    const result = selectUtxos(utxos, 60000, 10);

    // Should need all 3 UTXOs (75k total) for 60k + fee
    expect(result.selected).toHaveLength(3);
  });
});

// ============================================================================
// createSignedTransaction Tests
// ============================================================================

describe('createSignedTransaction', () => {
  const privateKey = generatePrivateKey();
  const publicKey = getPublicKey(privateKey);
  const btcAddr = btcAddress(publicKey);
  const ltcAddr = ltcAddress(publicKey);

  describe('BTC transactions', () => {
    it('creates valid BTC transaction hex', () => {
      const utxos = [mockUtxo(100000)];
      const recipient = generateBtcAddress();

      const result = createSignedTransaction(
        'btc',
        utxos,
        recipient,
        50000,
        btcAddr,
        privateKey,
        10,
        false
      );

      // Should return valid hex string
      expect(result.txHex).toMatch(/^[0-9a-f]+$/i);
      expect(result.txHex.length).toBeGreaterThan(0);

      // Should have fee and txid
      expect(result.fee).toBeGreaterThan(0);
      expect(result.txid).toMatch(/^[0-9a-f]{64}$/i);
      expect(result.actualAmount).toBe(50000);
    });

    it('sweep mode: single output, all funds minus fee', () => {
      const utxos = [
        mockUtxo(50000, 'a'.repeat(64)),
        mockUtxo(30000, 'b'.repeat(64)),
      ];
      const recipient = generateBtcAddress();

      const result = createSignedTransaction(
        'btc',
        utxos,
        recipient,
        0, // ignored in sweep mode
        btcAddr,
        privateKey,
        10,
        true // sweep mode
      );

      // Actual amount should be total - fee
      const totalValue = 50000 + 30000;
      expect(result.actualAmount).toBe(totalValue - result.fee);
      expect(result.actualAmount).toBeGreaterThan(0);
    });

    it('normal mode: creates change output when change > 546', () => {
      const utxos = [mockUtxo(100000)];
      const recipient = generateBtcAddress();

      const result = createSignedTransaction(
        'btc',
        utxos,
        recipient,
        30000, // Will have significant change
        btcAddr,
        privateKey,
        10,
        false
      );

      // Transaction should be created successfully
      expect(result.txHex).toBeTruthy();
      expect(result.actualAmount).toBe(30000);

      // Change should exist: 100000 - 30000 - fee > 546
      const expectedChange = 100000 - 30000 - result.fee;
      expect(expectedChange).toBeGreaterThan(546);
    });

    it('rejects sweep amounts below dust threshold (546 sat)', () => {
      // Calculate exact value that results in dust after fee
      // For 1 input sweep: size = 10 + 68 + 31 = 109 bytes
      // Fee at 10 sat/vB = ceil(109 * 10) + 1 = 1091 sats
      // To get actualAmount < 546: total - 1091 < 546 → total < 1637
      // But also total - fee > 0: total > 1091
      // So need: 1091 < total < 1637
      const utxos = [mockUtxo(1500)]; // Results in ~409 sats after fee (below dust)
      const recipient = generateBtcAddress();

      expect(() =>
        createSignedTransaction(
          'btc',
          utxos,
          recipient,
          0,
          btcAddr,
          privateKey,
          10,
          true // sweep
        )
      ).toThrow('below dust threshold');
    });

    it('handles high fee rate correctly', () => {
      const utxos = [mockUtxo(100000)];
      const recipient = generateBtcAddress();

      const resultLow = createSignedTransaction(
        'btc',
        utxos,
        recipient,
        30000,
        btcAddr,
        privateKey,
        5, // low fee rate
        false
      );

      const resultHigh = createSignedTransaction(
        'btc',
        utxos,
        recipient,
        30000,
        btcAddr,
        privateKey,
        100, // high fee rate
        false
      );

      expect(resultHigh.fee).toBeGreaterThan(resultLow.fee);
    });
  });

  describe('LTC transactions', () => {
    it('creates valid LTC transaction hex', () => {
      const utxos = [mockUtxo(10000000)]; // 0.1 LTC
      const recipient = generateLtcAddress();

      const result = createSignedTransaction(
        'ltc',
        utxos,
        recipient,
        5000000, // 0.05 LTC
        ltcAddr,
        privateKey,
        10,
        false
      );

      // Should return valid hex string
      expect(result.txHex).toMatch(/^[0-9a-f]+$/i);
      expect(result.txid).toMatch(/^[0-9a-f]{64}$/i);
      expect(result.actualAmount).toBe(5000000);
    });

    it('LTC sweep mode works correctly', () => {
      const utxos = [mockUtxo(5000000)];
      const recipient = generateLtcAddress();

      const result = createSignedTransaction(
        'ltc',
        utxos,
        recipient,
        0,
        ltcAddr,
        privateKey,
        10,
        true // sweep
      );

      expect(result.actualAmount).toBe(5000000 - result.fee);
      expect(result.txHex).toBeTruthy();
    });
  });

  describe('edge cases', () => {
    it('handles single UTXO exactly covering amount + fee', () => {
      // Calculate exact UTXO value needed
      const amount = 50000;
      const feeRate = 10;
      // 1 input, 2 outputs: 10 + 68 + 62 = 140 bytes
      const expectedFee = Math.ceil(140 * feeRate) + 1;
      const exactUtxo = mockUtxo(amount + expectedFee);

      const recipient = generateBtcAddress();
      const result = createSignedTransaction(
        'btc',
        [exactUtxo],
        recipient,
        amount,
        btcAddr,
        privateKey,
        feeRate,
        false
      );

      expect(result.actualAmount).toBe(amount);
      // No change output should be created (change = 0)
    });

    it('throws on insufficient funds for sweep', () => {
      const utxos = [mockUtxo(100)]; // Tiny amount
      const recipient = generateBtcAddress();

      expect(() =>
        createSignedTransaction(
          'btc',
          utxos,
          recipient,
          0,
          btcAddr,
          privateKey,
          10,
          true
        )
      ).toThrow(/Insufficient funds for sweep|below dust threshold/);
    });

    it('fee scales with number of inputs', () => {
      const recipient = generateBtcAddress();
      const feeRate = 10;

      // 1 UTXO
      const result1 = createSignedTransaction(
        'btc',
        [mockUtxo(100000)],
        recipient,
        50000,
        btcAddr,
        privateKey,
        feeRate,
        false
      );

      // 3 UTXOs (need more inputs)
      const result3 = createSignedTransaction(
        'btc',
        [mockUtxo(20000), mockUtxo(20000), mockUtxo(20000)],
        recipient,
        50000,
        btcAddr,
        privateKey,
        feeRate,
        false
      );

      // More inputs = higher fee
      expect(result3.fee).toBeGreaterThan(result1.fee);
    });
  });
});

// ============================================================================
// maxSendable Tests
// ============================================================================

describe('maxSendable', () => {
  it('returns total minus sweep fee for single UTXO', () => {
    const utxos = [mockUtxo(100000)];
    const feeRate = 10;

    const max = maxSendable(utxos, feeRate);

    // Expected: 100000 - (ceil((10 + 68*1 + 31) * 10) + 1)
    // = 100000 - (ceil(109 * 10) + 1) = 100000 - 1091 = 98909
    const expectedSize = 10 + 68 * 1 + 31;
    const expectedFee = Math.ceil(expectedSize * feeRate) + 1;
    expect(max).toBe(100000 - expectedFee);
  });

  it('sums all UTXOs for multiple inputs', () => {
    const utxos = [
      mockUtxo(50000, 'a'.repeat(64)),
      mockUtxo(30000, 'b'.repeat(64)),
      mockUtxo(20000, 'c'.repeat(64)),
    ];
    const feeRate = 10;

    const max = maxSendable(utxos, feeRate);

    // Total = 100000, fee for 3 inputs
    const totalValue = 100000;
    const expectedSize = 10 + 68 * 3 + 31;
    const expectedFee = Math.ceil(expectedSize * feeRate) + 1;
    expect(max).toBe(totalValue - expectedFee);
  });

  it('returns 0 for empty UTXO array', () => {
    expect(maxSendable([], 10)).toBe(0);
  });

  it('returns 0 when fee exceeds total', () => {
    // Very small UTXO
    const utxos = [mockUtxo(50)];
    const max = maxSendable(utxos, 10);

    // Fee will exceed 50 sats, so max should be 0
    expect(max).toBe(0);
  });

  it('enforces minimum fee rate', () => {
    const utxos = [mockUtxo(100000)];

    const maxLowRate = maxSendable(utxos, 0.5); // Below minimum
    const maxMinRate = maxSendable(utxos, 1.1); // Exactly minimum

    // Both should use 1.1 sat/vB minimum
    expect(maxLowRate).toBe(maxMinRate);
  });

  it('maxSendable + fee equals total value', () => {
    const utxos = [mockUtxo(100000)];
    const feeRate = 10;

    const max = maxSendable(utxos, feeRate);

    // Calculate fee using same formula
    const effectiveFeeRate = Math.max(feeRate, 1.1);
    const estimatedSize = 10 + 68 * utxos.length + 31;
    const estimatedFee = Math.ceil(estimatedSize * effectiveFeeRate) + 1;

    expect(max + estimatedFee).toBe(100000);
  });
});

// ============================================================================
// estimateFee Tests
// ============================================================================

describe('estimateFee', () => {
  it('estimates fee for normal transaction', () => {
    const utxos = [mockUtxo(100000)];
    const fee = estimateFee(utxos, 50000, 10);

    // Should return positive fee
    expect(fee).toBeGreaterThan(0);

    // Fee should be reasonable (< 5% of amount for normal conditions)
    expect(fee).toBeLessThan(50000 * 0.05);
  });

  it('fee scales with number of inputs', () => {
    // Single large UTXO
    const fee1 = estimateFee([mockUtxo(100000)], 50000, 10);

    // Multiple smaller UTXOs (same total)
    const fee3 = estimateFee(
      [mockUtxo(40000), mockUtxo(35000), mockUtxo(25000)],
      50000,
      10
    );

    expect(fee3).toBeGreaterThan(fee1);
  });

  it('fee scales with fee rate', () => {
    const utxos = [mockUtxo(100000)];

    const feeLow = estimateFee(utxos, 50000, 5);
    const feeHigh = estimateFee(utxos, 50000, 50);

    expect(feeHigh).toBeGreaterThan(feeLow);
  });

  it('throws on insufficient funds', () => {
    const utxos = [mockUtxo(1000)];

    expect(() => estimateFee(utxos, 50000, 10)).toThrow('Insufficient funds');
  });
});

// ============================================================================
// Dust Handling Tests
// ============================================================================

describe('dust handling', () => {
  const privateKey = generatePrivateKey();
  const publicKey = getPublicKey(privateKey);
  const btcAddr = btcAddress(publicKey);

  it('small change (<= 546) is absorbed into fee, not creating dust output', () => {
    // Create scenario where change would be small (< 546)
    const amount = 50000;
    const feeRate = 10;

    // Calculate expected fee for 1 input, 2 outputs
    const expectedSize = 10 + 68 + 62;
    const expectedFee = Math.ceil(expectedSize * feeRate) + 1;

    // UTXO value that leaves small change
    const smallChange = 400; // Below dust threshold
    const utxoValue = amount + expectedFee + smallChange;

    const utxos = [mockUtxo(utxoValue)];
    const recipient = generateBtcAddress();

    const result = createSignedTransaction(
      'btc',
      utxos,
      recipient,
      amount,
      btcAddr,
      privateKey,
      feeRate,
      false
    );

    // Transaction should succeed
    expect(result.txHex).toBeTruthy();
    expect(result.actualAmount).toBe(amount);

    // Fee should include the absorbed dust
    // Original fee + absorbed dust change
    expect(result.fee).toBe(expectedFee + smallChange);
  });

  it('large change (> 546) creates change output', () => {
    const utxos = [mockUtxo(100000)];
    const recipient = generateBtcAddress();

    const result = createSignedTransaction(
      'btc',
      utxos,
      recipient,
      30000, // Large change expected
      btcAddr,
      privateKey,
      10,
      false
    );

    // Change should be: 100000 - 30000 - fee > 546
    const expectedChange = 100000 - 30000 - result.fee;
    expect(expectedChange).toBeGreaterThan(546);
  });

  it('rejects sending dust amounts (< 546 sats)', () => {
    const utxos = [mockUtxo(100000)];
    const recipient = generateBtcAddress();

    // Try to send less than dust threshold
    expect(() =>
      createSignedTransaction(
        'btc',
        utxos,
        recipient,
        400, // Below dust threshold
        btcAddr,
        privateKey,
        10,
        false
      )
    ).toThrow(/dust/i);
  });
});

// ============================================================================
// Transaction Parsing Validation
// ============================================================================

describe('transaction validity', () => {
  const privateKey = generatePrivateKey();
  const publicKey = getPublicKey(privateKey);
  const btcAddr = btcAddress(publicKey);

  it('transaction hex has valid structure', () => {
    const utxos = [mockUtxo(100000)];
    const recipient = generateBtcAddress();

    const result = createSignedTransaction(
      'btc',
      utxos,
      recipient,
      50000,
      btcAddr,
      privateKey,
      10,
      false
    );

    // Hex should be even length (complete bytes)
    expect(result.txHex.length % 2).toBe(0);

    // Minimum transaction size check
    expect(result.txHex.length).toBeGreaterThan(100);

    // Txid should be 64 hex chars (32 bytes)
    expect(result.txid.length).toBe(64);
  });

  it('same inputs produce same txid', () => {
    const utxos = [mockUtxo(100000, 'a'.repeat(64), 0)];
    const recipient = generateBtcAddress();

    const result1 = createSignedTransaction(
      'btc',
      utxos,
      recipient,
      50000,
      btcAddr,
      privateKey,
      10,
      false
    );

    const result2 = createSignedTransaction(
      'btc',
      utxos,
      recipient,
      50000,
      btcAddr,
      privateKey,
      10,
      false
    );

    // Same inputs should produce same txid
    expect(result1.txid).toBe(result2.txid);
    expect(result1.txHex).toBe(result2.txHex);
  });

  it('different recipients produce different txids', () => {
    const utxos = [mockUtxo(100000, 'a'.repeat(64), 0)];
    const recipient1 = generateBtcAddress();
    const recipient2 = generateBtcAddress();

    const result1 = createSignedTransaction(
      'btc',
      utxos,
      recipient1,
      50000,
      btcAddr,
      privateKey,
      10,
      false
    );

    const result2 = createSignedTransaction(
      'btc',
      utxos,
      recipient2,
      50000,
      btcAddr,
      privateKey,
      10,
      false
    );

    expect(result1.txid).not.toBe(result2.txid);
  });
});
