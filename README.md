<p align="center">
  <img src="icons/icon128.png" alt="GeoFinder Logo" width="128" height="128">
</p>

<h1 align="center">GeoFinder</h1>

<p align="center">
  <strong>AI-Powered Photo Location Detection</strong><br>
  A Chromium based extension that analyzes images to identify their geographical location using Google Gemini AI.
</p>

<p align="center">
  <a href="https://chromewebstore.google.com/detail/geofinder-photo-location/nndmkilplgkfmcllgnhhflcpbljnlpep">Chrome Web Store</a> •
  <a href="https://aistudio.google.com/">Get API Key</a>
</p>

---

## Architecture

**User Input** → `popup.js` → `background.js` → **Gemini API** → **Results**

**Right-click Image** → `background.js` → **Gemini API** → **Overlay**

### Files

- `popup.js` — UI logic, image handling, result display
- `background.js` — Service worker, API calls, context menu
- `config.js` — Shared prompt and API settings
- `manifest.json` — Extension permissions

---

## Quick Start

1. Clone and load as unpacked extension in Chrome
2. Get API key from [Google AI Studio](https://aistudio.google.com/)
3. Enter API key in extension settings
4. Upload image or right-click any image → "Analyze Location"

---

## License

MIT
