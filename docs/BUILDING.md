# Building & Distribution

## Development

```bash
# Install dependencies
npm install

# Build for development (with watch)
npm run dev

# Build for production
npm run build

# Type check
npm run typecheck
```

## Loading in Chrome (Development)

1. Run `npm run build`
2. Go to `chrome://extensions`
3. Enable "Developer mode"
4. Click "Load unpacked"
5. Select the `dist` folder

## Release Checklist

Before releasing a new version:

1. **Update version numbers:**
   - `package.json` - `"version": "x.x.x"`
   - `manifest.json` - `"version": "x.x.x"`
   - `manifest.firefox.json` - `"version": "x.x.x"`

2. **Test on both browsers:**
   - Chrome: Load unpacked from `dist` after `npm run build:chrome`
   - Firefox: `cd dist && web-ext run` after `npm run build:firefox`

3. **Build release zips:**
   ```bash
   npm run zip:chrome     # Creates smirk-wallet-chrome-vX.X.X.zip
   npm run zip:firefox    # Creates smirk-wallet-firefox-vX.X.X.zip
   ```

4. **Create GitHub release:**
   - Tag: `vX.X.X`
   - Attach both zip files
   - Include changelog

5. **Submit to stores:**
   - Chrome Web Store
   - Firefox Add-ons

---

## Building for Release

Chrome and Firefox require different manifests:
- **Chrome**: Uses `service_worker` (manifest.json)
- **Firefox**: Uses `scripts` (manifest.firefox.json)

```bash
# Build for Chrome (uses manifest.json)
npm run build:chrome
npm run zip:chrome

# Build for Firefox (uses manifest.firefox.json)
npm run build:firefox
npm run zip:firefox
```

---

## Chrome Web Store

**Dashboard:** https://chrome.google.com/webstore/devconsole

### First Submission

1. Click "New Item" → Upload `smirk-wallet-chrome-vX.X.X.zip`
2. Fill in listing details:
   - **Name:** Smirk Wallet
   - **Summary:** Non-custodial multi-currency wallet for crypto tipping
   - **Category:** Productivity
   - **Language:** English
3. Upload assets:
   - **Icon:** 128x128 PNG (use `icons/icon128.png`)
   - **Screenshots:** 1280x800 or 640x400 PNG
   - **Promo tile:** 440x280 PNG (optional)
4. Privacy practices:
   - Single purpose: "Cryptocurrency wallet and tipping"
   - No remote code, no data collection
5. Submit for review

**Review time:** 1-3 business days (crypto extensions may take longer)

### Updates

1. Go to existing extension → "Package" tab
2. Upload new zip
3. Update "What's new" description
4. Submit for review

---

## Firefox Add-ons

**Dashboard:** https://addons.mozilla.org/developers/

### Why a Separate Manifest?

Firefox MV3 has key differences:
- Uses `background.scripts` instead of `background.service_worker`
- Requires `data_collection_permissions` in `browser_specific_settings`
- Needs `strict_min_version: "112.0"` for `background.type: "module"`

### First Submission

1. Click "Submit a New Add-on"
2. Select "On this site" for distribution
3. Upload `smirk-wallet-firefox-vX.X.X.zip`
4. **Source code required:** Upload full source repo as zip (Firefox reviews source)
5. Fill in listing details
6. Submit for review

**Review time:** 1-2 days

### Validation Warnings

Some warnings are expected and can be noted in review:

- **Function constructor warnings** (eval): From WASM crypto libraries - unavoidable for WebAssembly
- **innerHTML warning**: From Preact rendering - safe, no user input

### Testing Locally

```bash
# Install web-ext CLI (one time)
npm install -g web-ext

# Build and run in Firefox
npm run build:firefox
cd dist && web-ext run
```

### Updates

1. Go to existing add-on → "Manage" → "Upload New Version"
2. Upload new zip + source zip
3. Submit for review

---

## Safari (macOS/iOS)

Safari requires converting the extension using Xcode and distributing through the Mac App Store.

**Prerequisites:**
- macOS with Xcode installed
- Apple Developer account ($99/year for distribution)

### Build Steps

```bash
# Build for Chrome first (Safari converter uses Chrome manifest format)
npm run build:chrome

# Convert to Safari extension
xcrun safari-web-extension-converter dist \
  --project-location ./safari-build \
  --app-name "Smirk Wallet"

# Open in Xcode
open safari-build/Smirk\ Wallet/Smirk\ Wallet.xcodeproj
```

### In Xcode

1. Select your development team in project settings
2. Build and run to test locally
3. Enable extension in Safari → Preferences → Extensions
4. Test all functionality
5. Archive and submit to App Store Connect

**Note:** Safari extensions are distributed through the Mac App Store, not as standalone downloads.

---

## Troubleshooting

### Chrome: "Service worker registration failed"
- Check `background.js` exists in `dist/`
- Check for syntax errors in background code
- Check Chrome console for errors

### Firefox: "service_worker is not supported"
- Make sure you're using `manifest.firefox.json` (npm run build:firefox)
- Check `background.scripts` is used instead of `background.service_worker`

### Icons not showing
- Verify icon sizes match manifest declarations
- icon16.png = 16x16, icon48.png = 48x48, icon128.png = 128x128

### WASM not loading
- Check CSP in manifest: `'wasm-unsafe-eval'` is required
- Check WASM files are in `web_accessible_resources`
