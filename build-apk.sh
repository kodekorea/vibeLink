#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "${ROOT}/mobile"

echo "============================================"
echo "  Building VibeLink Android APK"
echo "============================================"

if ! command -v node >/dev/null 2>&1; then
  echo "[FAIL] Node.js is required."
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "Installing mobile dependencies..."
  npm install
fi

if ! command -v java >/dev/null 2>&1; then
  echo "[FAIL] JDK 17 is required. Install Android Studio or Temurin 17, then retry."
  exit 1
fi

JAVA_VERSION="$(java -version 2>&1 | awk -F '"' '/version/ {print $2; exit}')"
JAVA_MAJOR="${JAVA_VERSION%%.*}"
if [ "${JAVA_MAJOR}" = "1" ]; then
  JAVA_MAJOR="$(printf '%s' "${JAVA_VERSION}" | awk -F. '{print $2}')"
fi
if [ "${JAVA_MAJOR}" != "17" ]; then
  echo "[FAIL] JDK 17 is required for this Android build."
  echo "       Current Java version: ${JAVA_VERSION:-unknown}"
  echo "       Set JAVA_HOME to a JDK 17 install, then retry."
  exit 1
fi

if [ -z "${ANDROID_HOME:-}" ] && [ -d "${HOME}/Library/Android/sdk" ]; then
  export ANDROID_HOME="${HOME}/Library/Android/sdk"
fi

if [ -z "${ANDROID_HOME:-}" ] && [ -d "${HOME}/Android/Sdk" ]; then
  export ANDROID_HOME="${HOME}/Android/Sdk"
fi

if [ -z "${ANDROID_HOME:-}" ] || [ ! -d "${ANDROID_HOME}" ]; then
  echo "[FAIL] ANDROID_HOME is not set and no default Android SDK was found."
  echo "       Expected macOS default: ${HOME}/Library/Android/sdk"
  exit 1
fi

export ANDROID_SDK_ROOT="${ANDROID_SDK_ROOT:-${ANDROID_HOME}}"
export PATH="${ANDROID_HOME}/platform-tools:${ANDROID_HOME}/cmdline-tools/latest/bin:${PATH}"

if [ ! -d android ]; then
  echo "Prebuilding Android project..."
  npx expo prebuild -p android
fi

if [ ! -x android/gradlew ]; then
  chmod +x android/gradlew
fi

echo "Running Gradle assembleRelease..."
(cd android && ./gradlew assembleRelease)

APK="${ROOT}/mobile/android/app/build/outputs/apk/release/app-release.apk"
echo
if [ -f "${APK}" ]; then
  echo "[OK] Done. APK at:"
  echo "  ${APK}"
else
  echo "[FAIL] Gradle finished but APK was not found at:"
  echo "  ${APK}"
  exit 1
fi
