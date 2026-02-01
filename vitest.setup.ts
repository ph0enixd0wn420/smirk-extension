/**
 * Vitest setup file - polyfills for Node.js test environment
 */

import { webcrypto } from 'node:crypto';

// Polyfill Web Crypto API for Node.js environment
// This is needed for:
// - crypto.subtle (PBKDF2, etc.)
// - crypto.getRandomValues (BIP39 mnemonic generation)
if (typeof globalThis.crypto === 'undefined') {
  globalThis.crypto = webcrypto as Crypto;
}
