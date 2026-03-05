# YouLy+

A web extension to elevate your **YouTube Music, Tidal & Apple Music** Experience with **ultra-performant, word-by-word lyrics**.

[![License](https://img.shields.io/github/license/ibratabian17/YouLyPlus?style=for-the-badge)](https://github.com/ibratabian17/YouLyPlus/blob/main/LICENSE)
[![Latest Version](https://img.shields.io/github/v/release/ibratabian17/YouLyPlus?style=for-the-badge)](https://github.com/ibratabian17/YouLyPlus/releases)
[![GitHub Stars](https://img.shields.io/github/stars/ibratabian17/YouLyPlus?style=for-the-badge&color=yellow)](https://github.com/ibratabian17/YouLyPlus/stargazers)
[![GitHub Forks](https://img.shields.io/github/forks/ibratabian17/YouLyPlus?style=for-the-badge&color=blue)](https://github.com/ibratabian17/YouLyPlus/network/members)

<p align="center">
<img src="youlyplus.png" alt="The Screenshot">
</p>

---

## ➡️ Why YouLy+?

Streaming services offer great music libraries, but their web interfaces are buggy, outdated and often only have line-by-line lyrics. **YouLy+ replaces these broken implementations with a word-by-word, lightweight, precise (idts), and visually faithful rendering engine.**

Other open-source projects that provide Apple Music-like lyrics often require dedicated GPUs for full performance. **YouLy+ smartly utilises CSS animations to hit 60FPS on almost any machine with graphics acceleration. See [Performance Reference](#performance-reference).**

## Supported streaming platforms

* **YouTube Music:** Transforms the default static or plain text lyrics into a rich, timed, karaoke-style experience.
* **Tidal Web (Experimental):** While Tidal Web offers synced lyrics, they are limited to **line-by-line** synchronization. YouLy+ makes them **word-by-word**.
* **Apple Music Web (Experimental):** The native web player attempts word-by-word sync, but the implementation is flawed and inaccurate. YouLy+ replaces their laggy implementation with a CSS-animation driven smooth experience.

## Installation

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
    git clone [https://github.com/ibratabian17/YouLyPlus.git](https://github.com/ibratabian17/YouLyPlus.git)
    ```
2.  Alternatively, you can download the latest release from [Github Releases](https://github.com/ibratabian17/YouLyPlus/releases/latest) and extract them.
3.  **Open Chrome Extensions Page:**
    Navigate to `chrome://extensions/`.
4.  **Enable Developer Mode:**
    Toggle the "Developer mode" switch in the top right corner.
5.  **Load Unpacked Extension:**
    Click on "Load unpacked" and select the cloned repository folder.

### For Firefox

1.  **Clone or Download the Repository:**
    ```bash
    git clone [https://github.com/ibratabian17/YouLyPlus.git](https://github.com/ibratabian17/YouLyPlus.git)
    ```
2.  Alternatively, you can download the latest release from [Github Releases](https://github.com/ibratabian17/YouLyPlus/releases/latest).
3.  **Open Firefox Debugging Page:**
    Navigate to `about:debugging#/runtime/this-firefox`.
4.  **Load Temporary Add-on:**
    Click on "Load Temporary Add-on" and choose the `manifest.json` file from the repository folder.

</details>

## Usage

Once installed, simply open one of the supported players:
* **[YouTube Music](https://music.youtube.com/)**
* **[Tidal Web Player](https://listen.tidal.com/)** *(Experimental)*
* **[Apple Music Web](https://music.apple.com/)** *(Experimental)*

Play any song, and the lyrics panel will automatically be enhanced by YouLy+.

-   **Quick Settings:** Access quick toggles by clicking the YouLy+ icon in your browser's toolbar.
-   **Full Settings:** For comprehensive customization, click **"More Settings"** from the popup.

## Features

### Core Features

-   **Word-by-word, syllable-synced lyrics**: YouLy+ features real-time, accurately synced lyrics with word-by-word highlighting.
-   **Apple Music engine overhaul**: Replaces the resource-heavy native UI. YouLy+ solves the `setTimeout` drift issues and layout bugs while significantly lowering CPU usage. It also expands the lyric sources—if AM lacks synced lyrics, YouLy+ finds them elsewhere!
-   **Multi-platform fallback**: Automatically searches multiple platforms to find lyrics for almost every song.
-   **Fits seamlessly**: Replaces default lyrics panels out of the box with designs that fit in to whichever platform you use.

### Translation & Romanization

-   **Instant Translation**: YouLy+ utilises label-provided translations but also supports **Google Translate** and **Gemini/OpenRouter** (BYO API key) translations.
-   **Romanization**: For different writing systems, YouLy+ can provide romanisations from the label or via Google Translate.
-   **Full Gemini AI Control**: For advanced users, connect your own Gemini AI account to customize translation instructions and AI settings.

### Appearance & Customization

-   **Dynamic Theming**: Lyrics and backgrounds automatically adapt to the **song's color palette**.
-   **Custom CSS**: Full control for advanced users to inject custom CSS and style the lyrics exactly how you want.

### Performance

-   **Optimized Renderer**: YouLy+ is designed and tested to run smoothly on older hardware without noticeable lag.
-   **Lightweight Mode**: The renderer hits 60FPS out of the box on a M1 MBA. **Lightweight Mode** can be used to hit 60FPS even worse machines without much change in the experience - beating all competitors.
-   **SponsorBlock Integration:** Automatically adapts lyrics timeline to follow non-music segments like intros, outros, and sponsors on music videos (YouTube Music).

## Performance Reference

The benchmark machine used to develop this project is older hardware (AMD FX-6300 + GT 620 from ~2012). YouLy+ is optimized to run where native web players fail.

### GPU Performance (Targeting 60 FPS)

- **768p (1366x768):** Stable 60 FPS on **NVIDIA GT 620** (1GB) or equivalent integrated graphics.
- **1080p (1920x1080):** GTX 650 / GT 1030 or above recommended for a locked 60 FPS.
    * *Note: For some reason, Chromium 144.0.7559.133 has a random bug that causes lag because of a browser issue. To fix this, simply click anywhere on the site. We can't do anything about it because it's an engine bug. (February 8, 2026)*

- Tested on a M1 MacBook Air (base specs, 1680x1050 Retina display), YouLy+ stays stable at 60FPS with little decrease in battery life.

## Self-Hosting & Open Source

YouLy+ is proudly open-source.

**Backend API (Lyrics+):** YouLy+ mainly utilises Lyrics+ for lyrics. This API is also fully open-source. If you could host your instance, YouLy+ would benefit lots from it! See instructions at the repo: [**ibratabian17/lyricsplus**](https://github.com/ibratabian17/lyricsplus)

## Development

If you're interested in contributing to or modifying YouLy+:

1.  **Clone the Repository:**
    ```bash
    git clone [https://github.com/ibratabian17/YouLyPlus.git](https://github.com/ibratabian17/YouLyPlus.git)
    ```
2.  **Load the Extension:**
    Use your browser’s "Load unpacked" feature (as described in the [Installation](#installation) section) to test your changes in real-time.

## Packaging

To create distributable `.zip` files for various browsers:

1.  **Prerequisites:** Ensure you have `jq` and a zip utility (`zip` or `7z`) installed on your system.
2.  **Run the Script:**
    -   On Linux/macOS: `./bundle.sh`
    -   On Windows (PowerShell): `./bundle.ps1`

These scripts will generate optimized packages for different browsers within the `dist/` folder.

## Contributing

Contributions are very appreciated! Please feel free to fork this repository and submit a pull request. For significant changes or new features, it's recommended to open an issue first to discuss your ideas.

This project is a dedicated effort covering both the client extension and the server backend. If YouLy+ enhances your music experience, please consider supporting its continued development:

-   [**Support on Ko-fi**](https://ko-fi.com/ibratabian17)
-   [**Support on Patreon**](https://patreon.com/ibratabian17)
-   [**GitHub Sponsors**](https://github.com/sponsors) (see `FUNDING.yml`)
