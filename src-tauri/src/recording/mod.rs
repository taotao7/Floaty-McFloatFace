//! Screen recording subsystem.
//!
//! Currently a thin umbrella over [`store`] (the persistence layer). Mouse
//! tracking lives in the shared keyboard event tap (`crate::keyboard`); the
//! orchestration pipeline lives in the frontend (`useRecordingPipeline`).
//! This module is the Rust-side home for anything recording-related that is
//! neither window management nor mouse capture.

pub mod store;
