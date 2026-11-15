# SalviaBrowxer Web

A modern web application rewrite of **SalviaBrowxer** (`SaliSalvia/SalviaBrowxer`) built with React, TypeScript, Vite, and Tailwind CSS v4.

## Features

- **Home Hub & Link Classifier**: Paste a webpage or direct media URL (`.mp4`, `.m3u8`, `.mp3`, etc.) with automatic clipboard detection and direct routing into browsing or quality selection.
- **Proxied Web Browser**: Browse external URLs through `/api/browse`, with search-engine switching (Google, DuckDuckGo, Bing, Yahoo, Ecosia), bookmark/history autocomplete suggestions, Desktop/Mobile user-agent toggle, per-site ad & tracker host blocking, Find in Page, HTTPS-first cleartext prompt, and 8-tab LRU hibernation + Private tabs.
- **Media Detection & Quality Selection**: Automatic HTML media scanning and DOM playback observation feeding a draggable floating download orb (tap to download main stream, long-press to open the full media tray) and quality selector modal with HLS variant parsing and stream probing.
- **Download Manager & Locked Folder**: Simultaneous queue scheduling, pause/resume/cancel/retry, Wi-Fi hold guard, live speed and ETA telemetry, browser file export, and a local PBKDF2-HMAC-SHA256 (120,000 iterations) password-protected folder with progressive lockout.
- **In-App Media Player**: HTML5 + `hls.js` video/audio playback with playback speed controls, sequential/loop/reverse/shuffle queue modes, seek controls, and fullscreen mode.
- **Bilingual UI (English / Persian RTL)**: Dynamic switching between `English`, `فارسی` (RTL with Vazirmatn typography), or `System default`.

## Development

```bash
npm install
npm run dev
```

Starts the Vite dev server and browser middleware on port `3000`.

## Production Build

```bash
npm run build
npm run lint
```

## License

Licensed under the terms in [LICENSE](LICENSE) (GPL-3.0).
