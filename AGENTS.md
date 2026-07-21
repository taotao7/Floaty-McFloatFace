# AGENTS.md

## 目标
为 Floaty McFloatFace 提供一致、可维护的实现与协作约定。

## 代码协作约定
- 优先保证可维护性与可读性，避免一次性脚本式实现。
- 不要破坏 Rust 命令接口与前后端事件命名。
- 新增功能时优先保持窗口职责分离：`main`（摄像头）/ `settings`（配置）/ `keyboard`（按键展示）/ `recording`（录制控制）/ `region-select`（区域框选）/ `cursor-overlay`（鼠标特效）/ `editor`（录后剪辑导出）。
- 任何新增交互都应兼顾三端（macOS / Windows / Linux）差异。

## 必须保持的公共契约
### 类型契约（src/types/app.ts）
- `ShapePreset = "circle" | "roundedSquare" | "mickey"`
- `KeyboardDisplayStyle = "dark" | "light" | "glass" | "outline"`
- `CursorEffectStyle = "ripple" | "ring" | "spark" | "none"`
- `RecordingRegion { x, y, width, height }`（物理屏幕像素，**走独立 store key，不在 `AppSettings` 内** —— 见「录制区域契约」）
- `AppSettings` 与 `RuntimeState` 字段语义保持兼容

### 命令契约（src-tauri/src/lib.rs）
- `list_cameras`
- `get_app_settings` / `save_app_settings`
- `apply_window_shape`
- `set_always_on_top`
- `set_click_through`
- `toggle_main_window_visibility`
- `open_settings_window`
- `start_drag_main_window`
- `toggle_keyboard_window`
- `open_camera_privacy_settings`
- 屏幕录制：`toggle_recording_window` / `start_region_select` / `confirm_region` / `cancel_region_select` / `reset_recording_region` / `set_cursor_overlay` / `set_mouse_tracking_enabled` / `get_recording_region` / `save_recording`
- 录后编辑器：`save_recording_draft` / `get_editor_draft_path` / `read_recording_file` / `delete_recording_draft` / `open_editor_window`

### 事件契约
- `app://settings-updated`
- `app://hotkey-triggered`
- `app://camera-error`
- `app://accessibility-status` / `app://event-tap-status`
- `app://key-pressed` / `app://key-released`
- 屏幕录制：`app://mouse-down` / `app://mouse-up` / `app://mouse-move` / `app://recording-status` / `app://region-started` / `app://region-selected` / `app://region-canceled`

### 事件/坐标单一真相源
- 事件名：禁止再写 `app://` 字符串字面量。统一从 `src/lib/events.ts`（前端 `EVT` + payload 类型）与 `src-tauri/src/events.rs`（Rust `evt::`）取。
- 坐标换算：禁止再手写 CSS↔物理像素换算。统一从 `src/lib/coords.ts`（`cssToPhysical` / `physicalToCss` / `computeCropRect` / `validateCaptureAssumption`）取。
- 录制真相源：`AppState.recording_active`（Rust `.manage()` 注入），前端/托盘/settings 查 `get_recording_state`，不再各自追踪本地 state。

### 录制区域契约（RecordingRegion）
- `RecordingRegion` **不**是 `AppSettings` 的字段。它存在独立的 store key `RECORDING_REGION_KEY`，通过 `get_recording_region` / `confirm_region` / `reset_recording_region` 读写。
- 拆分动机：避免录制中改写整个 settings blob。TS 类型 `AppSettings` 故意不含 `recordingRegion` 字段（历史上的假字段已删除）。

### 录制子系统模块归属
- 流水线状态/逻辑 → `src/hooks/useRecordingPipeline.ts`（`RecordingControlWindow` 只做视图）
- 持久化（目录/命名/写盘）→ `src-tauri/src/recording/store.rs`（纯函数 + 单测）
- 自动缩放（auto zoom）数学 → `src/lib/coords.ts`（`computeZoomedCrop` / `smoothCrop`），帧间动画状态在 RecordingPipeline 内；光标 overlay 关闭时由 pipeline 自行门控 `set_mouse_tracking_enabled`
- 透明 overlay 窗口创建 → `build_overlay_window(app, OverlayWindowSpec)`，四窗口（recording/keyboard/region-select/cursor-overlay）共用，禁止再手写 `WebviewWindowBuilder` 样板
- 录后编辑器（editor 窗口）→ 录制停止后 pipeline 先 `save_recording_draft` 落草稿（temp dir），再 `open_editor_window`；剪辑 UI 在 `src/windows/EditorWindow.tsx`，导出重编码在 `src/lib/exportVideo.ts`（canvas 重采样 + MediaRecorder，支持裁剪/分辨率/容器选择）。editor 是普通带边框窗口，不走 `build_overlay_window`

## UI/UX 约定
- 保持“卡通工具化”视觉方向，不回退到默认模板风格。
- 设置页面使用 shadcn 风格组件 + GSAP 轻量动效。
- 摄像头主窗保持无边框透明，禁止出现明显方形底框。

## 测试与验证约定
提交前至少通过：
```bash
bun run build
(cd src-tauri && cargo check)
```

## 文档约定
- 任何破坏性接口修改必须同步更新 `README.md` 与 `CLAUDE.md`。
- 新增快捷键、事件、窗口行为时，必须补充到文档。
