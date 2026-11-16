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
npm ci
npm run dev
```

Starts the Vite dev server and browser middleware on port `3000`.

## Production Build

```bash
npm run build
npm run lint
npm run test
```

The web bundle is the UI layer only. `/api/browse`, `/api/media/probe`, `/api/media/extract` and
`/api/media/fetch` are served by the Vite middleware in development and by the Android app
(`NativeProxyClient`) in production. A static `dist/` deployment renders the interface but cannot
browse or download; use the Android build for real browsing.

### Download engine behaviour

- Direct files resume with an HTTP `Range` request after a pause, and only when the bytes already
  received are still in memory; otherwise the transfer restarts from zero instead of writing a
  truncated file.
- HLS: master playlists are followed to the best variant, `EXT-X-MAP` initialisation segments are
  prepended, `EXT-X-BYTERANGE` segments are fetched by range, and AES-128 playlists are decrypted with
  the key the manifest names. `SAMPLE-AES` and live playlists are refused with an explicit reason.
- DASH: a progressive rendition downloads directly; a manifest that keeps audio in a separate track
  is refused honestly in the web build instead of saving a silent video (the Android app muxes both
  tracks). Concatenated MPEG-TS playlists are saved with a `.ts` extension rather than a mislabelled
  `.mp4`.

### Playback recording

The “Record playback” action captures a real `MediaRecorder` stream from the same-origin proxy. On a
runtime without `HTMLMediaElement.captureStream` or `MediaRecorder` the app says so instead of
inventing a file.

## License

Licensed under the terms in [LICENSE](LICENSE) (GPL-3.0).
