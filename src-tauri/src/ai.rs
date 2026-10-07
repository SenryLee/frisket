//! AI 对话。请求走本进程，密钥不进前端包。
//!
//! 流式调用按 xAI 文档的 chat completions 示例：
//! POST {base}/chat/completions
//! { "model": "grok-4.7", "stream": true, "messages": [...] }
//! 增量在 choices[0].delta.content。

use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::watch;

const DEFAULT_BASE: &str = "https://api.x.ai/v1";
const DEFAULT_MODEL: &str = "grok-4.7";
const KEYCHAIN_SERVICE: &str = "com.frisket.md";
const LEGACY_KEYCHAIN_SERVICE: &str = "com.slate.md";
const KEYCHAIN_USER: &str = "api-key";

fn default_provider() -> String {
    "xai".to_string()
}

fn default_protocol() -> String {
    "openai".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AiSettings {
    base_url: String,
    model: String,
    #[serde(default = "default_provider")]
    provider: String,
    #[serde(default = "default_protocol")]
    protocol: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiSettingsView {
    base_url: String,
    model: String,
    provider: String,
    protocol: String,
    has_key: bool,
    /// keyring：钥匙串；file：本机文件降级；none：还没有密钥
    key_storage: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RewriteRequest {
    pub action: String,
    pub target: String,
    pub context: String,
    pub instruction: String,
}

#[derive(Debug, Deserialize)]
pub struct ChatTurn {
    role: String,
    content: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DeltaEvent {
    request_id: String,
    text: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DoneEvent {
    request_id: String,
}

fn cancels() -> &'static Mutex<HashMap<String, watch::Sender<bool>>> {
    static CANCELS: OnceLock<Mutex<HashMap<String, watch::Sender<bool>>>> = OnceLock::new();
    CANCELS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn http() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .timeout(Duration::from_secs(120))
            .build()
            .expect("无法创建 HTTP 客户端")
    })
}

#[tauri::command]
pub fn settings_get(app: AppHandle) -> AiSettingsView {
    let settings = read_settings(&app);
    AiSettingsView {
        base_url: settings.base_url,
        model: settings.model,
        provider: settings.provider,
        protocol: settings.protocol,
        has_key: !read_key(&app).is_empty(),
        key_storage: key_storage(&app),
    }
}

#[tauri::command]
pub fn settings_set(
    app: AppHandle,
    base_url: String,
    model: String,
    api_key: Option<String>,
    provider: Option<String>,
    protocol: Option<String>,
) -> Result<(), String> {
    let settings = AiSettings {
        base_url: normalize_base(&base_url)?,
        model: normalize_model(&model)?,
        provider: normalize_provider(provider.unwrap_or_else(default_provider))?,
        protocol: normalize_protocol(protocol.unwrap_or_else(default_protocol))?,
    };
    write_settings(&app, &settings)?;
    if let Some(key) = api_key {
        let trimmed = key.trim().to_string();
        if trimmed.is_empty() {
            delete_key(&app)?;
        } else {
            if trimmed.len() > 400 {
                return Err("密钥太长".to_string());
            }
            write_key(&app, &trimmed)?;
        }
    }
    Ok(())
}

#[tauri::command]
pub fn ai_cancel(request_id: String) {
    let mut map = cancels().lock().unwrap_or_else(|error| error.into_inner());
    if let Some(sender) = map.remove(&request_id) {
        let _ = sender.send(true);
    }
}

#[tauri::command]
pub async fn ai_chat(
    app: AppHandle,
    request_id: String,
    messages: Vec<ChatTurn>,
    rewrite: Option<RewriteRequest>,
) -> Result<(), String> {
    let settings = read_settings(&app);
    let key = read_key(&app);
    if key.is_empty() && !is_local_base(&settings.base_url) {
        return Err("no_key|请先在设置里填写 API 密钥".to_string());
    }
    let (turns, rewrite_mode) = prepare_turns(messages, rewrite)?;
    let (sender, mut cancel) = watch::channel(false);
    {
        let mut map = cancels().lock().unwrap_or_else(|error| error.into_inner());
        map.insert(request_id.clone(), sender);
    }

    let result = stream_chat(&app, &request_id, &settings, &key, &turns, rewrite_mode, &mut cancel).await;

    {
        let mut map = cancels().lock().unwrap_or_else(|error| error.into_inner());
        map.remove(&request_id);
    }
    result
}

async fn stream_chat(
    app: &AppHandle,
    request_id: &str,
    settings: &AiSettings,
    key: &str,
    turns: &[ChatTurn],
    rewrite: bool,
    cancel: &mut watch::Receiver<bool>,
) -> Result<(), String> {
    let pending = if settings.protocol == "anthropic" {
        let (system, messages) = split_anthropic(turns, rewrite);
        http()
            .post(messages_url(&settings.base_url))
            .header("x-api-key", key)
            .header("anthropic-version", "2023-06-01")
            .header("Content-Type", "application/json")
            .json(&json!({
                "model": settings.model,
                "max_tokens": 4096,
                "stream": true,
                "system": system,
                "messages": messages
            }))
            .send()
    } else {
        let mut request = http()
            .post(completions_url(&settings.base_url))
            .header("Content-Type", "application/json")
            .json(&json!({
                "messages": message_body(turns, rewrite),
                "model": settings.model,
                "stream": true
            }));
        if !key.is_empty() {
            request = request.bearer_auth(key);
        }
        request.send()
    };

    let response = tokio::select! {
        _ = cancel.changed() => {
            let _ = app.emit("ai:done", DoneEvent { request_id: request_id.to_string() });
            return Ok(());
        }
        response = tokio::time::timeout(Duration::from_secs(30), pending) => {
            match response {
                Ok(Ok(response)) => response,
                Ok(Err(_)) => return Err("network|连不上接口".to_string()),
                Err(_) => return Err("network|等待接口响应超时".to_string()),
            }
        }
    };

    let status = response.status();
    if !status.is_success() {
        let raw = response.text().await.unwrap_or_default();
        return Err(http_error(status.as_u16(), &raw));
    }

    let mut stream = response.bytes_stream();
    let mut buffer = String::new();
    let mut saw_event = false;

    loop {
        tokio::select! {
            changed = cancel.changed() => {
                if changed.is_ok() && *cancel.borrow() {
                    let _ = app.emit("ai:done", DoneEvent { request_id: request_id.to_string() });
                    return Ok(());
                }
            }
            chunk = tokio::time::timeout(Duration::from_secs(60), stream.next()) => {
                let chunk = match chunk {
                    Ok(chunk) => chunk,
                    Err(_) => return Err("network|回复中断，超过 60 秒没有新内容".to_string()),
                };
                let Some(chunk) = chunk else { break };
                let bytes = chunk.map_err(|_| "network|读取回复时连接中断".to_string())?;
                buffer.push_str(&String::from_utf8_lossy(&bytes));
                let (done, pieces) = drain_sse(&mut buffer).map_err(|message| {
                    format!("unknown|{message}")
                })?;
                for text in pieces {
                    saw_event = true;
                    let _ = app.emit(
                        "ai:delta",
                        DeltaEvent {
                            request_id: request_id.to_string(),
                            text,
                        },
                    );
                }
                if done {
                    let _ = app.emit("ai:done", DoneEvent { request_id: request_id.to_string() });
                    return Ok(());
                }
            }
        }
    }

    let leftover = buffer.trim().to_string();
    if !saw_event && leftover.starts_with('{') && !leftover.starts_with("data:") {
        return Err("not_streaming|接口没有按流式返回".to_string());
    }
    if !leftover.is_empty() {
        buffer.push('\n');
        let (done, pieces) = drain_sse(&mut buffer).map_err(|message| format!("unknown|{message}"))?;
        for text in pieces {
            saw_event = true;
            let _ = app.emit(
                "ai:delta",
                DeltaEvent {
                    request_id: request_id.to_string(),
                    text,
                },
            );
        }
        if done {
            saw_event = true;
        }
    }

    if !saw_event {
        let trimmed = buffer.trim();
        if trimmed.starts_with('{') {
            return Err("not_streaming|接口没有按流式返回".to_string());
        }
        if !trimmed.is_empty() {
            return Err("unknown|没有收到可读的回复".to_string());
        }
    }
    let _ = app.emit("ai:done", DoneEvent { request_id: request_id.to_string() });
    Ok(())
}

const CHAT_SYSTEM: &str = "You are Grok, a helpful and useful AI built by xAI. You are helping inside a local Markdown editor. Reply in the user's language. Be concise, and do not repeat the whole document.";

const REWRITE_SYSTEM: &str = "你只能输出 <target> 标签内文本的替换版本。\n1. 绝不输出 <target> 之外的任何内容\n2. 绝不添加解释、前言、结语、代码块围栏\n3. 保持原有 Markdown 语法结构不被破坏\n4. <context> 仅供理解上下文，绝对不可修改或复述";

fn message_body(turns: &[ChatTurn], rewrite: bool) -> Vec<serde_json::Value> {
    let mut messages = Vec::new();
    if !rewrite {
        messages.push(json!({ "role": "system", "content": CHAT_SYSTEM }));
    }
    for turn in turns {
        messages.push(json!({ "role": turn.role, "content": turn.content }));
    }
    messages
}

fn split_anthropic(turns: &[ChatTurn], rewrite: bool) -> (String, Vec<serde_json::Value>) {
    let mut system = Vec::new();
    if !rewrite {
        system.push(CHAT_SYSTEM.to_string());
    }
    let mut messages = Vec::new();
    for turn in turns {
        if turn.role == "system" {
            system.push(turn.content.clone());
        } else {
            messages.push(json!({ "role": turn.role, "content": turn.content }));
        }
    }
    (system.join("\n\n"), messages)
}

fn prepare_turns(
    messages: Vec<ChatTurn>,
    rewrite: Option<RewriteRequest>,
) -> Result<(Vec<ChatTurn>, bool), String> {
    let Some(request) = rewrite else {
        return Ok((sanitize_messages(messages)?, false));
    };
    let target = request.target.trim();
    if target.is_empty() {
        return Err("unknown|没有要改写的内容".to_string());
    }
    if request.target.chars().count() > 8_000 {
        return Err("too_long|划选的内容太长".to_string());
    }
    let context = clip_chars(request.context.trim(), 800);
    let instruction = clip_chars(request.instruction.trim(), 500);
    Ok((
        vec![
            ChatTurn {
                role: "system".to_string(),
                content: REWRITE_SYSTEM.to_string(),
            },
            ChatTurn {
                role: "user".to_string(),
                content: rewrite_user(request.action.trim(), target, &context, &instruction),
            },
        ],
        true,
    ))
}

fn rewrite_user(action: &str, target: &str, context: &str, instruction: &str) -> String {
    let verb = match action {
        "shorten" => "精简",
        "continue" => "续写",
        "expand" => "扩写",
        "custom" => "按补充要求改写",
        _ => "润色",
    };
    let extra = if instruction.is_empty() {
        String::new()
    } else {
        format!("\n补充要求：{instruction}")
    };
    format!("动作：{verb}{extra}\n<context>\n{context}\n</context>\n<target>\n{target}\n</target>")
}

fn clip_chars(text: &str, max: usize) -> String {
    if text.chars().count() <= max {
        text.to_string()
    } else {
        text.chars().take(max).collect()
    }
}

fn sanitize_messages(messages: Vec<ChatTurn>) -> Result<Vec<ChatTurn>, String> {
    if messages.is_empty() {
        return Err("unknown|没有要发送的内容".to_string());
    }
    if messages.len() > 40 {
        return Err("too_long|对话太长了，请新开一轮".to_string());
    }
    let mut total = 0usize;
    let mut clean = Vec::with_capacity(messages.len());
    for turn in messages {
        let role = match turn.role.as_str() {
            "system" | "user" | "assistant" => turn.role,
            _ => return Err("unknown|消息角色不合法".to_string()),
        };
        if turn.content.chars().count() > 16_000 {
            return Err("too_long|单条消息太长".to_string());
        }
        total += turn.content.len();
        if total > 48_000 {
            return Err("too_long|这次发送的内容太长".to_string());
        }
        clean.push(ChatTurn {
            role,
            content: turn.content,
        });
    }
    Ok(clean)
}

fn http_error(status: u16, body: &str) -> String {
    let detail = error_message(body);
    if status == 401 || status == 403 {
        return format!("no_key|密钥被拒绝（{status}）{detail}");
    }
    if status == 429 {
        return format!("rate_limited|请求太频繁，稍后再试{detail}");
    }
    format!("unknown|接口返回 {status}{detail}")
}

fn error_message(body: &str) -> String {
    let Ok(value) = serde_json::from_str::<serde_json::Value>(body) else {
        return String::new();
    };
    let message = value
        .get("error")
        .and_then(|error| error.get("message"))
        .and_then(|message| message.as_str())
        .unwrap_or("");
    if message.is_empty() {
        String::new()
    } else {
        format!("：{}", message.chars().take(180).collect::<String>())
    }
}

/// 从 SSE 缓冲里取出完整行。返回是否遇到 [DONE]，以及正文增量。
fn drain_sse(buffer: &mut String) -> Result<(bool, Vec<String>), String> {
    let mut pieces = Vec::new();
    let mut done = false;
    while let Some(index) = buffer.find('\n') {
        let line: String = buffer.drain(..=index).collect();
        let line = line.trim_end_matches(['\n', '\r']);
        let Some(data) = line.strip_prefix("data:") else {
            continue;
        };
        let data = data.trim();
        if data.is_empty() {
            continue;
        }
        match stream_signal(data)? {
            Signal::Done => {
                done = true;
                break;
            }
            Signal::Ignore => {}
            Signal::Text(text) => pieces.push(text),
        }
    }
    Ok((done, pieces))
}

#[derive(Debug)]
enum Signal {
    Text(String),
    Done,
    Ignore,
}

/// OpenAI 的 data 行、[DONE]，以及 Anthropic 的 content_block_delta / message_stop。
fn stream_signal(data: &str) -> Result<Signal, String> {
    if data == "[DONE]" {
        return Ok(Signal::Done);
    }
    let value: serde_json::Value = serde_json::from_str(data)
        .map_err(|_| "回复里有一段无法解析的内容".to_string())?;
    if let Some(message) = value
        .pointer("/error/message")
        .and_then(|item| item.as_str())
    {
        let owned: String = message.chars().take(180).collect();
        return Err(if owned.is_empty() {
            "接口返回了错误".to_string()
        } else {
            owned
        });
    }
    match value.get("type").and_then(|item| item.as_str()) {
        Some("message_stop") => return Ok(Signal::Done),
        Some("content_block_delta") => {
            let text = value
                .pointer("/delta/text")
                .and_then(|item| item.as_str())
                .unwrap_or("");
            return Ok(if text.is_empty() {
                Signal::Ignore
            } else {
                Signal::Text(text.to_string())
            });
        }
        _ => {}
    }
    let content = value
        .pointer("/choices/0/delta/content")
        .and_then(|item| item.as_str())
        .unwrap_or("");
    if content.is_empty() {
        Ok(Signal::Ignore)
    } else {
        Ok(Signal::Text(content.to_string()))
    }
}

fn completions_url(base: &str) -> String {
    if base.ends_with("/chat/completions") {
        base.to_string()
    } else {
        format!("{base}/chat/completions")
    }
}

fn messages_url(base: &str) -> String {
    if base.ends_with("/messages") {
        base.to_string()
    } else {
        format!("{base}/messages")
    }
}

fn is_local_base(base: &str) -> bool {
    reqwest::Url::parse(base)
        .ok()
        .and_then(|url| {
            url.host_str()
                .map(|host| host == "localhost" || host == "127.0.0.1")
        })
        .unwrap_or(false)
}

fn ollama_tags_url(base: &str) -> Option<String> {
    let url = reqwest::Url::parse(base).ok()?;
    let host = url.host_str()?;
    if host != "localhost" && host != "127.0.0.1" {
        return None;
    }
    let port = url.port().unwrap_or(11434);
    Some(format!("http://{host}:{port}/api/tags"))
}

fn normalize_base(raw: &str) -> Result<String, String> {
    let trimmed = raw.trim().trim_end_matches('/');
    if trimmed.is_empty() || trimmed.len() > 200 {
        return Err("接口地址不对".to_string());
    }
    let url = reqwest::Url::parse(trimmed).map_err(|_| "接口地址需要是完整链接".to_string())?;
    let local = url
        .host_str()
        .is_some_and(|host| host == "localhost" || host == "127.0.0.1");
    match url.scheme() {
        "https" => {}
        "http" if local => {}
        _ => return Err("只接受 https 接口，或本机的 http".to_string()),
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err("不要把密钥写进地址里".to_string());
    }
    Ok(trimmed.to_string())
}

fn normalize_provider(raw: String) -> Result<String, String> {
    let id = raw.trim();
    if id.is_empty()
        || id.len() > 40
        || !id
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || ch == '-' || ch == '_')
    {
        return Err("厂商不对".to_string());
    }
    Ok(id.to_string())
}

fn normalize_protocol(raw: String) -> Result<String, String> {
    match raw.trim() {
        "openai" => Ok("openai".to_string()),
        "anthropic" => Ok("anthropic".to_string()),
        _ => Err("协议只支持 openai 或 anthropic".to_string()),
    }
}

fn normalize_model(raw: &str) -> Result<String, String> {
    let model = raw.trim();
    if model.is_empty() || model.chars().count() > 80 || model.chars().any(char::is_whitespace) {
        return Err("模型名不能为空，也不能带空格".to_string());
    }
    Ok(model.to_string())
}

fn read_settings(app: &AppHandle) -> AiSettings {
    let Ok(file) = settings_file(app) else {
        return default_settings();
    };
    let Ok(raw) = fs::read_to_string(file) else {
        return default_settings();
    };
    serde_json::from_str(&raw).unwrap_or_else(|_| default_settings())
}

fn write_settings(app: &AppHandle, settings: &AiSettings) -> Result<(), String> {
    let file = settings_file(app)?;
    if let Some(parent) = file.parent() {
        fs::create_dir_all(parent).map_err(|error| format!("无法创建设置目录：{error}"))?;
    }
    let raw = serde_json::to_string_pretty(settings).map_err(|error| error.to_string())?;
    let temporary = file.with_extension("json.tmp");
    fs::write(&temporary, raw).map_err(|error| format!("无法写入设置：{error}"))?;
    fs::rename(&temporary, &file).map_err(|error| format!("无法保存设置：{error}"))?;
    Ok(())
}

fn default_settings() -> AiSettings {
    AiSettings {
        base_url: DEFAULT_BASE.to_string(),
        model: DEFAULT_MODEL.to_string(),
        provider: default_provider(),
        protocol: default_protocol(),
    }
}

fn keyring_secret(service: &str) -> Option<String> {
    keyring::Entry::new(service, KEYCHAIN_USER)
        .ok()
        .and_then(|entry| entry.get_password().ok())
        .map(|secret| secret.trim().to_string())
        .filter(|secret| !secret.is_empty())
}

fn key_storage(app: &AppHandle) -> String {
    let in_keyring =
        keyring_secret(KEYCHAIN_SERVICE).is_some() || keyring_secret(LEGACY_KEYCHAIN_SERVICE).is_some();
    if in_keyring {
        return "keyring".to_string();
    }
    let in_file = key_file(app)
        .ok()
        .and_then(|file| fs::read_to_string(file).ok())
        .is_some_and(|secret| !secret.trim().is_empty());
    if in_file {
        "file".to_string()
    } else {
        "none".to_string()
    }
}

#[tauri::command]
pub async fn ai_list_models(app: AppHandle) -> Result<Vec<String>, String> {
    let settings = read_settings(&app);
    if !is_local_base(&settings.base_url) {
        return Err("只有本机接口可以在这里列出模型".to_string());
    }
    let ollama = settings.provider == "ollama" || settings.base_url.contains("11434");
    let url = if ollama {
        ollama_tags_url(&settings.base_url).ok_or_else(|| "本机地址不对".to_string())?
    } else {
        format!("{}/models", settings.base_url.trim_end_matches('/'))
    };
    let response = http()
        .get(url)
        .send()
        .await
        .map_err(|_| "network|读不到本机模型".to_string())?;
    if !response.status().is_success() {
        return Err(format!("unknown|模型列表返回 {}", response.status().as_u16()));
    }
    let value: serde_json::Value = response
        .json()
        .await
        .map_err(|_| "unknown|模型列表无法解析".to_string())?;
    let mut names = Vec::new();
    if let Some(models) = value.get("models").and_then(|item| item.as_array()) {
        for model in models {
            if let Some(name) = model.get("name").and_then(|item| item.as_str()) {
                names.push(name.to_string());
            }
        }
    }
    if let Some(data) = value.get("data").and_then(|item| item.as_array()) {
        for model in data {
            if let Some(name) = model.get("id").and_then(|item| item.as_str()) {
                names.push(name.to_string());
            }
        }
    }
    names.sort();
    names.dedup();
    if names.is_empty() {
        return Err("unknown|没有列出模型".to_string());
    }
    Ok(names)
}

fn settings_file(app: &AppHandle) -> Result<PathBuf, String> {
    data_dir(app).map(|dir| dir.join("ai-settings.json"))
}

fn key_file(app: &AppHandle) -> Result<PathBuf, String> {
    data_dir(app).map(|dir| dir.join("api-key"))
}

fn data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("找不到数据目录：{error}"))?;
    fs::create_dir_all(&dir).map_err(|error| format!("无法创建数据目录：{error}"))?;
    Ok(dir)
}

fn read_key(app: &AppHandle) -> String {
    if let Some(secret) = keyring_secret(KEYCHAIN_SERVICE) {
        return secret;
    }
    if let Some(secret) = keyring_secret(LEGACY_KEYCHAIN_SERVICE) {
        if let Ok(entry) = keyring::Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_USER) {
            let _ = entry.set_password(&secret);
        }
        return secret;
    }
    key_file(app)
        .ok()
        .and_then(|file| fs::read_to_string(file).ok())
        .map(|secret| secret.trim().to_string())
        .filter(|secret| !secret.is_empty())
        .unwrap_or_default()
}

fn write_key(app: &AppHandle, key: &str) -> Result<(), String> {
    let file = key_file(app)?;
    fs::write(&file, key).map_err(|error| format!("无法保存密钥：{error}"))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&file, fs::Permissions::from_mode(0o600));
    }
    if let Ok(entry) = keyring::Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_USER) {
        let _ = entry.set_password(key);
    }
    if let Ok(entry) = keyring::Entry::new(LEGACY_KEYCHAIN_SERVICE, KEYCHAIN_USER) {
        let _ = entry.delete_credential();
    }
    Ok(())
}

fn delete_key(app: &AppHandle) -> Result<(), String> {
    if let Ok(file) = key_file(app) {
        if file.exists() {
            fs::remove_file(file).map_err(|error| format!("无法删除密钥：{error}"))?;
        }
    }
    if let Ok(entry) = keyring::Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_USER) {
        let _ = entry.delete_credential();
    }
    if let Ok(entry) = keyring::Entry::new(LEGACY_KEYCHAIN_SERVICE, KEYCHAIN_USER) {
        let _ = entry.delete_credential();
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{
        completions_url, drain_sse, messages_url, normalize_base, normalize_model, normalize_protocol,
        rewrite_user, stream_signal, Signal,
    };

    #[test]
    fn completions_url_appends_once() {
        assert_eq!(
            completions_url("https://api.x.ai/v1"),
            "https://api.x.ai/v1/chat/completions"
        );
        assert_eq!(
            completions_url("https://api.x.ai/v1/chat/completions"),
            "https://api.x.ai/v1/chat/completions"
        );
    }

    #[test]
    fn content_delta_reads_documented_chunk() {
        let data = r#"{"choices":[{"index":0,"delta":{"content":"Ah","role":"assistant"}}]}"#;
        match stream_signal(data).unwrap() {
            Signal::Text(text) => assert_eq!(text, "Ah"),
            other => panic!("expected text, got signal {other:?}"),
        }
    }

    #[test]
    fn content_delta_ignores_reasoning_only_chunk() {
        let data = r#"{"choices":[{"delta":{"reasoning_content":"The","role":"assistant"}}]}"#;
        assert!(matches!(stream_signal(data).unwrap(), Signal::Ignore));
    }

    #[test]
    fn anthropic_delta_and_stop() {
        let delta = r#"{"type":"content_block_delta","delta":{"type":"text_delta","text":"好"}}"#;
        match stream_signal(delta).unwrap() {
            Signal::Text(text) => assert_eq!(text, "好"),
            other => panic!("expected text, got {other:?}"),
        }
        assert!(matches!(
            stream_signal(r#"{"type":"message_stop"}"#).unwrap(),
            Signal::Done
        ));
        assert!(stream_signal(r#"{"error":{"message":"bad key"}}"#).is_err());
    }

    #[test]
    fn rewrite_prompt_keeps_target_and_context_apart() {
        let prompt = rewrite_user("shorten", "目标", "上下文参考", "");
        assert!(prompt.contains("动作：精简"));
        assert!(prompt.contains("<context>\n上下文参考\n</context>"));
        assert!(prompt.contains("<target>\n目标\n</target>"));
        assert_eq!(messages_url("https://api.anthropic.com/v1"), "https://api.anthropic.com/v1/messages");
        assert!(normalize_protocol("anthropic".to_string()).is_ok());
        assert!(normalize_protocol("other".to_string()).is_err());
    }

    #[test]
    fn drain_stops_on_done() {
        let mut buffer = "data: {\"choices\":[{\"delta\":{\"content\":\"Hi\"}}]}\n\ndata: [DONE]\n".to_string();
        let (done, pieces) = drain_sse(&mut buffer).unwrap();
        assert!(done);
        assert_eq!(pieces, vec!["Hi".to_string()]);
    }

    #[test]
    fn base_url_rejects_secrets_in_the_address() {
        assert!(normalize_base("https://api.x.ai/v1").is_ok());
        assert!(normalize_base("http://localhost:11434/v1").is_ok());
        assert!(normalize_base("http://example.com/v1").is_err());
        assert!(normalize_base("https://user:secret@api.x.ai/v1").is_err());
    }

    #[test]
    fn model_rejects_blank_and_spaces() {
        assert_eq!(normalize_model(" grok-4.7 ").unwrap(), "grok-4.7");
        assert!(normalize_model("grok 4").is_err());
        assert!(normalize_model("").is_err());
    }
}
