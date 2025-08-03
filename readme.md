# YouLy+

**Elevate Your YouTube Music Experience with Dynamic, Karaoke-Style Lyrics.**

[![License](https://img.shields.io/github/license/ibratabian17/YouLyPlus?style=for-the-badge)](https://github.com/ibratabian17/YouLyPlus/blob/main/LICENSE)
[![Latest Version](https://img.shields.io/github/v/release/ibratabian17/YouLyPlus?style=for-the-badge)](https://github.com/ibratabian17/YouLyPlus/releases)
[![GitHub Stars](https://img.shields.io/github/stars/ibratabian17/YouLyPlus?style=for-the-badge&color=yellow)](https://github.com/ibratabian17/YouLyPlus/stargazers)
[![GitHub Forks](https://img.shields.io/github/forks/ibratabian17/YouLyPlus?style=for-the-badge&color=blue)](https://github.com/ibratabian17/YouLyPlus/network/members)

YouLy+ transforms YouTube Music's default static lyrics into a dynamic, immersive, and highly customizable karaoke-style experience. Designed for music lovers, it offers more than just words on a screen – it's a complete lyrical enhancement.

---

## Table of Contents

-   [🌟 Why YouLy+?](#-why-youly)
-   [Features](#features)
-   [Installation](#installation)
-   [Usage](#usage)
-   [Self-Hosting & Open Source](#self-hosting--open-source)
-   [Development](#development)
-   [Packaging](#packaging)
-   [Contributing](#contributing)

## 🌟 Why YouLy+?

While YouTube Music excels at audio, its native lyrics often fall short. YouLy+ fills this gap by providing the rich, interactive lyrics experience that music deserves. It's lightweight, open-source, and designed to make your music sessions more engaging and enjoyable.

## ✨ Features

YouLy+ is packed with features designed to enhance your YouTube Music lyrics experience:

### 🎤 Core Lyrics Experience

-   **Advanced Synchronized Lyrics:** Enjoy real-time, accurately synced lyrics with line-by-line highlighting.
-   **Word-by-Word Highlighting:** Dive into an immersive karaoke-style experience with precise word highlighting.
-   **Official Subtitle Fallback:** Automatically uses YouTube's official subtitles if synced lyrics aren't available.
-   **Multiple Providers:** Choose your preferred lyrics source from Lyrics+ (KPoe), LRCLIB, or even your own custom server. Re-order internal sources (Musixmatch, Apple Music, etc.) to prioritize your favorites.
-   **Native Integration:** Replaces default YouTube Music lyrics with custom, interactive elements. Click-to-seek, scroll to find lines, and more!

### 🌐 Translation & AI Power

-   **Instant Translation:** Translate lyrics on the fly using **Google Translate** or the powerful **Gemini AI**.
-   **Romanization:** Get romanized lyrics for non-Latin scripts (e.g., Japanese, Korean, Cyrillic).
-   **Full Gemini AI Control:** Power users can add their own Gemini API key, select specific AI models, and write custom prompts for tailored translations.

### 🎨 Appearance & Customization

-   **Dynamic Theming:** Lyrics and backgrounds automatically adapt to the **song's color palette**.
-   **Visual Effects:** Enable an Apple Music-style **blur for inactive lines** to improve focus.
-   **Custom CSS:** Apply your own CSS for complete visual control and personalization.

### ⚙️ Performance & Integration

-   **Lightweight & Performant:** Built for speed and efficiency, running at a smooth **60 FPS on modest hardware** (tested on AMD FX-6350 & NVIDIA GT 620 with minimal CPU/GPU impact).
-   **Performance Modes:** Utilize **Lightweight Mode** or **Compatibility Mode** for smooth animations on any machine.
-   **SponsorBlock Integration:** Automatically skip non-music segments like intros, outros, and sponsor messages.
-   **Intelligent Caching:** Smart caching reduces load times and API calls, with strategies from aggressive to none.

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

Once installed, simply open [YouTube Music](https://music.youtube.com/) and play any song. The lyrics panel will automatically be enhanced by YouLy+.

-   **Quick Settings:** Access quick toggles by clicking the YouLy+ icon in your browser's toolbar.
-   **Full Settings:** For comprehensive customization, click **"More Settings"** from the popup to open the dedicated settings page.

## ☁️ Self-Hosting & Open Source

YouLy+ is proudly open-source, offering full transparency and control to its users.

-   **Client:** The extension's codebase in this repository is fully open for inspection and modification.
-   **Server:** The default `Lyrics+` provider backend is also open-source! You can review its code and even deploy your own instance for personal use. Explore the server repository here:
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
