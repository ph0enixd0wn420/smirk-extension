#!/bin/bash
# Release script for Smirk Wallet extension
# Creates tagged releases for both Chrome and Firefox

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Get version from package.json
VERSION=$(node -p "require('./package.json').version")

echo -e "${GREEN}=== Smirk Wallet Release Script ===${NC}"
echo -e "Version: ${YELLOW}v${VERSION}${NC}"
echo ""

# Check for uncommitted changes
if [[ -n $(git status --porcelain) ]]; then
    echo -e "${RED}Error: You have uncommitted changes. Please commit or stash them first.${NC}"
    exit 1
fi

# Check if tag already exists
if git rev-parse "v${VERSION}" >/dev/null 2>&1; then
    echo -e "${RED}Error: Tag v${VERSION} already exists.${NC}"
    echo "Bump the version in package.json and manifest files first."
    exit 1
fi

# Verify manifest versions match package.json
CHROME_VERSION=$(node -p "require('./manifest.json').version")
FIREFOX_VERSION=$(node -p "require('./manifest.firefox.json').version")

if [[ "$VERSION" != "$CHROME_VERSION" ]]; then
    echo -e "${RED}Error: Chrome manifest version ($CHROME_VERSION) doesn't match package.json ($VERSION)${NC}"
    exit 1
fi

if [[ "$VERSION" != "$FIREFOX_VERSION" ]]; then
    echo -e "${RED}Error: Firefox manifest version ($FIREFOX_VERSION) doesn't match package.json ($VERSION)${NC}"
    exit 1
fi

echo -e "${GREEN}All version numbers match${NC}"
echo ""

# Create releases directory
mkdir -p releases

# Typecheck (fail on errors)
echo -e "${YELLOW}Running typecheck...${NC}"
npm run typecheck
echo -e "${GREEN}Typecheck passed${NC}"

# Run tests
echo -e "${YELLOW}Running tests...${NC}"
npm run test

# Build Chrome version
echo -e "${YELLOW}Building Chrome version...${NC}"
npm run build:chrome
cd dist && zip -r "../releases/smirk-wallet-chrome-v${VERSION}.zip" . && cd ..
echo -e "${GREEN}Created: releases/smirk-wallet-chrome-v${VERSION}.zip${NC}"

# Build Firefox version
echo -e "${YELLOW}Building Firefox version...${NC}"
npm run build:firefox
cd dist && zip -r "../releases/smirk-wallet-firefox-v${VERSION}.zip" . && cd ..
echo -e "${GREEN}Created: releases/smirk-wallet-firefox-v${VERSION}.zip${NC}"

# Create source archive for Mozilla (must be reproducible)
echo -e "${YELLOW}Creating source archive for Mozilla...${NC}"
git archive --format=zip --prefix="smirk-wallet-${VERSION}/" HEAD -o "releases/smirk-wallet-${VERSION}-src.zip"
echo -e "${GREEN}Created: releases/smirk-wallet-${VERSION}-src.zip${NC}"

# Create git tag
echo ""
echo -e "${YELLOW}Creating git tag v${VERSION}...${NC}"
git tag -a "v${VERSION}" -m "Release v${VERSION}"
echo -e "${GREEN}Tag v${VERSION} created${NC}"

echo ""
echo -e "${GREEN}=== Release v${VERSION} complete ===${NC}"
echo ""
echo "Files created in releases/:"
echo "  - smirk-wallet-chrome-v${VERSION}.zip (Chrome Web Store)"
echo "  - smirk-wallet-firefox-v${VERSION}.zip (Mozilla Add-ons)"
echo "  - smirk-wallet-${VERSION}-src.zip (Mozilla source code)"
echo ""
echo "Next steps:"
echo "  1. Push the tag: git push origin v${VERSION}"
echo "  2. Upload releases/smirk-wallet-chrome-v${VERSION}.zip to Chrome Web Store"
echo "  3. Upload releases/smirk-wallet-firefox-v${VERSION}.zip and releases/smirk-wallet-${VERSION}-src.zip to Mozilla Add-ons"
