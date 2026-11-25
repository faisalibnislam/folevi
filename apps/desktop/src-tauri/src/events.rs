//! Events the native side sends the page: shell-bridge.js's `listen(event, cb)` hears "libraryChanges",
//! "aiChunk", "placesChanged" and "cloudStatus" (lib.rs turns them into Tauri events named "shell:<event>").
use serde_json::Value;
use std::sync::Arc;

/// Sends `payload` as shell event `event` to every Folevi page.
pub type Emit = Arc<dyn Fn(&str, Value) + Send + Sync>;

/// An Emit that drops everything (tests).
pub fn nowhere() -> Emit {
    Arc::new(|_, _| {})
}
