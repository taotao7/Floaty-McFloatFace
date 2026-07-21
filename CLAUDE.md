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
- `keyboard` 窗口：透明置顶按键展示浮窗
- `recording` 窗口：屏幕录制浮动控制条（Record/Stop/Pause/Region）
- `region-select` 窗口：全屏透明区域框选 overlay
- `cursor-overlay` 窗口：全屏透明 + click-through，录制时渲染鼠标点击涟漪/拖尾
- Tauri 托盘菜单：显示/隐藏主窗、打开设置、锁定拖拽、显示/隐藏按键、开始/停止录制、退出

## Rust 命令接口（src-tauri/src/lib.rs）

- `list_cameras() -> Vec<CameraDevice>`
- `get_app_settings() -> AppSettings`
- `save_app_settings(payload: AppSettings) -> Result<(), String>`
- `apply_window_shape(payload: ShapePreset) -> Result<(), String>`
- `set_always_on_top(enabled: bool) -> Result<(), String>`
- `set_click_through(enabled: bool) -> Result<(), String>`
- `toggle_main_window_visibility() -> Result<(), String>`
- `open_settings_window() -> Result<(), String>`
- `start_drag_main_window() -> Result<(), String>`
- `toggle_keyboard_window(enabled: bool) -> Result<(), String>`
- `open_camera_privacy_settings()`
- 屏幕录制相关：
  - `toggle_recording_window(enabled: bool) -> Result<(), String>`
  - `start_region_select() -> Result<(), String>`（emit `app://region-started`）
  - `confirm_region(region: RecordingRegion) -> Result<(), String>`
  - `cancel_region_select() -> Result<(), String>`
  - `reset_recording_region() -> Result<(), String>`
  - `set_cursor_overlay(enabled: bool) -> Result<(), String>`
  - `set_mouse_tracking_enabled(enabled: bool)`（门控鼠标坐标 emit）
  - `get_recording_region() -> Option<RecordingRegion>`
  - `get_recording_state() -> bool`（读 `AppState.recording_active`，单一真相源）
  - `save_recording(bytes: Vec<u8>, suggested_name: String) -> Result<Option<String>, String>`

## 应用状态（AppState）

`AppState { recording_active: AtomicBool }` 通过 `.manage()` 注入，是「是否在录制」的单一真相源（前端、托盘、settings 都查它，不再各自追踪本地 state）。当前是仓库唯一的 managed state。

## 事件常量与坐标模块

- 事件名单一真相源：`src/lib/events.ts`（`EVT` + payload 类型）/ `src-tauri/src/events.rs`（`evt::`）。禁止再写 `app://` 字符串字面量。
- 坐标换算单一真相源：`src/lib/coords.ts`（`cssToPhysical` / `physicalToCss` / `computeCropRect` / `validateCaptureAssumption`）。三窗口共用，crop 数学有单测，捕获假设不满足时会 emit `app://camera-error` 提示而非静默错位。

## 录制子系统模块

- `src/hooks/useRecordingPipeline.ts` — 录制流水线（capture→crop→encode→save）+ 所有长生命周期状态。`RecordingControlWindow` 只是它的视图。
- `src-tauri/src/recording/store.rs` — 持久化深模块（`resolve_output_dir` / `make_filename` / `write_recording`），纯函数 + 单测。输出目录由 `AppSettings.recording_output_dir` 配置（Settings 有目录选择器）。

## 前后端事件约定

- `app://settings-updated`：设置保存后广播
- `app://hotkey-triggered`：托盘/快捷键动作事件（action: `toggle_visibility` / `open_settings` / `toggle_lock` / `toggle_recording`）
- `app://camera-error`：摄像头权限/占用/断连错误
- `app://accessibility-status`：辅助功能权限状态 `{ granted: bool }`
- `app://event-tap-status`：键盘事件监听状态 `{ active: bool }`（输入监控权限相关）
- `app://key-pressed` / `app://key-released`：按键事件 `{ key, modifiers, timestamp }`
- 屏幕录制相关：
  - `app://mouse-down` / `app://mouse-up`：鼠标点击 `{ x, y, button, timestamp }`（物理屏幕像素，仅录制激活时 emit）
  - `app://mouse-move`：鼠标移动（同上）
  - `app://recording-status`：录制状态广播 `{ active: bool }`
  - `app://region-started`：区域选择窗口已打开
  - `app://region-selected`：区域已确认 `{ x, y, width, height }` 或 `null`（重置为全屏）
  - `app://region-canceled`：区域选择已取消

## 快捷键（默认）

- `Cmd/Ctrl + Shift + V`：显示/隐藏主窗口
- `Cmd/Ctrl + Shift + L`：锁定/解锁拖拽
- `Cmd/Ctrl + Shift + ,`：打开设置窗口
- `Cmd/Ctrl + Shift + R`：开始/停止录制（录制控制条需可见）

## 摄像头策略

- 前端 `getUserMedia` 采集
- 自适应质量降级：1080p -> 720p -> 480p（30fps 优先）
- 监听 `devicechange` 处理热插拔与自动恢复

## 屏幕录制策略

- 混合捕获：前端 `getDisplayMedia` 抓画面 + Rust `CGEventTap` 上报全局鼠标坐标（物理像素；`CGEventGetLocation` 返回的是 points，tap 内按主屏 scale factor 换算后再 emit）
- 开始录制前有 3 秒倒计时（pipeline 的 `countdown` 状态，录制条大字覆盖层显示；倒计时中停止 = 取消，不产文件）
- 鼠标 tap 复用键盘功能的同一个 `CGEventTap`（`src-tauri/src/keyboard/macos.rs`），零新权限；通过 `MOUSE_TRACKING_ENABLED` 原子门控，非录制时不 emit
- 区域锁定：`recording` 窗口用隐藏 canvas 对 `getDisplayMedia` 流做 `drawImage` crop，再 `captureStream` 喂给 `MediaRecorder`（MP4/H.264 优先，WebM/VP9 兜底；`pickMimeType` 探测，`extensionForMime` 决定落盘扩展名）。crop 数学在 `src/lib/coords.ts` 的 `computeCropRect`；启动时 `validateCaptureAssumption` 校验捕获帧是否匹配主屏物理尺寸，不匹配（多屏/窗口/tab 捕获）会 emit `app://camera-error` 提示。
- 光标特效：独立 click-through overlay 窗口，仅录制时显示；坐标换算走 `src/lib/coords.ts` 的 `physicalToCss`。
- 自动缩放（auto zoom）：开启后录制画面跟随鼠标放大（`recordingAutoZoom` + `recordingZoomFactor` 设置项）。crop 循环每帧用 `coords.ts` 的 `computeZoomedCrop`（围绕光标的放大窗口，钳制在基准 crop 内）+ `smoothCrop`（帧间插值）计算动态 crop；鼠标活动后 `ZOOM_HOLD_MS` 内保持放大，之后平滑缩回。输出 canvas 尺寸固定为基准 crop，`drawImage` 完成放大。光标 overlay 关闭时由 pipeline 自行用 `set_mouse_tracking_enabled` 门控鼠标事件。
- 输出：录制停止后先经 `save_recording_draft` 把原始片段写入 temp dir（`floaty-drafts/`，>24h 自动清理），随即打开 editor 窗口做录后微调（裁剪 / 分辨率 / MP4 或 WebM 容器），导出走 `src/lib/exportVideo.ts` 的 `renderExport`（隐藏 video → canvas 重采样 → MediaRecorder 实时重编码，音频经 WebAudio 静默混入），最后经 `save_recording`（`tauri-plugin-dialog` 保存对话框）落盘。默认目录由 `recording::store::resolve_output_dir` 解析（优先 `AppSettings.recording_output_dir`，否则 `~/Movies/Floaty` / 非 macOS `~/Videos/Floaty`）；命名由 `recording::store::make_filename` 生成。字节经 invoke 直传 `Uint8Array` → Rust `Vec<u8>`（不要 `Array.from`，会 JSON 化导致内存爆炸）；editor 读草稿用 `read_recording_file` 的 raw binary response。
- macOS 优先：Windows/Linux 的鼠标 tap 为打桩实现，文档标注 planned

## 开发命令

```bash
bun install
bun run tauri dev
bun run tauri build
bun run test          # vitest（前端纯函数：coords / pickMimeType / store 等）
(cd src-tauri && cargo test)   # Rust 单测（recording::store）
```

## 注意事项

- Linux 在部分窗口管理器下，透明窗/穿透行为可能不一致。
- macOS 键盘展示功能需要辅助功能 + 输入监控两项权限。从 Finder 启动时 app 自身需要输入监控权限，从终端运行二进制则继承终端的权限。`CGEventTapCreate` 失败时会重试并通过 `app://event-tap-status` 通知前端。
