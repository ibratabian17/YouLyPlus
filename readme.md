# YouLy+

**Elevate Your YouTube Music & Tidal Experience with Dynamic, Karaoke-Style Lyrics.**

[![License](https://img.shields.io/github/license/ibratabian17/YouLyPlus?style=for-the-badge)](https://github.com/ibratabian17/YouLyPlus/blob/main/LICENSE)
[![Latest Version](https://img.shields.io/github/v/release/ibratabian17/YouLyPlus?style=for-the-badge)](https://github.com/ibratabian17/YouLyPlus/releases)
[![GitHub Stars](https://img.shields.io/github/stars/ibratabian17/YouLyPlus?style=for-the-badge&color=yellow)](https://github.com/ibratabian17/YouLyPlus/stargazers)
[![GitHub Forks](https://img.shields.io/github/forks/ibratabian17/YouLyPlus?style=for-the-badge&color=blue)](https://github.com/ibratabian17/YouLyPlus/network/members)

<p align="center">
<img src="https://ibratabian17.github.io/youlyplus-page/assets/screenshot-4.png" alt="The Screenshot">
</p>

---

## 🌟 Why YouLy+?

YouTube Music & Tidal are great for listening, but their default lyrics are often just static, plain text.  
YouLy+ completely transforms this by injecting a rich, interactive, and beautifully animated karaoke-style experience directly into the player interface.

It's lightweight, fully open-source, and designed to make your music sessions more engaging and fun.

## ✨ Features

YouLy+ is packed with features designed to enhance your lyrics experience:

### 🎤 Core Lyrics Experience

-   **Advanced Synchronized Lyrics:** Enjoy real-time, accurately synced lyrics with line-by-line highlighting.
-   **Word-by-Word Highlighting:** Immersive karaoke-style experience with precise word highlighting.
-   **Official Subtitle Fallback:** Automatically uses official subtitles if synced lyrics aren't available.
-   **Multiple Providers:** Choose where your lyrics come from! Works seamlessly for both YouTube Music and Tidal.
-   **Native Integration:** Replaces default lyrics panel with custom, interactive elements. Click-to-seek, scroll to find lines, and more!

### 🌐 Translation & Romanization

-   **Instant Translation:** Translate lyrics on the fly using **Google Translate** or the powerful **Gemini AI** (need API KEY).
-   **Romanization:** See lyrics written in the familiar English alphabet, even for languages that use different writing systems (like Japanese, Korean, or Russian). (Only for some songs, if it doesn't exist, it will use lyrics-on-the-fly romanization)
-   **Full Gemini AI Control:** For advanced users, you can connect your own Gemini AI account, choose different AI settings, and even create your own instructions for how translations should work.

### 🎨 Appearance & Customization

-   **Dynamic Theming:** Lyrics and backgrounds automatically adapt to the **song's color palette**.
-   **Visual Effects:** Enable an Apple Music-style **blur for inactive lines** to improve focus.
-   **Custom Look:** If you know a bit about web design, you can use custom code (CSS) to make the lyrics look exactly how you want them.

### ⚙️ Performance & Integration

-   **Fast & Smooth:** YouLy+ is designed to run quickly and smoothly, even on older computers, without slowing down your system.
-   **Performance Modes:** Utilize **Lightweight Mode** or **Compatibility Mode** for smooth animations on any machine.
-   **SponsorBlock Integration:** Automatically skip non-music segments like intros, outros, and sponsor messages.
-   **Smart Saving:** YouLy+ remembers lyrics it has already found, so they load faster next time and use less internet data.

## ⬇️ Installation

### ⭐ Recommended: Install from Official Stores

For the safest and easiest experience, install YouLy+ directly from your browser's web store. This ensures you get automatic updates and a verified version of the extension.

<p float="left">
<a href="https://addons.mozilla.org/en-US/firefox/addon/youly/" target="_blank"><img src="https://blog.mozilla.org/addons/files/2020/04/get-the-addon-fx-apr-2020.svg" alt="Firefox Add-ons" height="60"/></a>
<a href="https://microsoftedge.microsoft.com/addons/detail/youly/gichhhcjpkhbidkecadfejcjgcmdlnpb" target="_blank"><img src="https://upload.wikimedia.org/wikipedia/commons/f/f7/Get_it_from_Microsoft_Badge.svg" alt="Microsoft Edge Extensions" height="60"/></a>
</p>

<details>
<summary><b>For Chrome Users, Developers & Advanced Users: Install from Source</b></summary>

### For Chrome (Manifest V3)

1.  **Clone or Download the Repository:**
    ```bash
    git clone https://github.com/ibratabian17/YouLyPlus.git
    ```
2.  Alternatively, you can download the latest release from [Github Releases](https://github.com/ibratabian17/YouLyPlus/releases/latest).
3.  **Open Chrome Extensions Page:**
    Navigate to `chrome://extensions/`.
4.  **Enable Developer Mode:**
    Toggle the "Developer mode" switch in the top right corner.
5.  **Load Unpacked Extension:**
    Click on "Load unpacked" and select the cloned repository folder.

### For Firefox

1.  **Clone or Download the Repository:**
    ```bash
    git clone https://github.com/ibratabian17/YouLyPlus.git
    ```
2.  Alternatively, you can download the latest release from [Github Releases](https://github.com/ibratabian17/YouLyPlus/releases/latest).
3.  **Open Firefox Debugging Page:**
    Navigate to `about:debugging#/runtime/this-firefox`.
4.  **Load Temporary Add-on:**
    Click on "Load Temporary Add-on" and choose the `manifest.json` file from the repository folder.

</details>

## 🚀 Usage

Once installed, simply open [YouTube Music](https://music.youtube.com/) **or [Tidal Web Player](https://listen.tidal.com/)** and play any song.  
The lyrics panel will automatically be enhanced by YouLy+ with custom lyrics — no external API setup required (except for Gemini AI features).

-   **Quick Settings:** Access quick toggles by clicking the YouLy+ icon in your browser's toolbar.
-   **Full Settings:** For comprehensive customization, click **"More Settings"** from the popup.

## ☁️ Self-Hosting & Open Source

YouLy+ is proudly open-source, offering full transparency and control to its users.

-   **Client (The Extension):** The code for the YouLy+ extension itself is completely open for anyone to look at and change.
-   **Server (Lyrics+ Provider):** The main source for lyrics (Lyrics+) is also open for anyone to see its code. You can even set up your own version of it if you want! Find the server code here:
    -   [**ibratabian17/lyricsplus**](https://github.com/ibratabian17/lyricsplus)

## 🧑‍💻 Development

If you're interested in contributing to or modifying YouLy+:

1.  **Clone the Repository:**
    ```bash
    git clone https://github.com/ibratabian17/YouLyPlus.git
    ```
2.  **Load the Extension:**
    Use your browser’s "Load unpacked" feature (as described in the [Installation](#installation) section) to test your changes in real-time.

## 📦 Packaging

To create distributable `.zip` files for various browsers:

1.  **Prerequisites:** Ensure you have `jq` and a zip utility (`zip` or `7z`) installed on your system.
2.  **Run the Script:**
    -   On Linux/macOS: `./bundle.sh`
    -   On Windows (PowerShell): `./bundle.ps1`

These scripts will generate optimized packages for different browsers within the `dist/` folder.

## 🤝 Contributing

Contributions are highly welcome! Please feel free to fork this repository and submit a pull request. For significant changes or new features, it's recommended to open an issue first to discuss your ideas.

This project is a dedicated effort covering both the client extension and the server backend. If YouLy+ enhances your YouTube Music experience, please consider supporting its continued development:

-   [**Support on Ko-fi**](https://ko-fi.com/ibratabian17)
-   [**Support on Patreon**](https://patreon.com/ibratabian17)
-   [**GitHub Sponsors**](https://github.com/sponsors) (see `FUNDING.yml`)
