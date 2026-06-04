# Mobile Terminal Bridge

**Mirror your VS Code terminal and editor to your phone — in real-time.**

Open your terminal output and active file on any mobile browser, send commands from your phone keyboard, and get a proper syntax-highlighted code view. No cables, no native app install, just scan a QR code.

---

## Features

- **Real-time terminal streaming** — command output appears on your phone as it runs, rendered by [xterm.js](https://xtermjs.org) with full ANSI color support
- **Code view** — active editor file synced to your phone with syntax highlighting (JS/TS/Python/Go/Rust/Bash + more), cursor line tracking, and 300 ms live updates while you type
- **One-scan setup** — QR code appears in the Output panel on first start; scan with your phone and enter your password once
- **No account required** — uses [cloudflared](https://github.com/cloudflare/cloudflared) temp tunnel by default (auto-downloaded). Optional fixed URL with a Cloudflare account.
- **Cross-platform** — Windows, macOS, Linux (cloudflared binary auto-selected per platform)
- **PWA installable** — "Add to Home Screen" on mobile gives you a full-screen app icon

---

## Requirements

- VS Code **1.120+**
- Shell Integration enabled in your terminal (default in VS Code's built-in terminals)
- Internet connection for the cloudflared tunnel (or `mtb.tunnel: none` for LAN-only)

---

## Getting Started

1. Install the extension
2. Open Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`) → **MTB: Start Server**
3. Enter a pairing password when prompted (saved to settings, not asked again)
4. Scan the QR code that appears in the **Mobile Terminal Bridge** Output panel
5. Enter the same password in the PWA pairing form → connected

To see the QR again: **MTB: Show QR Code**

To stop: **MTB: Stop Server**

---

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `mtb.password` | `""` | Pairing password — enter this on your phone to connect |
| `mtb.port` | `47800` | Local HTTP server port |
| `mtb.tunnel` | `"temp"` | `temp` = random URL (no account), `named` = fixed URL (Cloudflare account), `none` = LAN only |
| `mtb.tunnelName` | `""` | cloudflared tunnel name (`named` mode only) |
| `mtb.tunnelUrl` | `""` | Fixed URL (`named` mode only, e.g. `https://my.example.com`) |

---

## How It Works

```
VS Code Extension
  ├─ Terminal output  →  WebSocket  →  xterm.js (phone)
  ├─ Active editor    →  WebSocket  →  highlight.js (phone)
  └─ HTTP server :47800
        └─ cloudflared tunnel → https://xxx.trycloudflare.com ← phone browser
```

The extension runs a local HTTP + WebSocket server. cloudflared creates a secure HTTPS tunnel so your phone can reach it from anywhere (LTE, different WiFi, etc.) without port forwarding or VPN setup.

---

## Known Limitations

- **Terminal streaming requires Shell Integration** — output is streamed per-command execution. Idle prompt state is not streamed (VS Code's public API limitation).
- **Temp tunnel URL changes on restart** — re-scan the QR or bookmark `/qr.html` on an already-connected device to pair new ones.
- **Code view is read-only** — editing from the phone is not supported in this version.
- **Large files** — files over 512 KB are truncated in the code view.

---

## Feedback & Issues

[github.com/mtb/mobile-term-bridge](https://github.com/mtb/mobile-term-bridge/issues)
