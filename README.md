# Floaty McFloatFace

Floaty McFloatFace 是一个桌面摄像头浮窗工具，面向录屏/直播场景，提供透明异形摄像头窗口与独立设置窗口。

## 开源声明

这是一个**开源项目**，欢迎社区参与改进与贡献（Issue / PR / 讨论）。

## 技术栈

- Bun + React + TypeScript + Vite
- Tauri v2 + Rust
- shadcn 风格组件（Radix + CVA）
- GSAP 动画

## 已实现功能

- 多窗口架构：`main` 摄像头窗 + `settings` 设置窗
- 透明无边框摄像头窗，默认置顶、可拖拽
- 异形窗口模板：`Circle`、`Rounded Square`、`Mickey`
- 摄像头选择与自动自适应质量（1080p -> 720p -> 480p）
- 托盘菜单：显示/隐藏、打开设置、锁定拖拽、退出
- 全局快捷键：
  - `Cmd/Ctrl + Shift + V`：显示/隐藏主窗
  - `Cmd/Ctrl + Shift + L`：锁定/解锁拖拽
  - `Cmd/Ctrl + Shift + ,`：打开设置窗
- 设置持久化（Tauri Store）
- 前后端事件：
  - `app://settings-updated`
  - `app://hotkey-triggered`
  - `app://camera-error`

## 开发与运行

```bash
bun install
bun run tauri dev
```

## 构建

```bash
bun run tauri build
```

## 贡献建议

- 提交前请至少运行：`bun run build` 与 `cargo check`（在 `src-tauri` 目录）
- 若修改公共接口（命令/事件/类型），请同步更新文档

## 已知限制

- Linux 在部分窗口管理器下，透明窗口/点击穿透表现可能不一致。
- `list_cameras` Rust 命令已预留接口，当前实际摄像头枚举由前端 `MediaDevices` 执行。
- 首版不包含虚拟摄像头输出、不包含用户自定义快捷键。
