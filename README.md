# 🌟 MTB Hub (Mobile Terminal Bridge)

> A premium, high-performance, and secure bridge to mirror, monitor, and control your desktop terminals and workspaces directly from your mobile device.

---

## 🎨 Overview

**MTB Hub** is a single-user companion utility designed for developers who want to stay connected to their development environment while on the move. By bridging a beautiful native Android application (built with Expo) and a desktop tray application (built with Electron), MTB Hub allows you to inspect active ports, switch terminal tabs, run macro sequences, and send keystrokes to your workstation securely over your local network.

The visual interface has been completely redesigned with a warm, premium cream and coral palette (inspired by Anthropic's clean, warm aesthetics), featuring smooth transitions and active blending animations.

<p align="center">
  <img src="docs/images/mobile_app.png" alt="MTB Hub Mobile Companion" width="380" style="margin-right: 20px;" />
  <img src="docs/images/desktop_app.png" alt="MTB Hub Desktop Settings" width="420" />
</p>

---

## ✨ Key Features

- 💻 **Electron Desktop Controller**: A lightweight system tray application that manages the background hub server, configures ports/passwords, and provides clean settings panels.
- 📱 **Native Android Companion (Expo)**: A fast, smooth React Native app equipped with:
  - **Active Session Bar**: A Chrome-style tab interface that tracks and blends with your active session.
  - **Dynamic Port Detection**: Live port detection and status monitoring (active ports indicated with green indicators `●`).
  - **Quick Action Pads**: Dedicated arrow keys, tab controls, and editor-focused macros.
  - **Macro Folder Sequencing**: Group commands into custom sequences and run them with a single tap.
  - **QR Code Pairing**: Instantly connect your mobile app to your desktop server by scanning a local QR code.
- 🔒 **Secure-by-Design**: Single-user authorization using robust, local-first passwords and tokens. Removed all external third-party tunnels (like ngrok) to ensure your data stays private and stays inside your local network.

<p align="center">
  <img src="docs/images/qr_pairing.gif" alt="QR Code Pairing Demonstration" width="500" />
</p>

---

## 🏗️ Architecture

```mermaid
graph TD
    subgraph Mobile App (React Native + Expo)
        A[Session & WebView UI] <--> B[QR Scanner & Storage]
    end

    subgraph Desktop Tray App (Electron)
        C[System Tray & Window UI] --> D[Hub Process Manager]
    end

    subgraph Hub Backend Server (Node.js + TS)
        E[HTTP / WebSocket Server] <--> F[Port Monitoring & CMD Injector]
    end

    A <-->|Secure Local Network WSS / HTTP| E
    D <-->|Spawn / IPC Control| E
```

---

## 📁 Repository Structure

```
mobile_term_bridge_distrib/
├── hub/                  # Node.js + TypeScript Backend Hub Server
│   ├── src/              # Server source files (server.ts, tunnel.ts, etc.)
│   └── pwa/              # Lightweight pairing/QR landing pages
├── desktop/              # Electron Desktop Tray Application & Setup Wizard
│   ├── main.js           # Electron main process
│   └── build/            # Desktop custom app icons
├── mobile/               # React Native + Expo Companion App
│   ├── app/              # Expo Router pages (tabs, preview, etc.)
│   └── components/       # Custom session bars and controls
└── README.md             # This document
```

---

## 🚀 Getting Started

### 1. Desktop App Installation (Windows)

To install MTB Hub on your desktop:
1. Locate the precompiled installer at `desktop/dist/MTB Hub Setup 0.1.0.exe`.
2. Run the installer. You will see a step-by-step setup wizard allowing you to choose your installation directory.
3. The wizard will automatically create a desktop shortcut named **MTB Hub** with the custom warm coral icon.
4. Launch the application. It will run silently in your Windows System Tray and automatically spawn the Hub server.

*To build from source:*
```bash
cd desktop
npm install
npm run dist
```

### 2. Mobile App Setup (Android)

You can run the mobile app using Expo or compile a local APK.

**Option A: Cloud Build (EAS)**
If you don't have Android Studio set up, you can trigger a cloud build to get a direct-install `.apk`:
```bash
cd mobile
npm install -g eas-cli
eas login
eas build --platform android --profile preview
```

**Option B: Local Development Run**
1. Install **JDK 17** and **Android Studio** (on Windows, you can use `winget`):
   ```powershell
   winget install EclipseAdoptium.Temurin.17.JDK
   winget install Google.AndroidStudio
   ```
2. Configure environment variables: Set `ANDROID_HOME` to your Android SDK path, and add `%ANDROID_HOME%\platform-tools` to your `Path`.
3. Connect your Android device via USB (with USB Debugging enabled) and run:
   ```bash
   cd mobile
   npm run android
   ```

---

<details>
<summary><b>🌏 한국어 소개 (Click to expand)</b></summary>

# MTB Hub (Mobile Terminal Bridge)

> 모바일 기기(Android)를 사용하여 사무실이나 개인 작업실 PC의 개발 환경 및 터미널을 실시간 모니터링하고 제어할 수 있는 개발자 전용 1인 도구입니다.

---

## 🎨 개요
**MTB Hub**는 이동 중에도 자신의 개발 환경과 연결을 유지하려는 개발자를 위해 제작된 1인용 유틸리티입니다. 네이티브 안드로이드 앱(Expo 기반)과 데스크톱 트레이 앱(Electron 기반)을 연동하여, 활성화된 포트 감지, 터미널 탭 전환, 매크로 시퀀스 실행, 키스트로크 입력 주입 등을 로컬 네트워크 내에서 보안 비밀번호 기반으로 안전하게 수행할 수 있습니다.

비주얼 인터페이스는 크림색과 코랄색 컬러 팔레트(Anthropic 스타일 테마)로 완성되어, 세련되고 차분한 디자인에 부드러운 전환과 블렌딩 애니메이션이 조화를 이룹니다.

---

## ✨ 주요 기능
- **데스크톱 트레이 앱 (Electron)**: 시스템 트레이에 상주하며 허브 서버를 자동 가동 및 제어하고 설정을 편집합니다.
- **모바일 동반 앱 (Expo)**: 크롬 스타일 세션 탭 바, 터미널 단축키 패드, 매크로 폴더 관리, 편리한 QR 코드 페어링을 제공합니다.
- **로컬 중심 보안**: ngrok 등 외부 서드파티 터널을 완전히 제거하고 오직 로컬 네트워크 내에서 인증 토큰과 고유 비밀번호를 이용해 철저한 단일 사용자 보안을 유지합니다.

---

## ⚙️ 빠른 시작
1. `desktop/dist/MTB Hub Setup 0.1.0.exe` 파일을 실행하여 마법사 단계에 따라 PC에 설치합니다. (바탕화면에 **MTB Hub** 단축아이콘이 자동 생성됩니다.)
2. 트레이 아이콘 우클릭 -> **Open QR page** 또는 설정 화면을 띄워 QR 코드를 확인합니다.
3. 모바일 앱에서 QR 코드를 스캔하여 PC와 페어링한 뒤 터미널 및 열린 포트 상태를 즉시 모니터링합니다.

</details>

---

## 📄 License

This project is licensed under the MIT License. See [LICENSE](LICENSE) for details.
