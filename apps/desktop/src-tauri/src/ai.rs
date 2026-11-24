//! Foli AI with the person's own keys (Electron's ai.ts, Native/Shell/ShellAI.swift): `foleviShell.ai` for the
//! built-in interface. A request goes to one of the person's own providers (OpenAI, Anthropic, Google) over
//! HTTPS with the key they stored. The keys stay in this process: they're read from the secret store just
//! before a request, go only in that provider's own header, and never reach the page, a log or an error
//! message. Folevi's own servers are never contacted from here. There's no on-device model on this PC.
//!
//! The page's side is shell-bridge.js: `aiCapabilities`, `aiGenerate { id, req }` (each new piece of the answer
//! goes out as the event "aiChunk" { id, text }), `aiCancel { id }` and `aiTestKey { provider }`.
use once_cell::sync::Lazy;
use parking_lot::Mutex;
use regex::Regex;
use serde_json::{json, Map, Value};
use std::collections::HashMap;
use std::future::Future;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::watch;
use url::Url;

use crate::events::Emit;
use crate::secrets::SecretStore;
use crate::shell::{opt_str, ShellError, ShellResult};

// ---------------------------------------------------------------- providers and the host allowlist

pub const KEY_PROVIDERS: [&str; 3] = ["openai", "anthropic", "google"];
const PROVIDERS: [&str; 4] = ["on-device", "openai", "anthropic", "google"];
pub const PAGE_SECRETS: [&str; 3] = ["ai.openai", "ai.anthropic", "ai.google"];

/// The only host each provider is ever asked at (https, default port). Never Folevi's own.
pub fn ai_host(provider: &str) -> Option<&'static str> {
    match provider {
        "openai" => Some("api.openai.com"),
        "anthropic" => Some("api.anthropic.com"),
        "google" => Some("generativelanguage.googleapis.com"),
        _ => None,
    }
}

/// Used when a request names no model (the Mac's DEFAULT_MODELS).
pub fn default_model(provider: &str) -> &'static str {
    match provider {
        "openai" => "gpt-6.1-sol",
        "anthropic" => "claude-sonnet-5-5",
        _ => "gemini-3.8-flash",
    }
}

fn name_of(provider: &str) -> &'static str {
    match provider {
        "openai" => "OpenAI",
        "anthropic" => "Anthropic",
        _ => "Google",
    }
}

/// The one place a provider address is checked: https, exactly the provider's host (any of the three when
/// `provider` is None), the default port, no user or password.
pub fn allowed_ai_url(url: &str, provider: Option<&str>) -> bool {
    let Ok(u) = Url::parse(url) else { return false };
    if u.scheme() != "https" || u.port().is_some() || !u.username().is_empty() || u.password().is_some() {
        return false;
    }
    let Some(host) = u.host_str() else { return false };
    match provider {
        Some(p) => ai_host(p) == Some(host),
        None => KEY_PROVIDERS.iter().any(|p| ai_host(p) == Some(host)),
    }
}

// ---------------------------------------------------------------- checking a request

pub static MODEL_ID: Lazy<Regex> = Lazy::new(|| Regex::new(r"^[A-Za-z0-9._:-]{1,80}$").unwrap());
pub const MAX_TURNS: usize = 64;
/// The most bytes of text one request may carry (system, schema and every turn together).
pub const MAX_REQUEST_BYTES: usize = 400 * 1024;
const MAX_SCHEMA_BYTES: usize = 32 * 1024;
/// Room for the providers' reasoning on top of the answer (their output limits count both).
pub const REASONING_HEADROOM: u64 = 2048;
const ANTHROPIC_DEFAULT_MAX: u64 = 8192;
const JSON_ONLY: &str = "Answer with one JSON value only: no Markdown fences, no text before or after it.";
const NOT_A_REQUEST: &str = "Not a request Foli AI can send.";
const NOT_A_MODEL: &str = "That isn't a model name Foli AI can use.";

fn valid_model(m: &str) -> bool {
    MODEL_ID.is_match(m) && !m.starts_with('.')
}

#[derive(Debug, Clone, PartialEq)]
pub struct Message {
    pub role: String,
    pub content: String,
}

/// A request the page sent, checked (types.ts AiRequest).
#[derive(Debug, Clone, PartialEq, Default)]
pub struct AiRequest {
    pub provider: String,
    pub model: Option<String>,
    pub system: Option<String>,
    pub messages: Vec<Message>,
    pub max_tokens: Option<u64>,
    pub temperature: Option<f64>,
    pub json: bool,
    pub schema: Option<Value>,
}

/// A request from the page, checked field by field; anything else is refused with a plain reason.
pub fn check_request(input: &Value) -> Result<AiRequest, String> {
    let r = input.as_object().ok_or(NOT_A_REQUEST)?;
    let provider = r.get("provider").and_then(Value::as_str).filter(|p| PROVIDERS.iter().any(|x| x == p)).ok_or("Foli AI can't use that provider.")?;
    let model = match r.get("model") {
        None => None,
        Some(Value::String(m)) if valid_model(m) => Some(m.clone()),
        Some(_) => return Err(NOT_A_MODEL.into()),
    };
    let system = match r.get("system") {
        None => None,
        Some(Value::String(s)) => Some(s.clone()),
        Some(_) => return Err(NOT_A_REQUEST.into()),
    };
    let list = r
        .get("messages")
        .and_then(Value::as_array)
        .filter(|l| !l.is_empty() && l.len() <= MAX_TURNS)
        .ok_or_else(|| format!("A request has between 1 and {MAX_TURNS} messages."))?;
    let mut messages = Vec::with_capacity(list.len());
    for m in list {
        let role = m.get("role").and_then(Value::as_str).filter(|r| *r == "user" || *r == "assistant").ok_or(NOT_A_REQUEST)?;
        let content = m.get("content").and_then(Value::as_str).ok_or(NOT_A_REQUEST)?;
        messages.push(Message { role: role.into(), content: content.into() });
    }
    if messages.last().map(|m| m.role.as_str()) != Some("user") {
        return Err("The last message of a request is the person's.".into());
    }
    let max_tokens = match r.get("maxTokens") {
        None => None,
        Some(v) => Some(v.as_f64().filter(|n| n.fract() == 0.0 && (1.0..=32768.0).contains(n)).ok_or("maxTokens is between 1 and 32768.")? as u64),
    };
    let temperature = match r.get("temperature") {
        None => None,
        Some(v) => Some(v.as_f64().filter(|t| t.is_finite() && (0.0..=2.0).contains(t)).ok_or("temperature is between 0 and 2.")?),
    };
    let json = match r.get("json") {
        None => false,
        Some(Value::Bool(b)) => *b,
        Some(_) => return Err(NOT_A_REQUEST.into()),
    };
    let (schema, schema_text) = match r.get("schema") {
        None | Some(Value::Null) => (None, String::new()),
        Some(v) => {
            let text = serde_json::to_string(v).map_err(|_| "The answer's schema isn't JSON.")?;
            if text.len() > MAX_SCHEMA_BYTES {
                return Err("The answer's schema is too long.".into());
            }
            (Some(v.clone()), text)
        }
    };
    let bytes = system.as_deref().map_or(0, str::len) + schema_text.len() + messages.iter().map(|m| m.content.len()).sum::<usize>();
    if bytes > MAX_REQUEST_BYTES {
        return Err("This is too long for Foli AI to send in one request.".into());
    }
    Ok(AiRequest { provider: provider.into(), model, system, messages, max_tokens, temperature, json, schema })
}

/// The instructions sent: the page's system prompt, plus the JSON rule and the schema when asked for.
fn instructions(req: &AiRequest) -> Option<String> {
    let mut parts: Vec<String> = Vec::new();
    if let Some(s) = req.system.as_deref().filter(|s| !s.is_empty()) {
        parts.push(s.to_string());
    }
    if req.json || req.schema.is_some() {
        parts.push(JSON_ONLY.to_string());
    }
    if let Some(schema) = &req.schema {
        parts.push(format!("The JSON follows this JSON Schema:\n{schema}"));
    }
    (!parts.is_empty()).then(|| parts.join("\n\n"))
}

// ---------------------------------------------------------------- server-sent events

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SseEvent {
    pub event: String,
    pub data: String,
}

/// An incremental text/event-stream parser: feed it text as it arrives (any split), get whole events.
#[derive(Default)]
pub struct SseParser {
    buffer: String,
    event: String,
    data: Vec<String>,
}

impl SseParser {
    pub fn feed(&mut self, text: &str) -> Vec<SseEvent> {
        self.buffer.push_str(text);
        let mut out = Vec::new();
        loop {
            let Some(at) = self.buffer.find(['\r', '\n']) else { break };
            let bytes = self.buffer.as_bytes();
            // A lone \r at the very end may be the first half of \r\n: wait for more.
            if bytes[at] == b'\r' && at == bytes.len() - 1 {
                break;
            }
            let end = if bytes[at] == b'\r' && bytes.get(at + 1) == Some(&b'\n') { at + 2 } else { at + 1 };
            let line = self.buffer[..at].to_string();
            self.buffer.drain(..end);
            self.line(&line, &mut out);
        }
        out
    }

    /// The end of the stream: an event that wasn't followed by a blank line still counts.
    pub fn end(&mut self) -> Vec<SseEvent> {
        let mut out = Vec::new();
        let rest = std::mem::take(&mut self.buffer);
        if !rest.is_empty() {
            self.line(&rest, &mut out);
        }
        self.line("", &mut out);
        out
    }

    fn line(&mut self, line: &str, out: &mut Vec<SseEvent>) {
        if line.is_empty() {
            if !self.data.is_empty() {
                let event = if self.event.is_empty() { "message".to_string() } else { std::mem::take(&mut self.event) };
                out.push(SseEvent { event, data: self.data.join("\n") });
            }
            self.event.clear();
            self.data.clear();
            return;
        }
        if line.starts_with(':') {
            return;
        }
        let (field, value) = match line.find(':') {
            Some(c) => (&line[..c], &line[c + 1..]),
            None => (line, ""),
        };
        let value = value.strip_prefix(' ').unwrap_or(value);
        match field {
            "event" => self.event = value.to_string(),
            "data" => self.data.push(value.to_string()),
            _ => {}
        }
    }
}

// ---------------------------------------------------------------- the providers' streams

/// What a stream said so far: the text, and how it ended.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct StreamState {
    pub text: String,
    pub stop: Option<&'static str>,
    pub error: Option<String>,
    pub error_code: Option<&'static str>,
}

static EMPTY: Lazy<Map<String, Value>> = Lazy::new(Map::new);

fn obj(v: Option<&Value>) -> &Map<String, Value> {
    v.and_then(Value::as_object).unwrap_or(&EMPTY)
}

fn s(v: Option<&Value>) -> &str {
    v.and_then(Value::as_str).unwrap_or("")
}

fn truthy(v: Option<&Value>) -> bool {
    match v {
        None | Some(Value::Null) => false,
        Some(Value::Bool(b)) => *b,
        Some(Value::Number(n)) => n.as_f64().is_some_and(|f| f != 0.0),
        Some(Value::String(s)) => !s.is_empty(),
        Some(_) => true,
    }
}

static CONTEXT_HINT: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i)context|too long|too many tokens|maximum.*tokens|token.*limit|exceeds").unwrap());
static MENTIONS_CONTEXT: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i)context").unwrap());
static KEY_REFUSED: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i)API_KEY_INVALID|API key not valid|invalid.api.key|authentication_error").unwrap());
static NO_CREDIT: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i)insufficient_quota|quota|billing|credit").unwrap());
static KEY_SHAPED: Lazy<Regex> = Lazy::new(|| Regex::new(r"\b(sk-[A-Za-z0-9_-]{8,}|AIza[A-Za-z0-9_-]{20,})").unwrap());

fn parse_event(ev: &SseEvent) -> Option<Value> {
    serde_json::from_str::<Value>(&ev.data).ok()
}

/// One OpenAI (Responses API) event: its new text; how the stream ended goes in `state`.
pub fn openai_events(ev: &SseEvent, state: &mut StreamState) -> String {
    let Some(v) = parse_event(ev) else { return String::new() };
    let d = obj(Some(&v));
    let ty = match s(d.get("type")) {
        "" => ev.event.as_str(),
        t => t,
    };
    match ty {
        "response.output_text.delta" => return s(d.get("delta")).to_string(),
        "response.completed" => {
            state.stop.get_or_insert("end");
        }
        "response.incomplete" => {
            let reason = s(obj(obj(d.get("response")).get("incomplete_details")).get("reason"));
            if reason == "content_filter" {
                state.stop = Some("error");
                state.error = Some("OpenAI stopped this answer (its content filter).".into());
            } else {
                state.stop = Some("length");
            }
        }
        "response.failed" | "error" => {
            let e = if ty == "error" {
                if truthy(d.get("error")) {
                    obj(d.get("error"))
                } else {
                    d
                }
            } else {
                obj(obj(d.get("response")).get("error"))
            };
            let code = s(e.get("code"));
            let message = s(e.get("message"));
            state.stop = Some("error");
            if code == "context_length_exceeded" || (code.is_empty() && CONTEXT_HINT.is_match(message) && MENTIONS_CONTEXT.is_match(message)) {
                state.error_code = Some("context");
                state.error = Some("This is too long for OpenAI's model.".into());
            } else if code == "rate_limit_exceeded" {
                state.error_code = Some("rate");
                state.error = Some("OpenAI asked Foli AI to slow down. Try again in a moment.".into());
            } else {
                state.error = Some(if message.is_empty() { "OpenAI couldn't answer.".into() } else { format!("OpenAI: {message}") });
            }
        }
        _ => {}
    }
    String::new()
}

/// One Anthropic (Messages API) event.
pub fn anthropic_events(ev: &SseEvent, state: &mut StreamState) -> String {
    let Some(v) = parse_event(ev) else { return String::new() };
    let d = obj(Some(&v));
    let ty = match s(d.get("type")) {
        "" => ev.event.as_str(),
        t => t,
    };
    match ty {
        "content_block_delta" => {
            let delta = obj(d.get("delta"));
            // Thinking (thinking_delta, signature_delta) and tool input aren't part of the answer.
            return if s(delta.get("type")) == "text_delta" { s(delta.get("text")).to_string() } else { String::new() };
        }
        "message_delta" => {
            let reason = s(obj(d.get("delta")).get("stop_reason"));
            if reason == "max_tokens" || reason == "model_context_window_exceeded" {
                state.stop = Some("length");
            } else if reason == "refusal" {
                state.stop = Some("error");
                state.error = Some("Claude declined to answer this.".into());
            } else if !reason.is_empty() {
                state.stop = Some("end");
            }
        }
        "message_stop" => {
            state.stop.get_or_insert("end");
        }
        "error" => {
            let e = obj(d.get("error"));
            state.stop = Some("error");
            let kind = s(e.get("type"));
            if kind == "rate_limit_error" || kind == "overloaded_error" {
                state.error_code = Some("rate");
                state.error = Some("Anthropic asked Foli AI to slow down. Try again in a moment.".into());
            } else {
                let message = s(e.get("message"));
                state.error = Some(if message.is_empty() { "Anthropic couldn't answer.".into() } else { format!("Anthropic: {message}") });
            }
        }
        _ => {}
    }
    String::new()
}

/// One Google (Gemini streamGenerateContent) event.
pub fn google_events(ev: &SseEvent, state: &mut StreamState) -> String {
    let Some(v) = parse_event(ev) else { return String::new() };
    let d = obj(Some(&v));
    if truthy(d.get("error")) {
        let message = s(obj(d.get("error")).get("message"));
        state.stop = Some("error");
        state.error = Some(if message.is_empty() { "Google couldn't answer.".into() } else { format!("Google: {message}") });
        return String::new();
    }
    let blocked = s(obj(d.get("promptFeedback")).get("blockReason"));
    if !blocked.is_empty() {
        state.stop = Some("error");
        state.error = Some(format!("Google didn't answer this ({}).", blocked.to_lowercase()));
        return String::new();
    }
    let candidate = obj(d.get("candidates").and_then(Value::as_array).and_then(|c| c.first()));
    let parts = obj(candidate.get("content")).get("parts").and_then(Value::as_array).map(Vec::as_slice).unwrap_or(&[]);
    // Thought summaries (thought: true) aren't part of the answer.
    let text: String = parts.iter().filter(|p| p.get("thought") != Some(&Value::Bool(true))).map(|p| s(p.get("text"))).collect();
    let finish = s(candidate.get("finishReason"));
    match finish {
        "MAX_TOKENS" => state.stop = Some("length"),
        "STOP" => state.stop = Some("end"),
        "" | "FINISH_REASON_UNSPECIFIED" => {}
        other => {
            state.stop = Some("error");
            state.error = Some(format!("Google stopped this answer ({}).", other.to_lowercase().replace('_', " ")));
        }
    }
    text
}

fn handle_event(provider: &str, ev: &SseEvent, state: &mut StreamState) -> String {
    match provider {
        "openai" => openai_events(ev, state),
        "anthropic" => anthropic_events(ev, state),
        _ => google_events(ev, state),
    }
}

/// Reads a provider's stream as its bytes arrive (split anywhere, even inside a character).
pub struct StreamReader {
    provider: String,
    pending: Vec<u8>,
    parser: SseParser,
    pub state: StreamState,
}

impl StreamReader {
    pub fn new(provider: &str) -> Self {
        Self { provider: provider.to_string(), pending: Vec::new(), parser: SseParser::default(), state: StreamState::default() }
    }

    /// The bytes' whole characters; an unfinished one waits for the next bytes, a broken one is U+FFFD.
    fn decode(&mut self, bytes: &[u8]) -> String {
        self.pending.extend_from_slice(bytes);
        let mut out = String::new();
        loop {
            match std::str::from_utf8(&self.pending) {
                Ok(text) => {
                    out.push_str(text);
                    self.pending.clear();
                    break;
                }
                Err(e) => {
                    let valid = e.valid_up_to();
                    out.push_str(std::str::from_utf8(&self.pending[..valid]).unwrap_or_default());
                    match e.error_len() {
                        Some(n) => {
                            out.push('\u{fffd}');
                            self.pending.drain(..valid + n);
                        }
                        None => {
                            self.pending.drain(..valid);
                            break;
                        }
                    }
                }
            }
        }
        out
    }

    fn apply(&mut self, events: Vec<SseEvent>, on_chunk: &mut dyn FnMut(&str)) {
        for ev in events {
            let piece = handle_event(&self.provider, &ev, &mut self.state);
            if !piece.is_empty() {
                self.state.text.push_str(&piece);
                on_chunk(&piece);
            }
        }
    }

    pub fn push(&mut self, bytes: &[u8], on_chunk: &mut dyn FnMut(&str)) {
        let text = self.decode(bytes);
        let events = self.parser.feed(&text);
        self.apply(events, on_chunk);
    }

    /// The stream ended: how the answer came out.
    pub fn end(mut self, on_chunk: &mut dyn FnMut(&str)) -> AiResult {
        let rest = String::from_utf8_lossy(&std::mem::take(&mut self.pending)).into_owned();
        let events = self.parser.feed(&rest);
        self.apply(events, on_chunk);
        let events = self.parser.end();
        self.apply(events, on_chunk);
        let st = self.state;
        let Some(stop) = st.stop.or((self.provider == "google").then_some("end")) else {
            // Gemini's stream simply ends; the others always say how it ended, so a silent end was cut off.
            return AiResult::error(st.text, format!("The answer from {} was cut off.", name_of(&self.provider)), "network");
        };
        AiResult { text: st.text, stop_reason: stop, error: st.error, error_code: st.error_code }
    }
}

// ---------------------------------------------------------------- requests and errors

/// The HTTPS request for one generation (or, with `probe`, a tiny one that checks the key).
#[derive(Debug, Clone)]
pub struct Built {
    pub url: String,
    pub headers: Vec<(&'static str, String)>,
    pub body: String,
}

pub fn build_request(provider: &str, req: &AiRequest, key: &str, probe: bool) -> Result<Built, String> {
    let model = req.model.as_deref().unwrap_or(default_model(provider));
    if !valid_model(model) {
        return Err(NOT_A_MODEL.into());
    }
    let system = instructions(req);
    let budget = req.max_tokens.map(|n| n + REASONING_HEADROOM);
    let turns = |model_role: &str| -> Vec<Value> {
        req.messages
            .iter()
            .map(|m| {
                if model_role == "model" {
                    let role = if m.role == "assistant" { "model" } else { "user" };
                    json!({ "role": role, "parts": [{ "text": m.content }] })
                } else {
                    json!({ "role": m.role, "content": m.content })
                }
            })
            .collect()
    };
    let json_answer = req.json || req.schema.is_some();
    match provider {
        "openai" => {
            // The Responses API. Current GPT models reason, and with reasoning on they refuse `temperature`.
            let mut body = json!({ "model": model, "input": turns("assistant"), "stream": !probe, "store": false, "reasoning": { "effort": "low" } });
            if let Some(system) = system {
                body["instructions"] = json!(system);
            }
            if probe {
                body["max_output_tokens"] = json!(16);
            } else if let Some(b) = budget {
                body["max_output_tokens"] = json!(b);
            }
            if json_answer {
                body["text"] = json!({ "format": { "type": "json_object" } });
            }
            Ok(Built {
                url: "https://api.openai.com/v1/responses".into(),
                headers: vec![("content-type", "application/json".into()), ("authorization", format!("Bearer {key}"))],
                body: body.to_string(),
            })
        }
        "anthropic" => {
            // Current Claude models think adaptively and refuse a non-default temperature: neither is sent. No
            // JSON mode: the instructions ask for JSON.
            let max = if probe { 8 } else { budget.unwrap_or(ANTHROPIC_DEFAULT_MAX) };
            let mut body = json!({ "model": model, "max_tokens": max, "messages": turns("assistant"), "stream": !probe });
            if let Some(system) = system {
                body["system"] = json!(system);
            }
            Ok(Built {
                url: "https://api.anthropic.com/v1/messages".into(),
                headers: vec![("content-type", "application/json".into()), ("x-api-key", key.to_string()), ("anthropic-version", "2023-06-01".into())],
                body: body.to_string(),
            })
        }
        "google" => {
            let mut config = Map::new();
            if let Some(t) = req.temperature {
                config.insert("temperature".into(), json!(t));
            }
            if probe {
                config.insert("maxOutputTokens".into(), json!(8));
            } else if let Some(b) = budget {
                config.insert("maxOutputTokens".into(), json!(b));
            }
            if json_answer {
                config.insert("responseMimeType".into(), json!("application/json"));
            }
            let mut body = json!({ "contents": turns("model"), "generationConfig": config });
            if let Some(system) = system {
                body["systemInstruction"] = json!({ "parts": [{ "text": system }] });
            }
            // The key goes in its header, never in the address.
            let path = format!("/v1beta/models/{}:{}", model.replace(':', "%3A"), if probe { "generateContent" } else { "streamGenerateContent" });
            let mut url = Url::parse(&format!("https://generativelanguage.googleapis.com{path}")).map_err(|_| NOT_A_MODEL)?;
            if !probe {
                url.query_pairs_mut().append_pair("alt", "sse");
            }
            // The model can't move the request anywhere else on the host (no dot segments, nothing escaped).
            if url.path() != path {
                return Err(NOT_A_MODEL.into());
            }
            Ok(Built {
                url: url.to_string(),
                headers: vec![("content-type", "application/json".into()), ("x-goog-api-key", key.to_string())],
                body: body.to_string(),
            })
        }
        _ => Err("Foli AI can't use that provider.".into()),
    }
}

/// Removes the key (and anything shaped like a provider key) from text before it goes anywhere.
pub fn scrub(text: &str, key: Option<&str>) -> String {
    let mut out = text.to_string();
    if let Some(k) = key.filter(|k| !k.is_empty()) {
        out = out.replace(k, "[key]");
    }
    KEY_SHAPED.replace_all(&out, "[key]").into_owned()
}

/// What an HTTP error from a provider means, in words for people (never the key), and its error code.
pub fn http_error(provider: &str, status: u16, body: &str, model: &str) -> (String, Option<&'static str>) {
    let name = name_of(provider);
    let parsed: Value = serde_json::from_str(body).unwrap_or(Value::Null);
    let d = obj(Some(&parsed));
    let e = obj(d.get("error"));
    let message = [s(e.get("message")), s(d.get("message"))].into_iter().find(|m| !m.is_empty()).unwrap_or("").to_string();
    let mut code = [s(e.get("code")), s(e.get("type")), s(e.get("status"))].into_iter().find(|c| !c.is_empty()).unwrap_or("").to_string();
    if let Some(details) = e.get("details").and_then(Value::as_array) {
        let reasons = details.iter().map(|x| s(obj(Some(x)).get("reason"))).collect::<Vec<_>>().join(" ");
        if !reasons.is_empty() {
            code = format!("{code} {reasons}");
        }
    }
    let both = format!("{code} {message}");
    if status == 401 || status == 403 || KEY_REFUSED.is_match(&both) {
        return (format!("The {name} key was refused. Check it in Settings > Foli AI."), Some("auth"));
    }
    if status == 429 {
        if NO_CREDIT.is_match(&both) {
            return (format!("The {name} account is out of credit or over its quota."), Some("rate"));
        }
        return (format!("{name} asked Foli AI to slow down. Try again in a moment."), Some("rate"));
    }
    if (status == 400 || status == 413) && (code.contains("context_length_exceeded") || CONTEXT_HINT.is_match(&message)) {
        return (format!("This is too long for {name}'s model."), Some("context"));
    }
    if status == 404 {
        return (format!("{name} doesn't offer the model \"{model}\" to this key."), Some("invalid"));
    }
    if status >= 500 {
        return (format!("{name} isn't answering right now. Try again later."), Some("unavailable"));
    }
    let said = if message.is_empty() { String::new() } else { format!(": {}", message.chars().take(300).collect::<String>()) };
    (format!("{name} refused the request ({status}){said}"), (status == 400).then_some("invalid"))
}

// ---------------------------------------------------------------- the result

/// types.ts AiResult.
#[derive(Debug, Clone, PartialEq)]
pub struct AiResult {
    pub text: String,
    /// "end", "length", "cancelled" or "error".
    pub stop_reason: &'static str,
    pub error: Option<String>,
    /// "auth", "rate", "context", "network", "unavailable" or "invalid".
    pub error_code: Option<&'static str>,
}

impl AiResult {
    pub fn error(text: impl Into<String>, error: impl Into<String>, code: &'static str) -> Self {
        Self { text: text.into(), stop_reason: "error", error: Some(error.into()), error_code: Some(code) }
    }

    pub fn cancelled(text: impl Into<String>) -> Self {
        Self { text: text.into(), stop_reason: "cancelled", error: None, error_code: None }
    }

    fn scrubbed(mut self, key: &str) -> Self {
        self.error = self.error.map(|e| scrub(&e, Some(key)));
        self.text = self.text.replace(key, "[key]");
        self
    }

    pub fn to_json(&self) -> Value {
        let mut o = json!({ "text": self.text, "stopReason": self.stop_reason });
        if let Some(e) = &self.error {
            o["error"] = json!(e);
        }
        if let Some(c) = self.error_code {
            o["errorCode"] = json!(c);
        }
        o
    }
}

// ---------------------------------------------------------------- the service

fn valid_request_id(id: &str) -> bool {
    (1..=64).contains(&id.len()) && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

/// The most generations running at once.
const MAX_RUNNING: usize = 8;
/// How long a stream may go quiet before it counts as lost.
const IDLE: Duration = Duration::from_secs(90);
const TEST_KEY_TIMEOUT: Duration = Duration::from_secs(30);
const MAX_ERROR_BODY: usize = 65536;

/// `fut`, unless the request is cancelled first (None).
async fn or_cancel<T>(cancel: &mut watch::Receiver<bool>, fut: impl Future<Output = T>) -> Option<T> {
    tokio::select! {
        biased;
        Ok(_) = cancel.wait_for(|c| *c) => None,
        v = fut => Some(v),
    }
}

pub struct Ai {
    secrets: Arc<SecretStore>,
    client: reqwest::Client,
    /// The generations in flight, by request id.
    running: Mutex<HashMap<String, watch::Sender<bool>>>,
    /// Tests: the origin (http://127.0.0.1:port) a checked provider address goes to instead.
    endpoint: Option<String>,
    idle: Duration,
}

/// Forgets a generation however its call ends.
struct Registered<'a> {
    running: &'a Mutex<HashMap<String, watch::Sender<bool>>>,
    id: String,
}

impl Drop for Registered<'_> {
    fn drop(&mut self) {
        self.running.lock().remove(&self.id);
    }
}

impl Ai {
    pub fn new(secrets: Arc<SecretStore>) -> Arc<Self> {
        Arc::new(Self::build(secrets, None, IDLE))
    }

    fn build(secrets: Arc<SecretStore>, endpoint: Option<String>, idle: Duration) -> Self {
        // Never follows a redirect: an answer that moved elsewhere is refused. No cookies.
        let mut builder = reqwest::Client::builder().redirect(reqwest::redirect::Policy::none()).connect_timeout(Duration::from_secs(30));
        if endpoint.is_some() {
            builder = builder.no_proxy();
        }
        let client = builder.build().unwrap_or_else(|_| reqwest::Client::new());
        Self { secrets, client, running: Mutex::new(HashMap::new()), endpoint, idle }
    }

    /// aiCapabilities, aiGenerate (chunks go out as "aiChunk" { id, text }), aiCancel, aiTestKey.
    pub async fn call(&self, method: &str, o: &Value, emit: Emit) -> ShellResult {
        match method {
            "aiCapabilities" => Ok(self.capabilities()),
            "aiGenerate" => Ok(self.generate(o, emit).await.to_json()),
            "aiCancel" => {
                if let Some(id) = opt_str(o, "id") {
                    self.cancel(id);
                }
                Ok(Value::Null)
            }
            "aiTestKey" => Ok(self.test_key(opt_str(o, "provider").unwrap_or("")).await),
            _ => Err(ShellError::unavailable(format!("{method} isn't something Foli AI does on this PC."))),
        }
    }

    /// No on-device model on this PC; which keys are kept (never the keys).
    pub fn capabilities(&self) -> Value {
        let keys: Map<String, Value> = PAGE_SECRETS.iter().map(|n| (n.to_string(), json!(self.secrets.has(n)))).collect();
        json!({ "onDevice": false, "onDeviceStatus": "notSupported", "keys": keys })
    }

    /// Stops a running generation; it ends "cancelled" with the text so far.
    pub fn cancel(&self, id: &str) {
        if let Some(tx) = self.running.lock().get(id) {
            tx.send_replace(true);
        }
    }

    fn key(&self, provider: &str) -> Option<String> {
        self.secrets.get(&format!("ai.{provider}")).filter(|k| !k.is_empty())
    }

    /// The address a request goes to: the checked one (in tests, the same path on the test server).
    fn target(&self, url: &str) -> Option<Url> {
        let u = Url::parse(url).ok()?;
        match &self.endpoint {
            None => Some(u),
            Some(origin) => Url::parse(&format!("{origin}{}{}", u.path(), u.query().map(|q| format!("?{q}")).unwrap_or_default())).ok(),
        }
    }

    pub async fn generate(&self, o: &Value, emit: Emit) -> AiResult {
        let Some(id) = opt_str(o, "id").filter(|id| valid_request_id(id)) else { return AiResult::error("", NOT_A_REQUEST, "invalid") };
        let req = match check_request(o.get("req").unwrap_or(&Value::Null)) {
            Ok(r) => r,
            Err(e) => return AiResult::error("", e, "invalid"),
        };
        if req.provider == "on-device" {
            return AiResult::error("", "There's no on-device model on this PC. Add a key in Settings > Foli AI to use Foli AI here.", "unavailable");
        }
        let (tx, mut cancel) = watch::channel(false);
        let _registered = {
            let mut running = self.running.lock();
            if running.contains_key(id) {
                return AiResult::error("", "That request is already running.", "invalid");
            }
            if running.len() >= MAX_RUNNING {
                return AiResult::error("", "Foli AI is already answering several requests. Try again in a moment.", "rate");
            }
            running.insert(id.to_string(), tx);
            Registered { running: &self.running, id: id.to_string() }
        };
        let mut on_chunk = |piece: &str| emit("aiChunk", json!({ "id": id, "text": piece }));
        self.stream(&req, &mut cancel, &mut on_chunk).await
    }

    /// One request to a provider, only to its allowed address, with its key.
    async fn send(&self, provider: &str, req: &AiRequest, key: &str, probe: bool, cancel: &mut watch::Receiver<bool>, limit: Duration) -> Result<reqwest::Response, AiResult> {
        let name = name_of(provider);
        let built = build_request(provider, req, key, probe).map_err(|e| AiResult::error("", e, "invalid"))?;
        if !allowed_ai_url(&built.url, Some(provider)) {
            return Err(AiResult::error("", "Foli AI only talks to the provider's own address.", "invalid"));
        }
        let url = self.target(&built.url).ok_or_else(|| AiResult::error("", "Foli AI only talks to the provider's own address.", "invalid"))?;
        let mut request = self.client.post(url.clone()).body(built.body);
        for (k, v) in &built.headers {
            request = request.header(*k, v);
        }
        let res = match or_cancel(cancel, tokio::time::timeout(limit, request.send())).await {
            None => return Err(AiResult::cancelled("")),
            Some(Err(_)) => return Err(AiResult::error("", format!("{name} stopped answering."), "network")),
            Some(Ok(Err(_))) => return Err(AiResult::error("", format!("Foli AI couldn't reach {name}. Check the connection."), "network")),
            Some(Ok(Ok(res))) => res,
        };
        // Never followed: an answer that moved elsewhere is refused.
        if res.status().is_redirection() || res.url() != &url {
            return Err(AiResult::error("", format!("{name} answered from somewhere else; Foli AI didn't follow."), "network"));
        }
        Ok(res)
    }

    /// At most `max` bytes of a body, as text (an error's explanation).
    async fn read_body(&self, res: &mut reqwest::Response, max: usize, cancel: &mut watch::Receiver<bool>) -> String {
        let mut body = Vec::new();
        while body.len() < max {
            match or_cancel(cancel, tokio::time::timeout(self.idle, res.chunk())).await {
                Some(Ok(Ok(Some(chunk)))) => body.extend_from_slice(&chunk),
                _ => break,
            }
        }
        body.truncate(max);
        String::from_utf8_lossy(&body).into_owned()
    }

    /// Streams an answer: `on_chunk` gets each new piece; the result has the whole text and how it ended.
    async fn stream(&self, req: &AiRequest, cancel: &mut watch::Receiver<bool>, on_chunk: &mut (dyn FnMut(&str) + Send)) -> AiResult {
        let provider = req.provider.as_str();
        let name = name_of(provider);
        let Some(key) = self.key(provider) else { return AiResult::error("", format!("Add your {name} key in Settings > Foli AI first."), "auth") };
        let mut res = match self.send(provider, req, &key, false, cancel, self.idle).await {
            Ok(res) => res,
            Err(r) => return r.scrubbed(&key),
        };
        if !res.status().is_success() {
            let status = res.status().as_u16();
            let body = self.read_body(&mut res, MAX_ERROR_BODY, cancel).await;
            let (error, code) = http_error(provider, status, &body, req.model.as_deref().unwrap_or(default_model(provider)));
            return AiResult { text: String::new(), stop_reason: "error", error: Some(error), error_code: code }.scrubbed(&key);
        }
        let mut reader = StreamReader::new(provider);
        loop {
            match or_cancel(cancel, tokio::time::timeout(self.idle, res.chunk())).await {
                None => return AiResult::cancelled(reader.state.text).scrubbed(&key),
                Some(Err(_)) => return AiResult::error(reader.state.text, format!("{name} stopped answering."), "network").scrubbed(&key),
                Some(Ok(Err(_))) => return AiResult::error(reader.state.text, format!("Foli AI couldn't reach {name}. Check the connection."), "network").scrubbed(&key),
                Some(Ok(Ok(None))) => break,
                Some(Ok(Ok(Some(bytes)))) => reader.push(&bytes, on_chunk),
            }
        }
        reader.end(on_chunk).scrubbed(&key)
    }

    /// Checks a stored key with one tiny request (Settings > Foli AI, "Test"): { ok } or { ok: false, error }.
    pub async fn test_key(&self, provider: &str) -> Value {
        if !KEY_PROVIDERS.iter().any(|p| *p == provider) {
            return json!({ "ok": false, "error": "Foli AI can't use that provider." });
        }
        let name = name_of(provider);
        let Some(key) = self.key(provider) else { return json!({ "ok": false, "error": format!("Add your {name} key first.") }) };
        let probe = AiRequest { provider: provider.into(), messages: vec![Message { role: "user".into(), content: "Reply with OK.".into() }], ..Default::default() };
        let (_tx, mut cancel) = watch::channel(false);
        let work = async {
            let mut res = match self.send(provider, &probe, &key, true, &mut cancel, TEST_KEY_TIMEOUT).await {
                Ok(res) => res,
                Err(r) => return json!({ "ok": false, "error": scrub(r.error.as_deref().unwrap_or(""), Some(&key)) }),
            };
            if res.status().is_success() {
                return json!({ "ok": true });
            }
            let status = res.status().as_u16();
            let body = self.read_body(&mut res, MAX_ERROR_BODY, &mut cancel).await;
            json!({ "ok": false, "error": scrub(&http_error(provider, status, &body, default_model(provider)).0, Some(&key)) })
        };
        match tokio::time::timeout(TEST_KEY_TIMEOUT, work).await {
            Ok(v) => v,
            Err(_) => json!({ "ok": false, "error": format!("Foli AI couldn't reach {name}. Check the connection.") }),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::secrets::Sealer;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    const OPENAI_KEY: &str = "sk-proj-TESTKEY0123456789abcdefXYZ";
    const ANTHROPIC_KEY: &str = "sk-ant-api03-TESTKEY0123456789abcdef";
    const GOOGLE_KEY: &str = "AIzaSyTESTKEY0123456789abcdefghijkl";
    const ANSWER: &str = "Héllo, wörld 👋";

    fn key_of(provider: &str) -> &'static str {
        match provider {
            "openai" => OPENAI_KEY,
            "anthropic" => ANTHROPIC_KEY,
            _ => GOOGLE_KEY,
        }
    }

    fn sse(events: &[(Option<&str>, Value)]) -> String {
        events.iter().map(|(e, d)| format!("{}data: {d}\n\n", e.map(|e| format!("event: {e}\n")).unwrap_or_default())).collect()
    }

    fn openai_stream() -> String {
        sse(&[
            (Some("response.created"), json!({ "type": "response.created", "response": { "status": "in_progress" } })),
            (Some("response.output_text.delta"), json!({ "type": "response.output_text.delta", "delta": "Hé" })),
            (Some("response.output_text.delta"), json!({ "type": "response.output_text.delta", "delta": "llo, " })),
            (Some("response.output_text.delta"), json!({ "type": "response.output_text.delta", "delta": "wörld 👋" })),
            (Some("response.completed"), json!({ "type": "response.completed", "response": { "status": "completed" } })),
        ])
    }

    fn anthropic_stream() -> String {
        sse(&[
            (Some("message_start"), json!({ "type": "message_start", "message": { "id": "msg_1" } })),
            (Some("content_block_start"), json!({ "type": "content_block_start", "index": 0, "content_block": { "type": "thinking", "thinking": "" } })),
            (Some("content_block_delta"), json!({ "type": "content_block_delta", "index": 0, "delta": { "type": "thinking_delta", "thinking": "secret plan" } })),
            (Some("content_block_delta"), json!({ "type": "content_block_delta", "index": 0, "delta": { "type": "signature_delta", "signature": "sig" } })),
            (Some("ping"), json!({ "type": "ping" })),
            (Some("content_block_delta"), json!({ "type": "content_block_delta", "index": 1, "delta": { "type": "text_delta", "text": "Hé" } })),
            (Some("content_block_delta"), json!({ "type": "content_block_delta", "index": 1, "delta": { "type": "text_delta", "text": "llo, wörld 👋" } })),
            (Some("message_delta"), json!({ "type": "message_delta", "delta": { "stop_reason": "end_turn" } })),
            (Some("message_stop"), json!({ "type": "message_stop" })),
        ])
    }

    fn google_stream() -> String {
        sse(&[
            (None, json!({ "candidates": [{ "content": { "role": "model", "parts": [{ "text": "thinking about it", "thought": true }] } }] })),
            (None, json!({ "candidates": [{ "content": { "role": "model", "parts": [{ "text": "Hé" }] } }] })),
            (None, json!({ "candidates": [{ "content": { "role": "model", "parts": [{ "text": "llo, wörld 👋" }] }, "finishReason": "STOP" }] })),
        ])
    }

    fn stream_of(provider: &str) -> String {
        match provider {
            "openai" => openai_stream(),
            "anthropic" => anthropic_stream(),
            _ => google_stream(),
        }
    }

    /// A stream read from these byte pieces.
    fn read(provider: &str, pieces: &[&[u8]]) -> (AiResult, String) {
        let mut chunks = String::new();
        let mut reader = StreamReader::new(provider);
        for p in pieces {
            reader.push(p, &mut |t: &str| chunks.push_str(t));
        }
        let result = reader.end(&mut |t: &str| chunks.push_str(t));
        (result, chunks)
    }

    fn read_all(provider: &str, text: &str) -> AiResult {
        read(provider, &[text.as_bytes()]).0
    }

    fn ask(provider: &str) -> AiRequest {
        AiRequest { provider: provider.into(), messages: vec![Message { role: "user".into(), content: "Hello".into() }], ..Default::default() }
    }

    fn done(text: &str, stop: &'static str) -> AiResult {
        AiResult { text: text.into(), stop_reason: stop, error: None, error_code: None }
    }

    #[test]
    fn sse_events_come_out_whole_however_the_stream_is_cut() {
        let text = "event: a\ndata: one\n\n: a comment\r\ndata: two\r\ndata: lines\r\n\r\nevent: b\rdata: three\r\r";
        let want = vec![
            SseEvent { event: "a".into(), data: "one".into() },
            SseEvent { event: "message".into(), data: "two\nlines".into() },
            SseEvent { event: "b".into(), data: "three".into() },
        ];
        for i in 0..=text.len() {
            let mut p = SseParser::default();
            let mut events = p.feed(&text[..i]);
            events.extend(p.feed(&text[i..]));
            events.extend(p.end());
            assert_eq!(events, want, "cut at {i}");
        }
        let mut p = SseParser::default();
        let mut events = p.feed("data: last");
        events.extend(p.end());
        assert_eq!(events, vec![SseEvent { event: "message".into(), data: "last".into() }]);
    }

    #[test]
    fn deltas_split_anywhere_even_inside_a_character_make_the_same_answer() {
        for provider in KEY_PROVIDERS {
            let stream = stream_of(provider);
            let bytes = stream.as_bytes();
            for i in (1..bytes.len()).step_by(3) {
                let (result, chunks) = read(provider, &[&bytes[..i], &bytes[i..]]);
                assert_eq!(result, done(ANSWER, "end"), "{provider} cut at {i}");
                assert_eq!(chunks, ANSWER);
            }
            let singles: Vec<&[u8]> = bytes.chunks(1).collect();
            assert_eq!(read(provider, &singles).0, done(ANSWER, "end"));
        }
    }

    #[test]
    fn thinking_never_reaches_the_answer() {
        assert!(!read_all("anthropic", &anthropic_stream()).text.contains("secret plan"));
        assert!(!read_all("google", &google_stream()).text.contains("thinking about it"));
    }

    #[test]
    fn stop_reasons() {
        let openai_length = sse(&[
            (None, json!({ "type": "response.output_text.delta", "delta": "Partial" })),
            (None, json!({ "type": "response.incomplete", "response": { "status": "incomplete", "incomplete_details": { "reason": "max_output_tokens" } } })),
        ]);
        assert_eq!(read_all("openai", &openai_length), done("Partial", "length"));
        let filter = sse(&[(None, json!({ "type": "response.incomplete", "response": { "incomplete_details": { "reason": "content_filter" } } }))]);
        assert_eq!(read_all("openai", &filter).stop_reason, "error");

        let anthropic_length = sse(&[
            (None, json!({ "type": "content_block_delta", "delta": { "type": "text_delta", "text": "Partial" } })),
            (None, json!({ "type": "message_delta", "delta": { "stop_reason": "max_tokens" } })),
            (None, json!({ "type": "message_stop" })),
        ]);
        assert_eq!(read_all("anthropic", &anthropic_length), done("Partial", "length"));
        let refusal = sse(&[(None, json!({ "type": "message_delta", "delta": { "stop_reason": "refusal" } })), (None, json!({ "type": "message_stop" }))]);
        let r = read_all("anthropic", &refusal);
        assert_eq!((r.stop_reason, r.error.as_deref()), ("error", Some("Claude declined to answer this.")));

        let google_length = sse(&[(None, json!({ "candidates": [{ "content": { "parts": [{ "text": "Partial" }] }, "finishReason": "MAX_TOKENS" }] }))]);
        assert_eq!(read_all("google", &google_length), done("Partial", "length"));
        let safety = read_all("google", &sse(&[(None, json!({ "candidates": [{ "finishReason": "SAFETY" }] }))]));
        assert_eq!((safety.stop_reason, safety.error.as_deref()), ("error", Some("Google stopped this answer (safety).")));
        let blocked = read_all("google", &sse(&[(None, json!({ "promptFeedback": { "blockReason": "OTHER" } }))]));
        assert_eq!(blocked.error.as_deref(), Some("Google didn't answer this (other)."));
        // Gemini's stream may simply end.
        assert_eq!(read_all("google", &sse(&[(None, json!({ "candidates": [{ "content": { "parts": [{ "text": "Done" }] } }] }))])), done("Done", "end"));
    }

    #[test]
    fn errors_inside_a_stream() {
        let overloaded = read_all("anthropic", &sse(&[(Some("error"), json!({ "type": "error", "error": { "type": "overloaded_error", "message": "Overloaded" } }))]));
        assert_eq!((overloaded.stop_reason, overloaded.error_code), ("error", Some("rate")));
        let failed = read_all("openai", &sse(&[(None, json!({ "type": "response.failed", "response": { "error": { "code": "context_length_exceeded", "message": "Your input exceeds the context window" } } }))]));
        assert_eq!((failed.stop_reason, failed.error_code), ("error", Some("context")));
        let rate = read_all("openai", &sse(&[(None, json!({ "type": "error", "code": "rate_limit_exceeded", "message": "slow" }))]));
        assert_eq!(rate.error_code, Some("rate"));
        let google = read_all("google", &sse(&[(None, json!({ "error": { "code": 500, "message": "Internal" } }))]));
        assert_eq!(google.error.as_deref(), Some("Google: Internal"));
        // A stream from OpenAI or Anthropic that ends without saying how was cut off.
        let cut = read_all("openai", &sse(&[(None, json!({ "type": "response.output_text.delta", "delta": "Half" }))]));
        assert_eq!(cut, AiResult::error("Half", "The answer from OpenAI was cut off.", "network"));
    }

    fn full_request(provider: &str) -> AiRequest {
        AiRequest {
            provider: provider.into(),
            system: Some("Be brief.".into()),
            messages: vec![
                Message { role: "user".into(), content: "Hi".into() },
                Message { role: "assistant".into(), content: "Hello!".into() },
                Message { role: "user".into(), content: "List two fruits".into() },
            ],
            max_tokens: Some(100),
            temperature: Some(0.4),
            json: true,
            ..Default::default()
        }
    }

    #[test]
    fn what_goes_to_openai() {
        let b = build_request("openai", &full_request("openai"), OPENAI_KEY, false).unwrap();
        assert_eq!(b.url, "https://api.openai.com/v1/responses");
        assert_eq!(b.headers, vec![("content-type", "application/json".to_string()), ("authorization", format!("Bearer {OPENAI_KEY}"))]);
        let body: Value = serde_json::from_str(&b.body).unwrap();
        assert_eq!(body["model"], json!(default_model("openai")));
        assert_eq!((body["stream"].clone(), body["store"].clone()), (json!(true), json!(false)));
        assert_eq!(body["text"], json!({ "format": { "type": "json_object" } }));
        assert_eq!(body["max_output_tokens"], json!(100 + 2048));
        let instructions = body["instructions"].as_str().unwrap();
        assert!(instructions.contains("Be brief.") && instructions.contains("JSON"));
        assert_eq!(body["input"], json!([{ "role": "user", "content": "Hi" }, { "role": "assistant", "content": "Hello!" }, { "role": "user", "content": "List two fruits" }]));
        assert!(body.get("temperature").is_none());
        let probe: Value = serde_json::from_str(&build_request("openai", &ask("openai"), OPENAI_KEY, true).unwrap().body).unwrap();
        assert_eq!((probe["stream"].clone(), probe["max_output_tokens"].clone()), (json!(false), json!(16)));
    }

    #[test]
    fn what_goes_to_anthropic() {
        let mut req = full_request("anthropic");
        req.model = Some("claude-haiku-5-5".into());
        let b = build_request("anthropic", &req, ANTHROPIC_KEY, false).unwrap();
        assert_eq!(b.url, "https://api.anthropic.com/v1/messages");
        assert_eq!(b.headers, vec![("content-type", "application/json".to_string()), ("x-api-key", ANTHROPIC_KEY.to_string()), ("anthropic-version", "2023-06-01".to_string())]);
        let body: Value = serde_json::from_str(&b.body).unwrap();
        assert_eq!((body["model"].clone(), body["stream"].clone(), body["max_tokens"].clone()), (json!("claude-haiku-5-5"), json!(true), json!(100 + 2048)));
        assert!(body["system"].as_str().unwrap().contains("Be brief."));
        assert!(body.get("temperature").is_none() && body.get("thinking").is_none());
        // Without maxTokens there's still a limit (Anthropic requires one).
        let plain: Value = serde_json::from_str(&build_request("anthropic", &ask("anthropic"), ANTHROPIC_KEY, false).unwrap().body).unwrap();
        assert!(plain["max_tokens"].as_u64().unwrap() > 0);
    }

    #[test]
    fn what_goes_to_google() {
        let b = build_request("google", &full_request("google"), GOOGLE_KEY, false).unwrap();
        assert_eq!(b.url, format!("https://generativelanguage.googleapis.com/v1beta/models/{}:streamGenerateContent?alt=sse", default_model("google")));
        assert!(!b.url.contains(GOOGLE_KEY));
        assert_eq!(b.headers, vec![("content-type", "application/json".to_string()), ("x-goog-api-key", GOOGLE_KEY.to_string())]);
        let body: Value = serde_json::from_str(&b.body).unwrap();
        let roles: Vec<&str> = body["contents"].as_array().unwrap().iter().map(|c| c["role"].as_str().unwrap()).collect();
        assert_eq!(roles, vec!["user", "model", "user"]);
        assert_eq!(body["generationConfig"], json!({ "temperature": 0.4, "maxOutputTokens": 100 + 2048, "responseMimeType": "application/json" }));
        assert!(body["systemInstruction"]["parts"][0]["text"].as_str().unwrap().contains("Be brief."));
        assert!(build_request("google", &ask("google"), GOOGLE_KEY, true).unwrap().url.ends_with(":generateContent"));
    }

    #[test]
    fn only_https_on_exactly_the_three_providers_hosts() {
        assert!(allowed_ai_url("https://api.openai.com/v1/responses", None));
        assert!(allowed_ai_url("https://api.anthropic.com/v1/messages", Some("anthropic")));
        assert!(allowed_ai_url("https://generativelanguage.googleapis.com/v1beta/models/x:streamGenerateContent?alt=sse", Some("google")));
        for bad in [
            "http://api.openai.com/v1/responses",
            "https://api.openai.com:8443/v1/responses",
            "https://user:pw@api.openai.com/v1/responses",
            "https://api.openai.com.evil.com/v1/responses",
            "https://evil.com/api.openai.com",
            "https://app.folevi.com/api/ai",
            "https://folevi.com/",
            "https://x.convex.cloud/",
            "wss://api.openai.com/",
            "app://folevi/",
            "not a url",
        ] {
            assert!(!allowed_ai_url(bad, None), "{bad}");
        }
        assert!(!allowed_ai_url("https://api.openai.com/v1/messages", Some("anthropic")));
    }

    #[test]
    fn a_crafted_model_id_cant_move_the_request() {
        for model in ["../x", "..", ".", "x?key=1", "x#y", "a/b", "models%2F..%2Fx", "x y", "", &"a".repeat(81), "https://evil.com"] {
            let mut req = json!({ "provider": "google", "messages": [{ "role": "user", "content": "Hello" }] });
            req["model"] = json!(model);
            assert!(check_request(&req).is_err(), "{model}");
            if !model.is_empty() {
                let mut r = ask("google");
                r.model = Some(model.to_string());
                assert!(build_request("google", &r, GOOGLE_KEY, false).is_err(), "{model}");
            }
        }
        let mut r = ask("google");
        r.model = Some("gemini-4-argon".into());
        let ok = build_request("google", &r, GOOGLE_KEY, false).unwrap();
        assert_eq!(Url::parse(&ok.url).unwrap().path(), "/v1beta/models/gemini-4-argon:streamGenerateContent");
    }

    #[test]
    fn a_good_request_passes_with_only_its_own_fields() {
        let r = check_request(&json!({ "provider": "openai", "model": "gpt-6-luna", "system": "s", "messages": [{ "role": "user", "content": "hi", "extra": 1 }], "maxTokens": 10, "temperature": 0, "json": true, "schema": { "type": "object" }, "other": "dropped" })).unwrap();
        assert_eq!(
            r,
            AiRequest {
                provider: "openai".into(),
                model: Some("gpt-6-luna".into()),
                system: Some("s".into()),
                messages: vec![Message { role: "user".into(), content: "hi".into() }],
                max_tokens: Some(10),
                temperature: Some(0.0),
                json: true,
                schema: Some(json!({ "type": "object" })),
            }
        );
        // 64 turns ending with the person's is fine.
        let turns: Vec<Value> = (0..64)
            .rev()
            .map(|i| {
                let role = if i % 2 == 1 { "assistant" } else { "user" };
                json!({ "role": role, "content": "x" })
            })
            .collect();
        assert!(check_request(&json!({ "provider": "openai", "messages": turns })).is_ok());
        assert!(check_request(&json!({ "provider": "openai", "messages": [{ "role": "user", "content": "x" }], "schema": null })).unwrap().schema.is_none());
    }

    #[test]
    fn everything_else_is_refused() {
        let m = json!([{ "role": "user", "content": "hi" }]);
        let many: Vec<Value> = (0..65).map(|_| json!({ "role": "user", "content": "x" })).collect();
        let bad = [
            Value::Null,
            json!("text"),
            json!([]),
            json!({ "messages": m }),
            json!({ "provider": "folevi", "messages": m }),
            json!({ "provider": "openai", "messages": [] }),
            json!({ "provider": "openai", "messages": many }),
            json!({ "provider": "openai", "messages": [{ "role": "system", "content": "x" }] }),
            json!({ "provider": "openai", "messages": [{ "role": "user", "content": 42 }] }),
            json!({ "provider": "openai", "messages": [{ "role": "user", "content": "a" }, { "role": "assistant", "content": "b" }] }),
            json!({ "provider": "openai", "messages": [{ "role": "user", "content": "x".repeat(400 * 1024 + 1) }] }),
            json!({ "provider": "openai", "system": "x".repeat(300 * 1024), "messages": [{ "role": "user", "content": "y".repeat(150 * 1024) }] }),
            json!({ "provider": "openai", "messages": m, "maxTokens": 0 }),
            json!({ "provider": "openai", "messages": m, "maxTokens": 32769 }),
            json!({ "provider": "openai", "messages": m, "maxTokens": 1.5 }),
            json!({ "provider": "openai", "messages": m, "temperature": -0.1 }),
            json!({ "provider": "openai", "messages": m, "temperature": 2.1 }),
            json!({ "provider": "openai", "messages": m, "temperature": null }),
            json!({ "provider": "openai", "messages": m, "json": "yes" }),
            json!({ "provider": "openai", "messages": m, "system": 5 }),
            json!({ "provider": "openai", "messages": m, "model": 7 }),
            json!({ "provider": "openai", "messages": m, "schema": { "big": "x".repeat(33 * 1024) } }),
        ];
        for b in &bad {
            assert!(check_request(b).is_err(), "{}", b.to_string().chars().take(120).collect::<String>());
        }
    }

    #[test]
    fn http_answers_map_to_codes_and_plain_words() {
        let err = |p: &str, status: u16, body: Value| http_error(p, status, &body.to_string(), "m");
        assert_eq!(err("openai", 401, json!({ "error": { "message": "Incorrect API key provided", "code": "invalid_api_key" } })), ("The OpenAI key was refused. Check it in Settings > Foli AI.".into(), Some("auth")));
        assert_eq!(err("anthropic", 403, json!({ "error": { "type": "permission_error", "message": "nope" } })).1, Some("auth"));
        let google = err("google", 400, json!({ "error": { "code": 400, "message": "API key not valid. Please pass a valid API key.", "status": "INVALID_ARGUMENT", "details": [{ "reason": "API_KEY_INVALID" }] } }));
        assert_eq!(google, ("The Google key was refused. Check it in Settings > Foli AI.".into(), Some("auth")));
        assert_eq!(err("openai", 429, json!({ "error": { "message": "Rate limit reached", "code": "rate_limit_exceeded" } })), ("OpenAI asked Foli AI to slow down. Try again in a moment.".into(), Some("rate")));
        assert_eq!(err("openai", 429, json!({ "error": { "message": "You exceeded your current quota", "code": "insufficient_quota" } })), ("The OpenAI account is out of credit or over its quota.".into(), Some("rate")));
        assert_eq!(err("openai", 400, json!({ "error": { "message": "Your input exceeds the context window of this model.", "code": "context_length_exceeded" } })).1, Some("context"));
        assert_eq!(err("anthropic", 400, json!({ "type": "error", "error": { "type": "invalid_request_error", "message": "prompt is too long: 1200000 tokens > 1000000 maximum" } })).1, Some("context"));
        assert_eq!(http_error("openai", 404, r#"{"error":{"message":"model not found"}}"#, "gpt-nope"), ("OpenAI doesn't offer the model \"gpt-nope\" to this key.".into(), Some("invalid")));
        assert_eq!(err("anthropic", 529, json!({ "error": { "type": "overloaded_error" } })).1, Some("unavailable"));
        assert_eq!(http_error("openai", 400, "not json", "m"), ("OpenAI refused the request (400)".into(), Some("invalid")));
        assert_eq!(err("openai", 418, json!({ "message": "teapot" })), ("OpenAI refused the request (418): teapot".into(), None));
    }

    #[test]
    fn keys_are_scrubbed() {
        assert_eq!(scrub(&format!("bad key {OPENAI_KEY}!"), Some(OPENAI_KEY)), "bad key [key]!");
        assert_eq!(scrub("echo sk-abcdefgh1234 and AIzaSyAAAAAAAAAAAAAAAAAAAAAA", None), "echo [key] and [key]");
        assert_eq!(scrub("sk-short", None), "sk-short");
        assert_eq!(scrub("custom-secret-value here", Some("custom-secret-value")), "[key] here");
    }

    // ---- against a server on this PC (no real network) ---------------------------------------------------

    struct Reply {
        head: String,
        pieces: Vec<Vec<u8>>,
        hang: bool,
    }

    fn reply(status: &str, content_type: &str, body: &str) -> Reply {
        Reply { head: format!("HTTP/1.1 {status}\r\ncontent-type: {content_type}\r\nconnection: close\r\n\r\n"), pieces: vec![body.as_bytes().to_vec()], hang: false }
    }

    fn streamed(body: &str, piece: usize) -> Reply {
        Reply { head: "HTTP/1.1 200 OK\r\ncontent-type: text/event-stream\r\nconnection: close\r\n\r\n".into(), pieces: body.as_bytes().chunks(piece).map(<[u8]>::to_vec).collect(), hang: false }
    }

    /// Serves one reply per connection; returns the origin and every request's raw text.
    async fn serve(mut replies: Vec<Reply>) -> (String, Arc<Mutex<Vec<String>>>) {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let origin = format!("http://127.0.0.1:{}", listener.local_addr().unwrap().port());
        let seen = Arc::new(Mutex::new(Vec::new()));
        let log = seen.clone();
        replies.reverse();
        tokio::spawn(async move {
            while let Some(r) = replies.pop() {
                let Ok((mut sock, _)) = listener.accept().await else { return };
                let mut got = Vec::new();
                let mut buf = vec![0u8; 16384];
                loop {
                    let text = String::from_utf8_lossy(&got).to_string();
                    if let Some(end) = text.find("\r\n\r\n") {
                        let length = text[..end].lines().find_map(|l| l.to_ascii_lowercase().strip_prefix("content-length:").map(|v| v.trim().parse::<usize>().unwrap_or(0))).unwrap_or(0);
                        if got.len() >= end + 4 + length {
                            break;
                        }
                    }
                    let n = sock.read(&mut buf).await.unwrap_or(0);
                    if n == 0 {
                        break;
                    }
                    got.extend_from_slice(&buf[..n]);
                }
                log.lock().push(String::from_utf8_lossy(&got).into_owned());
                let _ = sock.write_all(r.head.as_bytes()).await;
                for p in r.pieces {
                    let _ = sock.write_all(&p).await;
                    let _ = sock.flush().await;
                    tokio::time::sleep(Duration::from_millis(2)).await;
                }
                if r.hang {
                    tokio::spawn(async move {
                        tokio::time::sleep(Duration::from_secs(30)).await;
                        drop(sock);
                    });
                } else {
                    let _ = sock.shutdown().await;
                }
            }
        });
        (origin, seen)
    }

    struct Harness {
        ai: Arc<Ai>,
        _dir: tempfile::TempDir,
    }

    fn harness(origin: &str, keys: &[(&str, &str)], idle: Duration) -> Harness {
        let dir = tempfile::tempdir().unwrap();
        let secrets = Arc::new(SecretStore::new(dir.path().join("secrets"), Arc::new(Sealer::with_key([3; 32]))));
        for (name, value) in keys {
            secrets.set(name, value).unwrap();
        }
        Harness { ai: Arc::new(Ai::build(secrets, Some(origin.to_string()), idle)), _dir: dir }
    }

    fn all_keys() -> Vec<(&'static str, &'static str)> {
        vec![("ai.openai", OPENAI_KEY), ("ai.anthropic", ANTHROPIC_KEY), ("ai.google", GOOGLE_KEY)]
    }

    fn collector() -> (Emit, Arc<Mutex<Vec<(String, Value)>>>) {
        let got = Arc::new(Mutex::new(Vec::new()));
        let g = got.clone();
        (Arc::new(move |event: &str, payload: Value| g.lock().push((event.to_string(), payload))), got)
    }

    fn generate_call(id: &str, provider: &str) -> Value {
        json!({ "id": id, "req": { "provider": provider, "messages": [{ "role": "user", "content": "Hello" }] } })
    }

    #[tokio::test]
    async fn streams_each_piece_to_the_page_and_the_key_only_in_its_header() {
        for provider in KEY_PROVIDERS {
            let (origin, seen) = serve(vec![streamed(&stream_of(provider), 7)]).await;
            let h = harness(&origin, &all_keys(), IDLE);
            let (emit, events) = collector();
            let result = h.ai.call("aiGenerate", &generate_call("g1abc", provider), emit).await.unwrap();
            assert_eq!(result, json!({ "text": ANSWER, "stopReason": "end" }), "{provider}");
            let events = events.lock();
            assert!(events.iter().all(|(e, p)| e == "aiChunk" && p["id"] == "g1abc"));
            assert_eq!(events.iter().map(|(_, p)| p["text"].as_str().unwrap()).collect::<String>(), ANSWER);
            // The request: the provider's path, the key in exactly its header, never the address or body.
            let request = seen.lock()[0].clone();
            let (head, body) = request.split_once("\r\n\r\n").unwrap();
            let first = head.lines().next().unwrap();
            let key = key_of(provider);
            assert!(first.starts_with("POST /v1"), "{first}");
            assert!(!first.contains(key) && !body.contains(key));
            let carrying: Vec<String> = head.lines().filter(|l| l.contains(key)).map(|l| l.split(':').next().unwrap().to_ascii_lowercase()).collect();
            let header = match provider {
                "openai" => "authorization",
                "anthropic" => "x-api-key",
                _ => "x-goog-api-key",
            };
            assert_eq!(carrying, vec![header.to_string()]);
            assert!(!head.to_ascii_lowercase().contains("cookie"));
            assert!(h.ai.running.lock().is_empty());
        }
    }

    #[tokio::test]
    async fn cancel_ends_with_the_text_so_far() {
        let first = sse(&[(None, json!({ "type": "content_block_delta", "delta": { "type": "text_delta", "text": "Once upon" } }))]);
        let (origin, _) = serve(vec![Reply { hang: true, ..streamed(&first, 1000) }]).await;
        let h = harness(&origin, &all_keys(), IDLE);
        let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel();
        let emit: Emit = Arc::new(move |_: &str, p: Value| {
            let _ = tx.send(p);
        });
        let ai = h.ai.clone();
        let task = tokio::spawn(async move { ai.call("aiGenerate", &generate_call("g2", "anthropic"), emit).await });
        assert_eq!(rx.recv().await.unwrap()["text"], "Once upon");
        h.ai.call("aiCancel", &json!({ "id": "g2" }), crate::events::nowhere()).await.unwrap();
        let result = tokio::time::timeout(Duration::from_secs(5), task).await.unwrap().unwrap().unwrap();
        assert_eq!(result, json!({ "text": "Once upon", "stopReason": "cancelled" }));
        assert!(h.ai.running.lock().is_empty());
    }

    #[tokio::test]
    async fn a_stream_that_goes_quiet_counts_as_lost() {
        let (origin, _) = serve(vec![Reply { hang: true, ..streamed("", 1) }]).await;
        let h = harness(&origin, &all_keys(), Duration::from_millis(100));
        let r = h.ai.generate(&generate_call("g3", "openai"), crate::events::nowhere()).await;
        assert_eq!(r, AiResult::error("", "OpenAI stopped answering.", "network"));
    }

    #[tokio::test]
    async fn redirects_are_refused_never_followed() {
        let moved = Reply { head: "HTTP/1.1 307 Temporary Redirect\r\nlocation: https://evil.com/\r\ncontent-length: 0\r\nconnection: close\r\n\r\n".into(), pieces: vec![], hang: false };
        let (origin, seen) = serve(vec![moved]).await;
        let h = harness(&origin, &all_keys(), IDLE);
        let r = h.ai.generate(&generate_call("g4", "anthropic"), crate::events::nowhere()).await;
        assert_eq!(r, AiResult::error("", "Anthropic answered from somewhere else; Foli AI didn't follow.", "network"));
        assert_eq!(seen.lock().len(), 1);
    }

    #[tokio::test]
    async fn http_errors_missing_keys_and_echoed_keys() {
        let refused = reply("401 Unauthorized", "application/json", r#"{"error":{"message":"Incorrect API key provided","code":"invalid_api_key"}}"#);
        let echo = |key: &str| reply("400 Bad Request", "application/json", &json!({ "error": { "message": format!("Bad request for key {key}") } }).to_string());
        let in_stream = streamed(&sse(&[(None, json!({ "type": "error", "error": { "type": "api_error", "message": format!("oops {ANTHROPIC_KEY}") } }))]), 50);
        let (origin, seen) = serve(vec![refused, echo(OPENAI_KEY), echo(GOOGLE_KEY), in_stream, echo(ANTHROPIC_KEY), reply("200 OK", "application/json", "{}")]).await;
        let h = harness(&origin, &all_keys(), IDLE);
        let r = h.ai.generate(&generate_call("a", "openai"), crate::events::nowhere()).await;
        assert_eq!(r, AiResult::error("", "The OpenAI key was refused. Check it in Settings > Foli AI.", "auth"));
        let r = h.ai.generate(&generate_call("b", "openai"), crate::events::nowhere()).await;
        assert_eq!(r.stop_reason, "error");
        assert!(!r.to_json().to_string().contains(OPENAI_KEY));
        let r = h.ai.generate(&generate_call("c", "google"), crate::events::nowhere()).await;
        assert!(r.error.as_deref().unwrap().contains("[key]") && !r.to_json().to_string().contains(GOOGLE_KEY));
        let r = h.ai.generate(&generate_call("d", "anthropic"), crate::events::nowhere()).await;
        assert_eq!(r.error.as_deref(), Some("Anthropic: oops [key]"));
        let tested = h.ai.call("aiTestKey", &json!({ "provider": "anthropic" }), crate::events::nowhere()).await.unwrap();
        assert_eq!(tested["ok"], json!(false));
        assert!(!tested.to_string().contains(ANTHROPIC_KEY));
        assert_eq!(h.ai.call("aiTestKey", &json!({ "provider": "google" }), crate::events::nowhere()).await.unwrap(), json!({ "ok": true }));
        // The probe is one tiny request that doesn't stream.
        let probe = seen.lock().last().unwrap().clone();
        assert!(probe.starts_with("POST /v1beta/models/gemini-3.8-flash:generateContent HTTP/1.1"));
        assert!(probe.contains("\"maxOutputTokens\":8"));
        assert_eq!(seen.lock().len(), 6);

        // A missing key: nothing is sent.
        let none = harness(&origin, &[], IDLE);
        let r = none.ai.generate(&generate_call("e", "openai"), crate::events::nowhere()).await;
        assert_eq!(r, AiResult::error("", "Add your OpenAI key in Settings > Foli AI first.", "auth"));
        assert_eq!(none.ai.test_key("google").await, json!({ "ok": false, "error": "Add your Google key first." }));
        assert_eq!(none.ai.test_key("folevi").await, json!({ "ok": false, "error": "Foli AI can't use that provider." }));
        assert_eq!(seen.lock().len(), 6);
    }

    #[tokio::test]
    async fn a_server_that_isnt_there_is_a_network_error() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let origin = format!("http://127.0.0.1:{}", listener.local_addr().unwrap().port());
        drop(listener);
        let h = harness(&origin, &all_keys(), IDLE);
        let r = h.ai.generate(&generate_call("g5", "anthropic"), crate::events::nowhere()).await;
        assert_eq!(r, AiResult::error("", "Foli AI couldn't reach Anthropic. Check the connection.", "network"));
    }

    #[tokio::test]
    async fn the_pages_calls() {
        let h = harness("http://127.0.0.1:9", &[("ai.google", GOOGLE_KEY)], IDLE);
        let caps = h.ai.call("aiCapabilities", &json!({}), crate::events::nowhere()).await.unwrap();
        assert_eq!(caps, json!({ "onDevice": false, "onDeviceStatus": "notSupported", "keys": { "ai.openai": false, "ai.anthropic": false, "ai.google": true } }));
        assert!(!caps.to_string().contains(GOOGLE_KEY));
        let bad_id = h.ai.call("aiGenerate", &generate_call("bad id!", "google"), crate::events::nowhere()).await.unwrap();
        assert_eq!(bad_id, json!({ "text": "", "stopReason": "error", "error": "Not a request Foli AI can send.", "errorCode": "invalid" }));
        let bad_req = h.ai.call("aiGenerate", &json!({ "id": "x", "req": { "provider": "openai", "messages": [] } }), crate::events::nowhere()).await.unwrap();
        assert_eq!(bad_req["errorCode"], "invalid");
        let on_device = h.ai.call("aiGenerate", &generate_call("y", "on-device"), crate::events::nowhere()).await.unwrap();
        assert_eq!(on_device["errorCode"], "unavailable");
        // A request id that's already running is refused.
        let (tx, _rx) = watch::channel(false);
        h.ai.running.lock().insert("dup".into(), tx);
        let dup = h.ai.call("aiGenerate", &generate_call("dup", "google"), crate::events::nowhere()).await.unwrap();
        assert_eq!(dup["error"], "That request is already running.");
        assert_eq!(h.ai.call("aiCancel", &json!({ "id": "nothing" }), crate::events::nowhere()).await.unwrap(), Value::Null);
        assert!(h.ai.call("aiSomething", &json!({}), crate::events::nowhere()).await.is_err());
    }
}
