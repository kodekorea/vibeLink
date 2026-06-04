# Changelog

## [0.1.0] — 2026-05-28

### Added
- **MTB: Start Server** command — starts HTTP + WebSocket server with cloudflared tunnel
- **MTB: Stop Server** command
- **MTB: Show QR Code** command — prints QR to Output panel
- Real-time terminal streaming via VS Code Shell Integration API
- Active editor sync (content + cursor position) with 300 ms debounce
- QR code pairing — scan once, JWT cookie valid 7 days
- cloudflared auto-download per platform (Windows / macOS x64 / macOS arm64 / Linux)
- PWA with xterm.js terminal and highlight.js code view
- Terminal history buffer (50 KB per terminal) replayed on new connections
- `temp` / `named` / `none` tunnel modes
