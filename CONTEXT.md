# CONTEXT.md — Domain Glossary

Domain vocabulary for Floaty McFloatFace. These names anchor the architecture
reviews (`/improve-codebase-architecture`) and should be reused verbatim in
discussions and code instead of ad-hoc synonyms. Keep this file current as the
model evolves.

## Core concepts

- **CameraOverlay** — The borderless, transparent, always-on-top camera
  window (`main`). The app's original purpose.
- **KeyboardDisplay** — The transparent overlay showing pressed keys
  (`keyboard` window), fed by the macOS event tap.
- **ScreenRecording** — The screen-capture subsystem. A *hybrid* capture:
  the frontend's `getDisplayMedia` produces frames; the Rust event tap
  reports global cursor coordinates. Do not call it "the recorder" — name
  the piece (pipeline, store, region).

## Recording subsystem modules

- **RecordingPipeline** — The object (a React hook, `useRecordingPipeline`)
  that owns the capture → crop → encode → save lifecycle and all its
  long-lived state (stream, recorder, canvas, chunks). Previously inlined
  in `RecordingControlWindow`; now the window is just its view.
- **RecordingStore** — The Rust persistence layer (`recording/store.rs`):
  resolves the output directory, builds the filename, writes bytes. Pure
  functions, unit-tested.
- **RecordingRegion** — A rectangle in *physical screen pixels* describing
  the crop. Stored under its own store key (`RECORDING_REGION_KEY`), **not**
  inside `AppSettings` — see the `RecordingRegion` contract note in
  `AGENTS.md`. Accessed via `get_recording_region` / `confirm_region` /
  `reset_recording_region`.
- **CursorOverlay** — The full-screen, click-through window that renders
  click ripples and a move trail during recording (`cursor-overlay`).
  Reused event tap provides coordinates; it owns no input.
- **AutoZoom** — Optional recording mode (`recordingAutoZoom` /
  `recordingZoomFactor` settings): the crop loop magnifies around the
  cursor on mouse activity and settles back to the base crop after a dwell.
  Math lives in `src/lib/coords.ts` (`computeZoomedCrop` + `smoothCrop`);
  the animated state lives in the RecordingPipeline.
- **RecordingEditor** — The post-capture window (`editor`) for trim/export.
  On stop, the RecordingPipeline writes the raw clip to a temp-dir draft
  (`save_recording_draft`) and opens the editor; `src/lib/exportVideo.ts`
  re-encodes (trim range, optional downscale, container choice) by playing
  the draft through a canvas into a MediaRecorder. Export is real-time
  (1× playback) in v1.
- **RegionSelectWindow** — The full-screen overlay the user draws a crop
  rectangle on (`region-select`).

## Coordinate spaces

- **physical** — Global screen coordinates in physical pixels. The space
  `RecordingRegion` lives in and the space mouse events are emitted in —
  the Rust tap converts `CGEventGetLocation`'s display *points* to
  physical pixels via the primary monitor's scale factor before emitting.
- **css** — Browser layout pixels inside an overlay window. Conversions live
  in `src/lib/coords.ts`; never hand-roll them.

## Cross-cutting

- **AppState** — The single source of truth for application-wide runtime
  state, registered via `.manage()`. Currently holds `recording_active`
  (queryable from any window via `get_recording_state`).
- **OverlayWindow** — Any of the four transparent borderless always-on-top
  windows (recording / keyboard / region-select / cursor). All built by the
  shared `build_overlay_window` factory + `OverlayWindowSpec`.

## Events

See `src/lib/events.ts` (`EVT`) and `src-tauri/src/events.rs` (`evt`) for the
single source of truth on `app://` event names and payload shapes.
