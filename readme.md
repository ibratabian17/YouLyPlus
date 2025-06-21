# YouLy+

YouLy+ is a browser extension that enhances your YouTube Music experience by providing an **enhanced lyrics feature** with line-by-line and word-by-word synchronization. Follow along with your favorite songs like never before!

## Features

- **Synchronized Lyrics:** Enjoy real-time, accurately synced lyrics that highlight each line and word as the song plays.
- **Seamless YouTube Music Integration:** Automatically activates on YouTube Music, displaying enhanced lyrics without interrupting your listening experience.
- **Customizable Settings:** Tweak the lyrics display and synchronization options to best suit your preferences.
- **Lightweight and Fast:** Built to work smoothly with minimal impact on your system’s performance.

## Installation

### From Official Web Store
<p float="left">
<a href="https://addons.mozilla.org/en-US/firefox/addon/youly/" target="_blank"><img src="https://blog.mozilla.org/addons/files/2020/04/get-the-addon-fx-apr-2020.svg" alt="Firefox Add-ons" height="60"/></a>
<a href="https://microsoftedge.microsoft.com/addons/detail/youly/gichhhcjpkhbidkecadfejcjgcmdlnpb" target="_blank"><img src="https://upload.wikimedia.org/wikipedia/commons/f/f7/Get_it_from_Microsoft_Badge.svg" alt="Microsoft Edge Extensions" height="60"/></a>
</p>

### For Chrome (Manifest V3)

1. **Clone or Download the Repository:**  
   ```bash
   git clone https://github.com/ibratabian17/YouLyPlus.git
   ```
2. **Open Chrome Extensions Page:**  
   Navigate to `chrome://extensions/`.
3. **Enable Developer Mode:**  
   Toggle the "Developer mode" switch in the top right corner.
4. **Load Unpacked Extension:**  
   Click on "Load unpacked" and select the cloned repository folder.

### For Firefox

1. **Clone or Download the Repository:**  
   ```bash
   git clone https://github.com/ibratabian17/YouLyPlus.git
   ```
2. **Open Firefox Debugging Page:**  
   Navigate to `about:debugging#/runtime/this-firefox`.
3. **Load Temporary Add-on:**  
   Click on "Load Temporary Add-on" and choose the `manifest.json` (or `manifest-v2.json` for legacy support) file from the repository folder.

## Usage

After installation, simply visit [YouTube Music](https://music.youtube.com/). The extension will automatically detect when a song is playing and display the synchronized lyrics. To adjust settings or view additional options, click on the extension icon to open the popup UI.

## Development

If you’d like to contribute or modify YouLy+:

1. **Clone the Repository:**  
   ```bash
   git clone https://github.com/ibratabian17/YouLyPlus.git
   ```
2. **Load the Extension:**  
   Use the browser’s extension loading feature to test your changes in real-time.

## Packaging

To create the distributable zip files for different browser environments:

1.  **Prerequisites:** Ensure you have `jq` (a lightweight and flexible command-line JSON processor) and `zip` installed and available in your system's PATH.
    *   **Linux/macOS:** You can usually install them via your package manager (e.g., `sudo apt install jq zip` or `brew install jq zip`).
    *   **Windows:** Ensure you have either `7z.exe` (7-Zip command-line tool) or `zip.exe` installed. The script will look for `7z.exe` in your PATH and in its default installation directory (`C:\Program Files\7-Zip\`), then fall back to `zip.exe` if `7z.exe` is not found. `7z.exe` is preferred for better compression.

2.  **Run the bundling script:**
    *   **On Linux/macOS:**
        ```bash
        chmod +x bundle.sh
        ./bundle.sh
        ```
    *   **On Windows (using PowerShell):**
        ```powershell
        ./bundle.ps1
        ```
        Note: You might need to adjust your PowerShell execution policy to run local scripts. You can do this by running `Set-ExecutionPolicy RemoteSigned -Scope CurrentUser` in an elevated PowerShell prompt.

The scripts will create a `dist` folder in the project root, containing the following zip files:
*   `youlyplus-v{version}-chrome-edge.zip`: For Chrome and Edge (Manifest V3, optimized for these browsers).
*   `youlyplus-v{version}-chrome-firefox.zip`: For Chrome and Firefox (Manifest V3, includes Firefox-specific settings).
*   `youlyplus-v{version}-generic-v2.zip`: A generic Manifest V2 version.

## Contributing

Contributions are welcome! Please fork this repository and create a pull request with your improvements. For major changes, feel free to open an issue first to discuss your ideas.
