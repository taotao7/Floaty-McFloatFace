# AGENTS.md

## 目标
为 Floaty McFloatFace 提供一致、可维护的实现与协作约定。

## 代码协作约定
- 优先保证可维护性与可读性，避免一次性脚本式实现。
- 不要破坏 Rust 命令接口与前后端事件命名。
- 新增功能时优先保持 `main`（摄像头）与 `settings`（配置）职责分离。
- 任何新增交互都应兼顾三端（macOS / Windows / Linux）差异。

## 必须保持的公共契约
### 类型契约（src/types/app.ts）
- `ShapePreset = "circle" | "roundedSquare" | "mickey"`
- `AppSettings` 与 `RuntimeState` 字段语义保持兼容

### 命令契约（src-tauri/src/lib.rs）
- `list_cameras`
- `get_app_settings`
- `save_app_settings`
- `apply_window_shape`
- `set_always_on_top`
- `set_click_through`
- `toggle_main_window_visibility`
- `open_settings_window`

### 事件契约
- `app://settings-updated`
- `app://hotkey-triggered`
- `app://camera-error`

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
