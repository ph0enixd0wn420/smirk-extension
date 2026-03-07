# Smirk Wallet Browser Extension

Non-custodial multi-currency wallet for Telegram, Discord, and the web.

## Download

- [GitHub Releases](https://github.com/Such-Software/smirk-extension/releases) - Manual install
- Chrome Web Store - Coming soon

See [docs/INSTALLATION.md](docs/INSTALLATION.md) for installation instructions.

## Features

- **Non-custodial**: Your keys never leave your device
- **Multi-currency**: BTC, LTC, XMR, WOW, GRIN
- **Social media tipping**: Tip users by Telegram or Discord username
- **Encrypted tips**: Tips targeted at specific users are encrypted with their public key
- **Website integration**: `window.smirk` API for web apps (like MetaMask's `window.ethereum`)

## Architecture

```
src/
├── background/     # Service worker (modular)
│   ├── index.ts        # Message routing
│   ├── state.ts        # Global state, session persistence
│   ├── wallet/         # Wallet lifecycle (modular)
│   │   ├── create.ts       # Mnemonic generation, wallet creation
│   │   ├── restore.ts      # Wallet restoration
│   │   ├── session.ts      # Unlock/lock, auth
│   │   └── security.ts     # Seed reveal, password change
│   ├── grin/           # Grin WASM operations (modular)
│   │   ├── send.ts         # Send flow (create, finalize)
│   │   ├── receive.ts      # Sign incoming slatepacks
│   │   └── invoice.ts      # RSR invoice flow
│   ├── social/         # Social tipping (modular)
│   │   ├── create.ts       # Tip creation
│   │   ├── claim.ts        # Tip claiming
│   │   └── sweep.ts        # Unified sweep logic
│   ├── balance.ts      # Balance queries for all assets
│   ├── send.ts         # BTC/LTC transaction building
│   └── tips.ts         # Tip decryption and claiming
├── content/        # Content script - injects window.smirk
├── inject/         # Injected script - window.smirk API implementation
├── popup/          # Main UI (Preact components)
├── lib/
│   ├── crypto.ts        # BIP39, BIP44 key derivation
│   ├── xmr-tx.ts        # XMR/WOW transaction signing via WASM
│   ├── btc-tx.ts        # BTC/LTC transaction signing
│   ├── grin/            # Grin wallet (client-side WASM)
│   └── api/             # Backend API client (modular)
│       ├── client.ts        # Base HTTP client, retry, timeout
│       ├── parse.ts         # Response validation, snake→camel
│       ├── auth.ts          # Authentication methods
│       ├── social.ts        # Social tipping methods
│       ├── grin.ts          # Grin wallet methods
│       ├── wallet-lws.ts    # XMR/WOW light wallet methods
│       └── index.ts         # Combined API client
└── types/          # TypeScript types
```

## Security Model

1. **Password-protected keys**: All private keys are encrypted with your password
2. **Keys never leave extension**: Crypto operations happen in the background script
3. **ECDH for encrypted tips**: Sender uses recipient's public key for encryption
4. **URL fragment for public tips**: Key in `#fragment` never sent to server

## Supported Chains

| Chain | Key Type | Notes |
|-------|----------|-------|
| BTC | secp256k1 (BIP44) | Balance via Electrum |
| LTC | secp256k1 (BIP44) | Balance via Electrum |
| XMR | ed25519 | View key registered with LWS |
| WOW | ed25519 | Same as XMR |
| GRIN | secp256k1 | Interactive transactions via slatepack |

## WASM Dependencies

Cryptographic operations run client-side via WebAssembly. All keys stay in your browser.

### GRIN Libraries
From [Nicolas Flamel's MWC Wallet](https://github.com/NicolasFlamel1/MWC-Wallet-Standalone):

| Library | Source | Purpose |
|---------|--------|---------|
| secp256k1-zkp | [GitHub](https://github.com/NicolasFlamel1/Secp256k1-zkp-NPM-Package) | Elliptic curve + zero-knowledge proofs |
| Ed25519 | [GitHub](https://github.com/NicolasFlamel1/Ed25519-NPM-Package) | Digital signatures |
| X25519 | [GitHub](https://github.com/NicolasFlamel1/X25519-NPM-Package) | Key exchange |
| BLAKE2b | [GitHub](https://github.com/NicolasFlamel1/BLAKE2b-NPM-Package) | Cryptographic hashing |

### Monero/Wownero
Custom WASM built from Rust:

| Library | Source | Purpose |
|---------|--------|---------|
| smirk-wasm-monero | [GitHub](https://github.com/Such-Software/smirk-wasm-monero) | Transaction signing, key images |
| monero-oxide | [GitHub](https://github.com/Such-Software/monero-oxide) | Monero protocol implementation |

All source code is open. See [docs/BUILDING.md](docs/BUILDING.md) for compilation instructions.

## Website Integration (window.smirk API)

The extension injects a `window.smirk` API into web pages:

```typescript
if (window.smirk) {
  // Request connection (shows approval popup)
  const publicKeys = await window.smirk.connect();
  // Returns: { btc, ltc, xmr, wow, grin }

  // Request message signature
  const result = await window.smirk.signMessage('Sign to authenticate');
  // Returns: { message, signatures: [{ asset, signature, publicKey }] }

  // Disconnect
  await window.smirk.disconnect();
}
```

## Development

See [docs/BUILDING.md](docs/BUILDING.md) for build instructions and store submission guides.

## Community

- [Telegram](https://t.me/smirkwallet)
- [Discord](https://discord.gg/7EnsaWTm6C)
- [GitHub Issues](https://github.com/Such-Software/smirk-extension/issues)

## License

MIT
