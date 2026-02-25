# Floaty McFloatFace

桌面摄像头浮窗工具，面向录屏/直播场景。提供透明异形摄像头窗口、美颜滤镜和按键展示浮窗。

[English](../README.md)

## 功能

- **摄像头浮窗** — 透明无边框、始终置顶的摄像头窗口
- **形状模板** — 圆形、圆角方形、米奇
- **美颜滤镜** — 磨皮柔肤、亮度调节
- **按键展示** — 在屏幕上展示按下的键，松开后延迟淡出，适合教程和直播演示
- **自由拖拽** — 摄像头和按键窗口均可拖拽，位置自动记忆
- **右键菜单** — 快速访问设置、锁定、镜像、按键展示开关
- **系统托盘** — 显示/隐藏摄像头、切换按键展示、打开设置、锁定拖拽、退出
- **全局快捷键**
  - `Cmd/Ctrl + Shift + V` — 显示/隐藏摄像头
  - `Cmd/Ctrl + Shift + L` — 锁定/解锁拖拽
  - `Cmd/Ctrl + Shift + ,` — 打开设置
- **设置窗口** — 摄像头选择、形状、缩放、镜像、美颜、按键展示（消失延迟、宽度）
- **国际化** — 中文和 English
- **跨平台** — macOS、Linux、Windows

## 安装

### Homebrew (macOS)

```bash
brew tap taotao7/tap
brew install --cask floaty-mcfloatface
```

### 下载

前往 [GitHub Releases](https://github.com/taotao7/Floaty-McFloatFace/releases) 下载最新版本。

### macOS 注意事项

应用未经 Apple 代码签名，macOS Gatekeeper 可能会阻止打开。安装后运行：

```bash
xattr -cr "/Applications/Floaty McFloatFace.app"
```

应用需要以下权限：
- **摄像头权限** — 首次启动时会弹窗请求
- **辅助功能权限** — 按键展示功能需要（系统设置 → 隐私与安全性 → 辅助功能）

## 开发

```bash
bun install
bun run tauri dev
```

## 构建

```bash
bun run tauri build
```

## 版本发布

```bash
./scripts/bump.sh 0.3.0
git add -A && git commit -m "chore: bump version to 0.3.0"
git tag v0.3.0
git push origin main --tags
```

## 技术栈

- Tauri v2 + Rust
- React + TypeScript + Vite
- Tailwind CSS + Radix UI
- GSAP 动画

## 已知限制

- Linux 在部分窗口管理器下，透明窗口/点击穿透表现可能不一致
- `list_cameras` Rust 命令为预留接口，摄像头枚举由前端 `MediaDevices` API 完成
- macOS 按键展示功能需要辅助功能权限
- 按键展示目前仅支持 macOS（使用 CoreGraphics 事件监听），Linux 和 Windows 支持计划中

## 贡献

- 提交前请运行 `bun run build` 和 `cargo check`（在 `src-tauri` 目录）
- 修改公共接口（命令/事件/类型）时请同步更新文档

## 许可

MIT
