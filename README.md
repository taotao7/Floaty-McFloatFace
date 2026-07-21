# Floaty McFloatFace

A desktop camera overlay for streaming and screen recording. Show your face in a floating, always-on-top window with customizable shapes, beauty filters, and a keyboard display overlay.

[中文文档](docs/README.zh-CN.md)

<img width="2334" height="1962" alt="image" src="https://github.com/user-attachments/assets/e3264a6c-b9b1-4c61-884e-a58f446562b6" />

## Features

- **Camera Overlay** — Floating, borderless, always-on-top camera window
- **Shape Presets** — Circle, Rounded Square, Mickey
- **Beauty Filter** — Skin smoothing and brightness adjustment
- **Keyboard Display** — Show pressed keys on screen with fade-out animation, perfect for tutorials and live demos
- **Screen Recording** — Capture your screen with a draggable region lock, 3-second countdown, cursor click ripples & trail overlay, cursor-following auto zoom, configurable output directory, and save to MP4 (WebM fallback)
- **Post-Capture Editor** — After each recording, a Screen-Studio-style editor opens: preview, trim the ends, pick export resolution (original/1080p/720p) and container (MP4/WebM), then export via the native save dialog
- **Draggable** — Drag both camera and keyboard windows anywhere, positions are remembered
- **Right-click Menu** — Quick access to settings, lock, mirror, and keyboard toggle
- **System Tray** — Show/hide camera, toggle keyboard, start/stop recording, open settings, lock drag, quit
- **Hotkeys**
  - `Cmd/Ctrl + Shift + V` — Show/Hide camera
  - `Cmd/Ctrl + Shift + L` — Lock/Unlock drag
  - `Cmd/Ctrl + Shift + ,` — Open settings
  - `Cmd/Ctrl + Shift + R` — Start/Stop recording
- **Settings Window** — Camera selection, shape, scale, mirror, beauty, keyboard display (fade delay, width), screen recording (region, output dir, fps, auto zoom, cursor effects)
- **i18n** — English and 中文
- **Cross-platform** — macOS, Linux, Windows

## Install

### Homebrew (macOS)

```bash
brew tap taotao7/tap
brew install --cask floaty-mcfloatface
```

### Download

Grab the latest release from [GitHub Releases](https://github.com/taotao7/Floaty-McFloatFace/releases).

### macOS Notes

Since the app is not code-signed, macOS Gatekeeper may block it. Run this after installing:

```bash
xattr -cr "/Applications/Floaty McFloatFace.app"
```

The app requires:
- **Camera permission** — prompted on first launch
- **Screen Recording permission** — required for screen capture, prompted when you start a recording
- **Accessibility permission** — required for keyboard display and recording cursor tracking (System Settings → Privacy & Security → Accessibility)
- **Input Monitoring permission** — required for keyboard display and recording cursor tracking when launched from Finder (System Settings → Privacy & Security → Input Monitoring)

## Development

```bash
bun install
bun run tauri dev
```

## Build

```bash
bun run tauri build
```

## Version Bump

```bash
./scripts/bump.sh 0.3.0
git add -A && git commit -m "chore: bump version to 0.3.0"
git tag v0.3.0
git push origin main --tags
```

## Tech Stack

- Tauri v2 + Rust
- React + TypeScript + Vite
- Tailwind CSS + Radix UI
- GSAP animations

## Known Limitations

- Transparent window / click-through behavior may vary on some Linux window managers.
- `list_cameras` Rust command is a placeholder; camera enumeration is handled by the frontend `MediaDevices` API.
- macOS requires Accessibility and Input Monitoring permissions for the keyboard display feature. The app will show a hint if either permission is missing.
- Keyboard display currently only works on macOS (uses CoreGraphics event tap). Linux and Windows support is planned.
- Screen recording captures via the browser Screen Capture API (`getDisplayMedia`) and saves MP4 (H.264) where the webview supports it, falling back to WebM. Cursor tracking for the click-ripple/trail overlay currently works on macOS only (reuses the same CoreGraphics event tap); Linux and Windows support is planned.
- The cursor overlay and region selection cover the primary monitor only in this release; multi-monitor capture is planned.

## Contributing

- Run `bun run build` and `cargo check` (in `src-tauri`) before submitting.
- If you modify public interfaces (commands/events/types), please update docs accordingly.

## License

MIT
