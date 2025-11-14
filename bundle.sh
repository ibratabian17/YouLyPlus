#!/bin/bash

# Exit immediately if a command exits with a non-zero status.
set -e

# Get version from manifest.json
VERSION=$(jq -r .version manifest.json)
if [ -z "$VERSION" ]; then
  echo "Error: Could not read version from manifest.json"
  exit 1
fi

echo "Bundling YouLy+ version $VERSION"

# Create dist directory if it doesn't exist
mkdir -p dist

# Define common files/directories to bundle
COMMON_FILES="LICENSE icons src readme.md"

# --- Bundle for Chrome/Edge (Manifest V3, no browser_specific_settings, no background.scripts) ---
echo "Creating youlyplus-v${VERSION}-chrome-edge.zip..."
TEMP_DIR="temp_chrome_edge"
mkdir -p "$TEMP_DIR"

# Copy common files
cp -r $COMMON_FILES "$TEMP_DIR/"

# Modify manifest.json for Chrome/Edge
jq 'del(.browser_specific_settings) | del(.background.scripts)' manifest.json > "$TEMP_DIR/manifest.json"

# Create zip archive
(cd "$TEMP_DIR" && zip -r "../dist/youlyplus-v${VERSION}-chrome-edge.zip" .)

# Clean up temporary directory
rm -rf "$TEMP_DIR"
echo "Finished youlyplus-v${VERSION}-chrome-edge.zip"

# --- Bundle for Chrome/Firefox (Manifest V3, with browser_specific_settings) ---
echo "Creating youlyplus-v${VERSION}-chrome-firefox.zip..."
TEMP_DIR="temp_chrome_firefox"
mkdir -p "$TEMP_DIR"

# Copy common files and original manifest.json
cp -r $COMMON_FILES "$TEMP_DIR/"
cp manifest.json "$TEMP_DIR/manifest.json"

# Create zip archive
(cd "$TEMP_DIR" && zip -r "../dist/youlyplus-v${VERSION}-chrome-firefox.zip" .)

# Clean up temporary directory
rm -rf "$TEMP_DIR"
echo "Finished youlyplus-v${VERSION}-chrome-firefox.zip"

echo "Bundling complete. Output files are in the 'dist' directory."
