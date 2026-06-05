# 📸 GitHub Media Assets Guide (Screenshots & GIFs)

To make your repository look extremely premium and get more stars, having high-quality screenshots and GIFs is essential. This guide explains what to capture, where to save the files, and which tools to use.

---

## 📁 Recommended File Structure
All media assets should be placed in the `docs/images/` directory so they are tracked by Git and load correctly on GitHub:
- `docs/images/desktop_app.png` - Electron Settings and Tray Window
- `docs/images/mobile_app.png` - Expo Android App active session preview
- `docs/images/qr_pairing.gif` - GIF showing pairing with QR Code

---

## 🎯 What to Capture

### 1. Electron Desktop Window (`desktop_app.png`)
- **How to capture**: Launch the desktop app from the tray. Take a clean screenshot of the cream/coral themed Settings window.
- **Recommended Tool**: Press `Win + Shift + S` on Windows to crop just the Electron window.

### 2. Expo Mobile App Terminal (`mobile_app.png`)
- **How to capture**: Open the companion app on your phone, connect to your PC, open a terminal session, and take a screenshot showing the active session bar and the coral accent lines.
- **Recommended Tool**: Take a standard screenshot on your Android phone (usually `Power + Volume Down`).

### 3. QR Code Pairing Flow (`qr_pairing.gif`)
- **How to capture**: Record a quick 5-10 second clip of yourself scanning the QR code from the mobile app to connect to the PC and load the active session.
- **Recommended Windows Tool**: [ScreenToGif](https://www.screentogif.com/) (Free, open-source, highly recommended for Windows).
- **Recommended Mobile Tool**: Android's built-in Screen Recorder (swipe down from the top menu, record, and convert the video to GIF).

---

## 🚀 How to Add Them to Git

Once you have captured the screenshots and saved them to `docs/images/`, run these Git commands to commit them:

```bash
# 1. Add the new image files
git add docs/images/

# 2. Commit the changes
git commit -m "docs: add screenshots and pairing workflow gif"

# 3. Push to GitHub
git push origin main
```

Your GitHub README will automatically detect the files and render them beautifully!
