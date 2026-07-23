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
- 录后编辑器：`save_recording_draft` / `get_editor_draft_path` / `read_recording_file` / `delete_recording_draft` / `save_recording_meta` / `read_recording_meta` / `open_editor_window`

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

### 录制元数据契约（RecordingMeta）
- auto-zoom **不再实时烧录**进视频。录制 canvas 只画 region 的 base crop；鼠标轨迹在录制期间采集，停止后随 `save_recording_meta` 落盘为 sidecar。
- Sidecar 路径：与 draft 同目录同 basename，扩展名 `.json`（`draft-<id>.mp4` + `draft-<id>.json`），由 `recording::store::meta_sidecar_path` 计算（纯函数 + 单测）。`delete_recording_draft` 会一并删 sidecar；24h GC 按 mtime 自动清扫。
- `RecordingMeta` 字段（`src/types/app.ts`）：`captureWidth/Height`（getDisplayMedia 报告的分辨率）、`crop`（base crop，**帧内容像素空间**）、`dpr`、`region`、`cursor`（`CursorSample[]`，`t` 为相对 `recorder.start()` 的 `performance.now()` 毫秒，x/y 为全局物理像素）、`contentScale`（可选，缺省=1：全局物理 px → 帧内容 px 的比例；macOS WKWebView 可能把 1x 内容渲染进物理尺寸的帧（右/下黑边），由 `src/lib/contentScale.ts` 的 `detectContentScale` 在录制开始时探测真实像素得出）。
- 坐标空间换算：回放时轨迹先乘 `contentScale` 再用 `localizeTrail(trail, cropOrigin, scale)` 转到 draft-local（draft 视频已是 crop 子画面），再以 base `{0,0,videoW,videoH}` 喂 `computeZoomWindow`。轨迹、坐标换算统一走 `src/lib/exportVideo.ts`（`sampleCursor` / `isZoomActive` / `computeZoomWindow` / `localizeTrail`）。
- 向后兼容：旧 draft 无 sidecar，`read_recording_meta` 返回 `null`，编辑器降级为无 zoom 预览、导出仍可用。

### 录制子系统模块归属
- 流水线状态/逻辑 → `src/hooks/useRecordingPipeline.ts`（`RecordingControlWindow` 只做视图）
- 持久化（目录/命名/写盘）→ `src-tauri/src/recording/store.rs`（纯函数 + 单测）
- 自动缩放（auto zoom）数学 → `src/lib/coords.ts`（`computeZoomedCrop` / `smoothCrop`）+ `src/lib/exportVideo.ts`（`sampleCursor` / `isZoomActive` / `computeZoomWindow` / `localizeTrail`）。**帧间动画状态已从 RecordingPipeline 移除**：录制只采轨迹，预览（`EditorWindow`）与导出（`renderExport`）各自维护 smoothState 回放。
- mouse tracking 门控：录制激活即开（无论 cursor overlay / auto-zoom 设置），停止即关。`recordingAutoZoom` / `recordingZoomFactor` 语义改为「编辑器/导出默认值」，不再影响录制本身。
- 透明 overlay 窗口创建 → `build_overlay_window(app, OverlayWindowSpec)`，四窗口（recording/keyboard/region-select/cursor-overlay）共用，禁止再手写 `WebviewWindowBuilder` 样板
- 录后编辑器（editor 窗口）→ 录制停止后 pipeline 先 `save_recording_draft` + `save_recording_meta` 落草稿与 sidecar（temp dir），再 `open_editor_window`；剪辑 UI 在 `src/windows/EditorWindow.tsx`（canvas 预览 + zoom 回放），导出重编码在 `src/lib/exportVideo.ts`（canvas 重采样 + MediaRecorder，支持裁剪/zoom 回放/分辨率/容器选择）。editor 是普通带边框窗口，不走 `build_overlay_window`

## UI/UX 约定
- 视觉统一走 phosphor 终端风（荧光绿 accent + 小圆角 + 1px 边框 + font-mono 数据标签），不设并行风格。
- 设置页面使用 shadcn 风格组件 + GSAP 轻量动效。
- 摄像头主窗保持无边框透明，禁止出现明显方形底框。

### 主题契约（dark/light）
- Token 单一真相源：`src/styles.css` 顶部 —— 暗色 token 在 `:root`，亮色覆盖在 `[data-theme="light"]`（bg/surface/fg/muted/border/accent/danger 等成对语义色 + radius/font/transition）。**禁止在组件/样式里硬编码颜色**（hex/rgba），一律 `var(--*)`；唯一例外是语义明确的固定色（如透明 overlay 的遮罩）。
- 主题机制：`AppSettings.theme: "system" | "light" | "dark"`（Rust/TS 双侧，serde 默认值 `system`），设置页可切换并随 `app://settings-updated` 广播；所有窗口由 `src/lib/theme.ts` 的 `initTheme()` 在入口接线（7 个 `*-main.tsx` 均已调用），`system` 时跟随 `prefers-color-scheme`。
- 透明 overlay 窗口（main/keyboard/recording/region/cursor）保持 `background: transparent`，token 只作用于其上的浮条/徽章；不透明窗口（settings/editor）由各自根类盖上 `var(--bg)` + 网格背景。
- 字体：Outfit（正文/标题）+ Share Tech Mono（数据/标签），本地打包在 `src/assets/fonts/`，经 `@font-face` 引入，不走 CDN。
- 编辑器播放组件统一走 `src/components/editor/PlaybackBar.tsx`（播放/暂停 + seek + 时间），新增播放类 UI 复用它。

## 测试与验证约定
提交前至少通过：
```bash
bun run build
(cd src-tauri && cargo check)
```

## 文档约定
- 任何破坏性接口修改必须同步更新 `README.md` 与 `CLAUDE.md`。
- 新增快捷键、事件、窗口行为时，必须补充到文档。
