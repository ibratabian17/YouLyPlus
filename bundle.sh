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

# --- Minification setup ---
# Resolve esbuild for minifying JS/CSS copies (local install > PATH > npm/npx).
ESBUILD=""
if command -v esbuild >/dev/null 2>&1; then
  ESBUILD="esbuild"
elif [ -x "node_modules/.bin/esbuild" ]; then
  ESBUILD="node_modules/.bin/esbuild"
elif command -v npx >/dev/null 2>&1; then
  ESBUILD="npx --yes esbuild"
fi

# Minify all .js/.mjs/.css files under $1 in place, skipping pre-minified files.
minify_dir() {
  local dir="$1"
  if [ -z "$ESBUILD" ]; then
    echo "Warning: esbuild not found. Skipping minification."
    return
  fi
  find "$dir" -type f \( -name '*.js' -o -name '*.mjs' -o -name '*.css' \) \
       ! -name '*.min.*' ! -name 'ort-wasm-simd-threaded.mjs' -print0 |
  while IFS= read -r -d '' file; do
    echo "Minifying: $file"
    # shellcheck disable=SC2086
    $ESBUILD --minify "$file" --outfile="$file" --log-level=warning --allow-overwrite
  done
}

# Define common files/directories to bundle
COMMON_FILES="LICENSE icons src readme.md _locales"

# --- Bundle for Chrome/Edge (Manifest V3, no browser_specific_settings, no background.scripts) ---
echo "Creating youlyplus-v${VERSION}-chrome-edge.zip..."
TEMP_DIR="temp_chrome_edge"
mkdir -p "$TEMP_DIR"

# Copy common files
cp -r $COMMON_FILES "$TEMP_DIR/"

# Modify manifest.json for Chrome/Edge
jq 'del(.browser_specific_settings) | del(.background.scripts)' manifest.json > "$TEMP_DIR/manifest.json"

# Minify JS/CSS copies
minify_dir "$TEMP_DIR"

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

# Minify JS/CSS copies
minify_dir "$TEMP_DIR"

# Create zip archive
(cd "$TEMP_DIR" && zip -r "../dist/youlyplus-v${VERSION}-chrome-firefox.zip" .)

# Clean up temporary directory
rm -rf "$TEMP_DIR"
echo "Finished youlyplus-v${VERSION}-chrome-firefox.zip"

echo "Bundling complete. Output files are in the 'dist' directory."
