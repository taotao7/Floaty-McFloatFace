# CLAUDE.md

## 项目定位

Floaty McFloatFace 是一个桌面开源项目，用于在录屏/直播场景中展示摄像头浮窗。

## 技术栈

- Bun
- Rust
- Tauri v2
- React + TypeScript + Vite
- shadcn 风格组件（Radix + CVA）
- GSAP

## 当前架构

- `main` 窗口：透明无边框摄像头浮窗（默认置顶）
- `settings` 窗口：独立设置窗口
- Tauri 托盘菜单：显示/隐藏主窗、打开设置、锁定拖拽、退出

## Rust 命令接口（src-tauri/src/lib.rs）

- `list_cameras() -> Vec<CameraDevice>`
- `get_app_settings() -> AppSettings`
- `save_app_settings(payload: AppSettings) -> Result<(), String>`
- `apply_window_shape(payload: ShapePreset) -> Result<(), String>`
- `set_always_on_top(enabled: bool) -> Result<(), String>`
- `set_click_through(enabled: bool) -> Result<(), String>`
- `toggle_main_window_visibility() -> Result<(), String>`
- `open_settings_window() -> Result<(), String>`

## 前后端事件约定

- `app://settings-updated`：设置保存后广播
- `app://hotkey-triggered`：托盘/快捷键动作事件
- `app://camera-error`：摄像头权限/占用/断连错误

## 快捷键（默认）

- `Cmd/Ctrl + Shift + V`：显示/隐藏主窗口
- `Cmd/Ctrl + Shift + L`：锁定/解锁拖拽
- `Cmd/Ctrl + Shift + ,`：打开设置窗口

## 摄像头策略

- 前端 `getUserMedia` 采集
- 自适应质量降级：1080p -> 720p -> 480p（30fps 优先）
- 监听 `devicechange` 处理热插拔与自动恢复

## 开发命令

```bash
bun install
bun run tauri dev
bun run tauri build
```

## 注意事项

- Linux 在部分窗口管理器下，透明窗/穿透行为可能不一致。
