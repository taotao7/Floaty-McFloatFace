#!/usr/bin/env bash
# Re-sign the .app with a fixed bundle identifier so macOS Accessibility
# permission survives across builds (adhoc signing appends a random hash).
set -euo pipefail

APP="src-tauri/target/release/bundle/macos/Floaty McFloatFace.app"

if [ -d "$APP" ]; then
  codesign --force --sign - --identifier "com.tao.floaty-mcfloatface" "$APP"
  echo "Re-signed with fixed identifier: com.tao.floaty-mcfloatface"
fi
