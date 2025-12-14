# YouLy+

**Elevate Your YouTube Music, Tidal & Apple Music Experience with Dynamic, Karaoke-Style Lyrics.**

[![License](https://img.shields.io/github/license/ibratabian17/YouLyPlus?style=for-the-badge)](https://github.com/ibratabian17/YouLyPlus/blob/main/LICENSE)
[![Latest Version](https://img.shields.io/github/v/release/ibratabian17/YouLyPlus?style=for-the-badge)](https://github.com/ibratabian17/YouLyPlus/releases)
[![GitHub Stars](https://img.shields.io/github/stars/ibratabian17/YouLyPlus?style=for-the-badge&color=yellow)](https://github.com/ibratabian17/YouLyPlus/stargazers)
[![GitHub Forks](https://img.shields.io/github/forks/ibratabian17/YouLyPlus?style=for-the-badge&color=blue)](https://github.com/ibratabian17/YouLyPlus/network/members)

<p align="center">
<img src="https://ibratabian17.github.io/youlyplus-page/assets/screenshot-4.png" alt="The Screenshot">
</p>

---

## 🌟 Why YouLy+?

Streaming services offer great libraries, but their web interfaces often lag behind in user experience.

*   **For YouTube Music & Tidal:** The default lyrics are often static, plain text, and unengaging. YouLy+ transforms this by injecting rich, synced karaoke-style lyrics.
*   **For Apple Music Web:** The native lyrics UI can be heavy, buggy, and resource-intensive. YouLy+ replaces this broken interface with a lightweight, smooth, and highly customizable alternative.

It's lightweight, fully open-source, and designed to make your music sessions more engaging and fun.

## ✨ Features

YouLy+ is packed with features designed to enhance your lyrics experience:

### 🎤 Core Lyrics Experience

-   **Advanced Synchronized Lyrics:** Enjoy real-time, accurately synced lyrics with line-by-line highlighting.
-   **Word-by-Word Highlighting (YT Music/Tidal):** Immersive karaoke-style experience with precise word highlighting for supported platforms.
-   **Apple Music Lyrics Engine Overhaul:** Replaces the heavy and often broken built-in Apple Music lyrics UI with YouLy+'s optimized, lightweight interface while maintaining synchronization. and with more source, so if the song doesnt have synced, it would automatically find it!
-   **Official Subtitle Fallback:** Automatically uses official subtitles if synced lyrics aren't available.
-   **Multiple Providers:** Choose where your lyrics come from! Works seamlessly across all three platforms.
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

## ⚡ Performance Reference

The benchmark I used is my own pc that developed this project, YouLy+ with config enable blur and dynamic background is able to run smoothly on old hardware from 2012 (for example, AMD FX-6300 + GT 620). any mainstream CPU from the last 10 years (2.7GHz+) is sufficient for smooth operation.

**GPU Performance (Targeting 60 FPS):**
*   **768p (1366x768):** Stable 60 FPS on **NVIDIA GT 620** (1GB) or equivalent integrated graphics.
*   **1080p (1920x1080):** GTX 650 / GT 1030 or above recommended for a locked 60 FPS.
    *   *Note: Legacy cards (GT 620) can still achieve 45-60 FPS at 1080p with minor jitter.*

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

Once installed, simply open one of the supported players:
*   **[YouTube Music](https://music.youtube.com/)**
*   **[Tidal Web Player](https://listen.tidal.com/)**
*   **[Apple Music Web](https://music.apple.com/)**

Play any song, and the lyrics panel will automatically be enhanced by YouLy+.

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

This project is a dedicated effort covering both the client extension and the server backend. If YouLy+ enhances your music experience, please consider supporting its continued development:

-   [**Support on Ko-fi**](https://ko-fi.com/ibratabian17)
-   [**Support on Patreon**](https://patreon.com/ibratabian17)
-   [**GitHub Sponsors**](https://github.com/sponsors) (see `FUNDING.yml`)
