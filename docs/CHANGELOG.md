# Smirk Extension Changelog

## v0.1.8 (2026-03-04)

### Bug Fixes
- **Service worker imports**: Convert dynamic `import()` to static imports for Chrome MV3 compatibility
- **Social tip UX**: "Tip Sent!" → "Tip Created!" text, add "Ready to share" banner for confirmed public tips
- **BTC/LTC history amounts**: Show green/red +/- amounts for all assets (previously only XMR/WOW/Grin had amounts)
- **Concurrent XMR/WOW tips**: Better error message when outputs are temporarily locked by pending transactions
- **Claiming race condition**: Fixed in backend — atomic state transition prevents double-claims

### Improvements
- XMR/WOW pending balance tracking via `addPendingTx()` for immediate balance reflection
- Double-counting guard for LWS + local pending overlap
- Badge count for sent public tips ready to share

## v0.1.7 (2026-02-27)

### Bug Fixes
- **XMR/WOW payments**: Execute in popup context since service workers can't import WASM modules

## v0.1.6 (2026-02-22)

### Features
- **Payment flow**: Connected websites can prompt for payment via `window.smirk` API

### Bug Fixes
- Firefox `connect()` bug fixed
- API client robustness improvements

### Refactoring
- Split `social.ts` into multiple files
- Split `wallet.ts` and `grin-handlers.ts`
- Dynamic WASM imports for Chrome service worker

## v0.1.5 (2026-02-19)

### Bug Fixes
- Transaction history display and popout rendering
- Remove dead `funded` status check and unused `pendingSentTips` state
- Fix Grin balance double-counting pending sent tips
- Fix TypeScript errors, improve popup height

### Features
- Smirk name lookup (tip by username)

## v0.1.4 (2026-02-15)

### Bug Fixes
- Firefox receive bug
- Build script for packaging

## v0.1.3 (2026-02-12)

### Features
- **Smirk name tipping**: Tip users by Smirk username
- **Firefox MV3 support**: Full Firefox build with comprehensive build docs

### Bug Fixes
- Tip claim notifications
- Discord tipping compatibility
- Anonymous toggle on tips

## v0.1.2 (2026-02-08)

### Features
- **Discord integration**: Tip Discord users from the extension
- **Sparkline charts**: Price history under current price
- **UI revamp**: New design with price display

### Bug Fixes
- Max send fee estimation for BTC/LTC/XMR/WOW
- Price fetch and display
- Use `backend.smirk.cash` for production API

## v0.1.1 (2026-02-01)

### Features
- **Public tips**: Create shareable tip links anyone can claim
- **Sender anonymity**: Option to hide identity on tips
- **Badges**: Pending tip notifications

### Bug Fixes
- Security hardening for restore/registration
- Retry registration on network failure
- Unconfirmed XMR/WOW tip display
- Grin tipping and voucher creation
- Auto-detect sweep mode for max send
- Social tip receiving and claiming

## v0.1.0 (2026-01-22)

### Initial Alpha Release
- **Non-custodial wallet**: BTC, LTC, XMR, WOW, GRIN
- **HD key derivation**: Single seed phrase for all assets
- **Social tipping**: Tip by Telegram username
- **Grin support**: SRS/RSR flows with client-side WASM
- **Website auth**: Sign in to smirk.cash with wallet signature
- **0-conf detection**: Instant notification for XMR/WOW
- Chrome and Firefox support
