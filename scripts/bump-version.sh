#!/bin/bash
# Bump version across all files
# Usage: ./scripts/bump-version.sh 0.1.4

set -e

if [[ -z "$1" ]]; then
    echo "Usage: $0 <new-version>"
    echo "Example: $0 0.1.4"
    exit 1
fi

NEW_VERSION="$1"

# Validate version format
if [[ ! "$NEW_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    echo "Error: Version must be in format X.Y.Z (e.g., 0.1.4)"
    exit 1
fi

echo "Bumping version to $NEW_VERSION..."

# Update package.json
node -e "
const fs = require('fs');
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
pkg.version = '$NEW_VERSION';
fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
"
echo "Updated package.json"

# Update manifest.json (Chrome)
node -e "
const fs = require('fs');
const manifest = JSON.parse(fs.readFileSync('manifest.json', 'utf8'));
manifest.version = '$NEW_VERSION';
fs.writeFileSync('manifest.json', JSON.stringify(manifest, null, 2) + '\n');
"
echo "Updated manifest.json"

# Update manifest.firefox.json
node -e "
const fs = require('fs');
const manifest = JSON.parse(fs.readFileSync('manifest.firefox.json', 'utf8'));
manifest.version = '$NEW_VERSION';
fs.writeFileSync('manifest.firefox.json', JSON.stringify(manifest, null, 2) + '\n');
"
echo "Updated manifest.firefox.json"

echo ""
echo "Version bumped to $NEW_VERSION"
echo "Don't forget to commit the changes!"
