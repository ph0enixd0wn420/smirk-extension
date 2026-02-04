# Contributing to Smirk Wallet Extension

## Critical: Service Worker Restrictions

Chrome MV3 extensions run background scripts as **service workers**, which have no DOM access. This causes issues with WASM modules that use DOM APIs internally.

### The Rule

**Never static-import WASM modules in background scripts.**

```typescript
// BAD - crashes Chrome service worker at startup
import { initGrinWallet } from '@/lib/grin';
import { sendTransaction } from '@/lib/xmr-tx';

// GOOD - type imports are fine (stripped at compile time)
import type { GrinKeys } from '@/lib/grin';

// GOOD - dynamic import loads on-demand
const { initGrinWallet } = await import('@/lib/grin');
```

### Why This Matters

1. WASM modules (`@/lib/grin`, `@/lib/xmr-tx`) use `document.createElement` during initialization
2. Chrome service workers don't have `document` - it's `undefined`
3. Static imports load at service worker startup = immediate crash
4. Firefox uses `background.scripts` (not service worker) so it still works, hiding the bug

### Affected Files

Any file in `src/background/` that gets bundled into `background.js`:
- `src/background/index.ts`
- `src/background/social/*.ts`
- `src/background/grin-handlers.ts`
- `src/background/state.ts`
- `src/background/wallet.ts`
- etc.

### How to Check

Run this before committing changes to background scripts:

```bash
# Should only show "import type" statements, not function imports
grep -r "from '@/lib/grin'" src/background/ | grep -v "import type"
grep -r "from '@/lib/xmr-tx'" src/background/ | grep -v "import type"
```

If either command shows results, you have a static import that needs to be converted to dynamic.

### Pattern for Dynamic Imports

```typescript
// At module level - helper function
async function getGrinModule() {
  return import('@/lib/grin');
}

// In async functions - use the helper
async function handleGrinOperation() {
  const { initGrinWallet, signSlate } = await getGrinModule();
  // ... use the functions
}
```

---

## Testing

Always test Chrome builds after modifying background script imports:

```bash
npm run build:chrome
# Load dist/ as unpacked extension in chrome://extensions
# Check for "Service worker registration failed" errors
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
└── sweep.ts      # Unified sweep logic (WASM: xmr-tx)
```

Files with WASM dependencies are clearly marked. All WASM imports are dynamic.

### WASM Operations

All WASM-dependent code should use dynamic imports. The popup can use static imports since it runs in a normal extension page context with DOM access.

Files with dynamic WASM imports:
- `social/create.ts` - `@/lib/xmr-tx`, `@/lib/grin`
- `social/claim.ts` - `@/lib/grin`
- `social/clawback.ts` - `@/lib/grin`
- `social/sweep.ts` - `@/lib/xmr-tx`
- `grin-handlers.ts` - `@/lib/grin`
- `state.ts` - `@/lib/grin` (session restore only)
