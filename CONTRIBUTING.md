# Contributing to Smirk Wallet Extension

## Critical: Service Worker Import Rules

Chrome MV3 extensions run background scripts as **service workers**. Chrome blocks `import()` (dynamic imports) on `ServiceWorkerGlobalScope` per the HTML spec. Vite splits dynamically-imported modules into separate chunks, and `import()` to load those chunks will crash.

### The Rule

**Always use static imports in background scripts. Never use dynamic `import()`.**

```typescript
// GOOD - static import (bundled at build time, no runtime import())
import * as grinModule from '@/lib/grin';
import { sendTransaction } from '@/lib/xmr-tx';

// GOOD - type imports are fine (stripped at compile time)
import type { GrinKeys } from '@/lib/grin';

// BAD - dynamic import crashes in Chrome MV3 service workers
const { initGrinWallet } = await import('@/lib/grin');
```

### Why This Matters

1. Chrome blocks `import()` on `ServiceWorkerGlobalScope` per the HTML spec
2. Vite creates separate chunks for dynamically-imported modules
3. `import()` to load those chunks fails in the service worker
4. The WASM modules (`@/lib/grin`, `@/lib/xmr-tx`) are service-worker-compatible (they use `fetch()` + `WebAssembly.compile()` + `initSync()`, NOT DOM APIs), so static imports work fine

### How to Check

After building, verify no `import()` calls exist in the background bundle:

```bash
npm run build:chrome
grep -oP 'import\([^)]+\)' dist/background.js
# Should output NOTHING
```

---

## Testing

Always test Chrome builds after modifying background script imports:

```bash
npm run build:chrome
# Load dist/ as unpacked extension in chrome://extensions
# Check for "Service worker registration failed" or "import() is disallowed" errors
```

---

## Code Organization

### Background Script Structure

Social tipping is split into focused modules in `src/background/social/`:

```
social/
├── index.ts      # Re-exports all handlers
├── types.ts      # Shared interfaces
├── crypto.ts     # Key derivation helpers (no WASM)
├── lookup.ts     # User lookup handlers
├── retrieve.ts   # Tip listing handlers
├── create.ts     # Tip creation (WASM: grin, xmr-tx)
├── claim.ts      # Tip claiming (WASM: grin)
├── clawback.ts   # Tip recovery (WASM: grin)
└── sweep.ts      # Unified sweep logic (WASM: xmr-tx, grin)
```

### Wallet Module Structure

```
wallet/
├── index.ts          # Re-exports all handlers
├── types.ts          # Shared interfaces (DerivedKeys, RestoreHeights)
├── state.ts          # Wallet state queries, onboarding state
├── addresses.ts      # Address derivation for all assets
├── registration.ts   # Backend/LWS registration (internal)
├── create.ts         # Mnemonic generation, wallet creation
├── restore.ts        # Wallet restoration from seed
├── session.ts        # Unlock/lock, auth management
└── security.ts       # Seed reveal, password change
```

### Grin Module Structure

```
grin/
├── index.ts          # Re-exports all handlers
├── helpers.ts        # WASM module access, key init, auth helpers
├── backend.ts        # API wrappers (record, lock, spend, broadcast)
├── init.ts           # Wallet initialization
├── relay.ts          # Pending slatepacks polling
├── receive.ts        # Sign incoming slatepacks (WASM: grin)
├── send.ts           # Send flow - create, finalize (WASM: grin)
├── invoice.ts        # RSR invoice flow (WASM: grin)
└── cancel.ts         # Cancel operations
```

### API Client Structure

The backend API client lives in `src/lib/api/`:

```
api/
├── client.ts         # Base HTTP client, retry, timeout
├── parse.ts          # Response validation helpers, snake→camel
├── auth.ts           # Authentication (register, refresh, check-restore)
├── social.ts         # Social tipping (lookup, create, claim, clawback)
├── grin.ts           # Grin wallet (relay, outputs, transactions)
├── wallet-lws.ts     # XMR/WOW light wallet
├── wallet-utxo.ts    # BTC/LTC UTXO operations
├── keys.ts           # Public key registration
├── tips.ts           # Link-based tips
└── index.ts          # SmirkApi - combines all methods
```

#### Request Patterns

- **`request<T>()`** - Single attempt. Use for non-idempotent mutations (tip creation, claims, clawback).
- **`retryableRequest<T>()`** - Up to 3 attempts with exponential backoff (500ms, 1s, 2s). Only retries on 5xx and network errors, never on 4xx. Use for GETs and idempotent POSTs.
- All requests have a 30s timeout via AbortController.

```typescript
// Safe to retry (GET, idempotent)
return client.retryableRequest<Data>('/tips/social/sent', { method: 'GET' });

// NOT safe to retry (creates state)
return client.request<Data>('/tips/social', { method: 'POST', body: ... });
```

#### Response Parsing

`ApiResponse<T>` includes `status` (HTTP code) and `code` (machine-readable error code from backend):

```typescript
const result = await api.claimSocialTip(tipId);
if (result.error) {
  if (result.code === 'NOT_FOUND') { /* tip doesn't exist */ }
  if (result.status === 401) { /* token expired, re-auth */ }
}
```

Use `parse.ts` helpers for safe field extraction from unknown API responses:

```typescript
import { str, num, boolOr, snakeToCamel } from './parse';

// Safe - returns undefined if missing or wrong type
const name = str(response, 'username');
const amount = num(response, 'amount');

// With fallback - never returns undefined
const isPublic = boolOr(response, 'is_public', false);

// Transform entire response from snake_case to camelCase
const data = snakeToCamel<MyType>(response);
```
