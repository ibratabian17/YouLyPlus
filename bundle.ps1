# Exit immediately if a command exits with a non-zero status.
$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest # Add this for stricter error checking

# Get version from manifest.json
try {
    $manifest = Get-Content -Raw -Path manifest.json | ConvertFrom-Json
    $VERSION = $manifest.version
    if ([string]::IsNullOrEmpty($VERSION)) {
        Write-Error "Error: Could not read version from manifest.json"
        exit 1
    }
} catch {
    Write-Error "Error reading or parsing manifest.json: $($_.Exception.Message)"
    exit 1
}

Write-Host "Bundling YouLy+ version $VERSION"

# Create dist directory if it doesn't exist
if (-not (Test-Path -Path "dist" -PathType Container)) {
    New-Item -Path "dist" -ItemType Directory | Out-Null
}

# Define common files/directories to bundle
$COMMON_FILES = @("LICENSE", "icons", "src", "readme.md", "_locales")

# --- Minification setup ---
# Resolve esbuild for minifying JS/CSS copies (local install > PATH > npm/npx).
$esbuild = $null
$globalEsbuild = Get-Command esbuild -ErrorAction SilentlyContinue
if ($globalEsbuild) {
    $esbuild = @{ Executable = $globalEsbuild.Source; Args = @() }
} elseif (Test-Path "node_modules\.bin\esbuild.cmd") {
    $esbuild = @{ Executable = (Resolve-Path "node_modules\.bin\esbuild.cmd").Path; Args = @() }
} else {
    $npxCmd = Get-Command npx.cmd -ErrorAction SilentlyContinue
    if (-not $npxCmd) { $npxCmd = Get-Command npx -ErrorAction SilentlyContinue }
    if ($npxCmd) {
        $esbuild = @{ Executable = $npxCmd.Source; Args = @("--yes", "esbuild") }
    }
}

if (-not $esbuild) {
    Write-Warning "esbuild not found. Skipping JS/CSS minification."
}

function Invoke-Minifier {
    param([string]$File)
    if (-not $esbuild) { return }
    $toolArgs = @()
    if ($esbuild.Args) { $toolArgs += $esbuild.Args }
    $toolArgs += @("--minify", $File, "--outfile=$File", "--log-level=warning", "--allow-overwrite")
    & $esbuild.Executable @toolArgs
    if ($LASTEXITCODE -ne 0) {
        Write-Error "esbuild failed on $File (exit code $LASTEXITCODE)."
        exit 1
    }
}

# Minify all .js/.mjs/.css files under $Dir in place, skipping pre-minified files.
function Invoke-MinifyDirectory {
    param([string]$Dir)
    if (-not $esbuild) { return }
    Get-ChildItem -Path $Dir -Recurse -File | Where-Object {
        $_.Extension -in @('.js', '.mjs', '.css') -and
        $_.Name -notmatch '\.min\.(js|mjs|css)$' -and
        $_.Name -ne 'ort-wasm-simd-threaded.mjs'
    } | ForEach-Object {
        Write-Host "Minifying: $($_.FullName)"
        Invoke-Minifier -File $_.FullName
    }
}

# Function to create zip archive using 7z.exe or zip.exe
function Create-ZipArchive {
    param (
        [string]$SourceDir,
        [string]$DestinationZipRelative # This is the path relative to the original script location
    )
    Write-Host "Zipping contents of $SourceDir to $DestinationZipRelative"
    
    # Construct the absolute path for the destination zip
    $absoluteDestinationZip = Join-Path (Get-Location) $DestinationZipRelative

    if (Test-Path -Path $absoluteDestinationZip) { Remove-Item -Path $absoluteDestinationZip -Force | Out-Null }
    
    $zipToolFound = $false
    $sevenZipPath = "$env:ProgramFiles\7-Zip\7z.exe" # Default 7-Zip install path

    # Try using 7z.exe first (check PATH, then default install path)
    $sevenZipCmd = Get-Command 7z.exe -ErrorAction SilentlyContinue
    if (-not $sevenZipCmd -and (Test-Path $sevenZipPath)) {
        $sevenZipCmd = $sevenZipPath
    }

    if ($sevenZipCmd) {
        try {
            Push-Location $SourceDir
            # Use the absolute path for the destination zip
            & $sevenZipCmd a -tzip "$absoluteDestinationZip" . 
            Pop-Location
            $zipToolFound = $true
        } catch {
            Write-Warning "Error using 7z.exe: $($_.Exception.Message). Trying zip.exe..."
        }
    }

    # If 7z.exe failed or not found, try zip.exe
    if (-not $zipToolFound -and (Get-Command zip.exe -ErrorAction SilentlyContinue)) {
        try {
            Push-Location $SourceDir
            # Use the absolute path for the destination zip
            & zip.exe -r "$absoluteDestinationZip" . 
            Pop-Location
            $zipToolFound = $true
        } catch {
            Write-Warning "Error using zip.exe: $($_.Exception.Message)."
        }
    }

    if (-not $zipToolFound) {
        Write-Error "Error: Neither '7z.exe' (in PATH or default install location) nor 'zip.exe' found or failed to execute. Please install one of them and ensure it's in your PATH, or 7-Zip is in its default location."
        exit 1
    }
}

# --- Bundle for Chrome/Edge (Manifest V3, no browser_specific_settings, no background.scripts) ---
Write-Host "Creating youlyplus-v${VERSION}-chrome-edge.zip..."
$TEMP_DIR = "temp_chrome_edge"
if (Test-Path -Path $TEMP_DIR -PathType Container) {
    Remove-Item -Path $TEMP_DIR -Recurse -Force | Out-Null
}
New-Item -Path $TEMP_DIR -ItemType Directory | Out-Null

# Copy common files
foreach ($file in $COMMON_FILES) {
    if (Test-Path -Path $file) {
        Copy-Item -Path $file -Destination $TEMP_DIR -Recurse -Force | Out-Null
    }
}

# Modify manifest.json for Chrome/Edge
$manifestChromeEdge = $manifest | ConvertTo-Json -Depth 100
$manifestChromeEdge = $manifestChromeEdge | ConvertFrom-Json
$manifestChromeEdge.PSObject.Properties.Remove("browser_specific_settings")
if ($manifestChromeEdge.background -and $manifestChromeEdge.background.scripts) {
    $manifestChromeEdge.background.PSObject.Properties.Remove("scripts")
}
$manifestChromeEdge | ConvertTo-Json -Depth 100 | Set-Content -Path "$TEMP_DIR/manifest.json" -Force

# Minify JS/CSS copies
Invoke-MinifyDirectory -Dir $TEMP_DIR

# Create zip archive
Create-ZipArchive -SourceDir $TEMP_DIR -DestinationZip "dist/youlyplus-v${VERSION}-chrome-edge.zip"

# Clean up temporary directory
Remove-Item -Path $TEMP_DIR -Recurse -Force | Out-Null
Write-Host "Finished youlyplus-v${VERSION}-chrome-edge.zip"

# --- Bundle for Chrome/Firefox (Manifest V3, with browser_specific_settings) ---
Write-Host "Creating youlyplus-v${VERSION}-chrome-firefox.zip..."
$TEMP_DIR = "temp_chrome_firefox"
if (Test-Path -Path $TEMP_DIR -PathType Container) {
    Remove-Item -Path $TEMP_DIR -Recurse -Force | Out-Null
}
New-Item -Path $TEMP_DIR -ItemType Directory | Out-Null

# Copy common files and original manifest.json
foreach ($file in $COMMON_FILES) {
    if (Test-Path -Path $file) {
        Copy-Item -Path $file -Destination $TEMP_DIR -Recurse -Force | Out-Null
    }
}
Copy-Item -Path "manifest.json" -Destination "$TEMP_DIR/manifest.json" -Force | Out-Null

# Minify JS/CSS copies
Invoke-MinifyDirectory -Dir $TEMP_DIR

# Create zip archive
Create-ZipArchive -SourceDir $TEMP_DIR -DestinationZip "dist/youlyplus-v${VERSION}-chrome-firefox.zip"

# Clean up temporary directory
Remove-Item -Path $TEMP_DIR -Recurse -Force | Out-Null
Write-Host "Finished youlyplus-v${VERSION}-chrome-firefox.zip"

Write-Host "Bundling complete. Output files are in the 'dist' directory."
