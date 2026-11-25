//! What every part of the native shell shares: the error a call rejects with, and small helpers for reading a
//! call's options. The page's side is apps/ios/ios/App/Native/Shell/shell-bridge.js (the same file the iPhone,
//! iPad and Mac apps use): `call("FoleviShell", method, options)` resolves with a JSON value or rejects with
//! `{ code, message, data }`.
use serde::Serialize;
use serde_json::Value;

/// A call's failure, as shell-bridge.js reads it: `code` (local-store's error codes: "not_found", "conflict",
/// "invalid_argument", "io", "unavailable", "cancelled", "locked", "wrong_passphrase"...), a sentence for people,
/// and optional `data` (`{ path }` for a file).
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct ShellError {
    pub code: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<Value>,
}

impl ShellError {
    pub fn new(code: &str, message: impl Into<String>) -> Self {
        Self { code: code.to_string(), message: message.into(), data: None }
    }
    pub fn with_path(mut self, path: &str) -> Self {
        self.data = Some(serde_json::json!({ "path": path }));
        self
    }
    pub fn invalid(message: impl Into<String>) -> Self {
        Self::new("invalid_argument", message)
    }
    pub fn io(message: impl Into<String>) -> Self {
        Self::new("io", message)
    }
    pub fn unavailable(message: impl Into<String>) -> Self {
        Self::new("unavailable", message)
    }
    pub fn not_found(message: impl Into<String>) -> Self {
        Self::new("not_found", message)
    }
}

impl std::fmt::Display for ShellError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}: {}", self.code, self.message)
    }
}

impl std::error::Error for ShellError {}

impl From<std::io::Error> for ShellError {
    fn from(e: std::io::Error) -> Self {
        match e.kind() {
            std::io::ErrorKind::NotFound => Self::not_found(e.to_string()),
            _ => Self::io(e.to_string()),
        }
    }
}

pub type ShellResult = Result<Value, ShellError>;

/// `{ "value": v }`, the shape shell-bridge.js's `value()` reads.
pub fn value(v: impl Serialize) -> Value {
    serde_json::json!({ "value": v })
}

/// A string option, or None.
pub fn opt_str<'a>(o: &'a Value, key: &str) -> Option<&'a str> {
    o.get(key).and_then(Value::as_str)
}

/// A string option that must be there.
pub fn req_str<'a>(o: &'a Value, key: &str) -> Result<&'a str, ShellError> {
    opt_str(o, key).ok_or_else(|| ShellError::invalid(format!("`{key}` is needed.")))
}

pub fn opt_bool(o: &Value, key: &str) -> Option<bool> {
    o.get(key).and_then(Value::as_bool)
}

pub fn opt_f64(o: &Value, key: &str) -> Option<f64> {
    o.get(key).and_then(Value::as_f64).filter(|n| n.is_finite())
}

/// Bytes the page sent as base64.
pub fn req_bytes(o: &Value, key: &str) -> Result<Vec<u8>, ShellError> {
    use base64::Engine;
    let s = req_str(o, key)?;
    base64::engine::general_purpose::STANDARD.decode(s).map_err(|_| ShellError::invalid(format!("`{key}` isn't base64.")))
}

pub fn b64(bytes: &[u8]) -> String {
    use base64::Engine;
    base64::engine::general_purpose::STANDARD.encode(bytes)
}

/// Milliseconds since 1970.
pub fn now_ms() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

/// Writes a file whole or not at all: a temporary file beside it, flushed, then renamed over it.
pub fn write_atomic(path: &std::path::Path, bytes: &[u8]) -> std::io::Result<()> {
    use std::io::Write;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let tmp = path.with_extension(format!("tmp-{}", rand::random::<u32>()));
    {
        let mut f = std::fs::File::create(&tmp)?;
        f.write_all(bytes)?;
        f.sync_all()?;
    }
    match std::fs::rename(&tmp, path) {
        Ok(()) => Ok(()),
        Err(e) => {
            let _ = std::fs::remove_file(&tmp);
            Err(e)
        }
    }
}
