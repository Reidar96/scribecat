//! The desktop app as a client of a ScribeCat server.
//!
//! The webview cannot talk to a server the user typed in: its content
//! security policy confines `fetch` to the app itself, and the http plugin's
//! allowlist is fixed at build time. So the requests are made here, with the
//! same rule the filesystem follows: the frontend may only reach what the
//! user explicitly added (`allow_remote_vault_origin`, the counterpart of
//! `allow_folder_scope`). The allowlist is in memory and rebuilt by the
//! frontend at every start from its list of servers.
//!
//! TLS trusts the operating system's certificate store (`rustls` with native
//! roots), so a home server behind Caddy's own CA works as soon as that root
//! certificate is installed the way it is for the browser. There is no switch
//! to turn verification off.
//!
//! Live updates are a WebSocket to the server's event stream, kept here for
//! the same reason as the requests. It reports changes through the same event
//! as the native folder watcher, with the vault's virtual root as the folder
//! path, so the frontend cannot tell the two apart.

use std::{collections::HashSet, sync::Mutex, time::Duration};

#[cfg(any(target_os = "macos", test))]
use std::{
    collections::BTreeMap,
    fs::{self, OpenOptions},
    io::Write,
    path::Path,
};

#[cfg(all(target_os = "macos", unix))]
use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};

use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};
use tokio_tungstenite::tungstenite::{client::IntoClientRequest, http::HeaderValue, Error as WsError, Message};

use crate::{FolderWatchState, FOLDER_FILES_CHANGED_EVENT};

#[cfg(not(target_os = "macos"))]
use crate::KEYRING_SERVICE;

#[cfg(target_os = "macos")]
const REMOTE_TOKEN_FILE: &str = "remote-vault-tokens.json";

#[cfg(target_os = "macos")]
static REMOTE_TOKEN_FILE_LOCK: Mutex<()> = Mutex::new(());

/// Emitted with the vault root when the server refuses the token on the live
/// connection: the one moment an idle app learns that its key was revoked.
const REMOTE_VAULT_UNAUTHORIZED_EVENT: &str = "scribecat-remote-vault-unauthorized";

const RECONNECT_MIN: Duration = Duration::from_secs(1);
const RECONNECT_MAX: Duration = Duration::from_secs(30);

pub struct RemoteVaultState {
    allowed_origins: Mutex<HashSet<String>>,
    client: reqwest::Client,
    watch: Mutex<Option<tauri::async_runtime::JoinHandle<()>>>,
}

impl Default for RemoteVaultState {
    fn default() -> Self {
        Self {
            allowed_origins: Mutex::new(HashSet::new()),
            client: reqwest::Client::builder()
                .use_rustls_tls()
                .build()
                .expect("reqwest client"),
            watch: Mutex::new(None),
        }
    }
}

/// `scheme://host[:port]` with the default port left out, matching what the
/// frontend computes with `new URL(...).origin`.
fn origin_of(url: &reqwest::Url) -> String {
    url.origin().ascii_serialization()
}

fn ensure_allowed(state: &RemoteVaultState, url: &reqwest::Url) -> Result<(), String> {
    let origin = origin_of(url);
    let allowed = state
        .allowed_origins
        .lock()
        .map_err(|_| "allowlist poisoned".to_string())?;

    if allowed.contains(&origin) {
        Ok(())
    } else {
        Err(format!("{origin} is not a server this app was told about."))
    }
}

#[tauri::command]
pub fn allow_remote_vault_origin(state: State<'_, RemoteVaultState>, origin: String) -> Result<(), String> {
    let url = reqwest::Url::parse(&origin).map_err(|error| error.to_string())?;

    if !matches!(url.scheme(), "http" | "https") {
        return Err("Only http and https servers are supported.".to_string());
    }

    state
        .allowed_origins
        .lock()
        .map_err(|_| "allowlist poisoned".to_string())?
        .insert(origin_of(&url));

    Ok(())
}

#[derive(Deserialize)]
pub struct RemoteRequest {
    url: String,
    method: String,
    headers: Vec<(String, String)>,
    /// Base64 of the body bytes; the IPC would otherwise ship a byte array as
    /// a JSON list of numbers.
    body: Option<String>,
}

#[derive(Serialize)]
pub struct RemoteResponse {
    status: u16,
    headers: Vec<(String, String)>,
    /// Base64 of the body bytes.
    body: String,
}

#[tauri::command]
pub async fn remote_vault_request(
    state: State<'_, RemoteVaultState>,
    request: RemoteRequest,
) -> Result<RemoteResponse, String> {
    let url = reqwest::Url::parse(&request.url).map_err(|error| error.to_string())?;
    ensure_allowed(&state, &url)?;

    let method = reqwest::Method::from_bytes(request.method.as_bytes()).map_err(|error| error.to_string())?;
    let mut builder = state.client.request(method, url);

    for (name, value) in request.headers {
        builder = builder.header(name, value);
    }

    if let Some(body) = request.body {
        let bytes = BASE64.decode(body).map_err(|error| error.to_string())?;
        builder = builder.body(bytes);
    }

    let response = builder.send().await.map_err(|error| error.to_string())?;
    let status = response.status().as_u16();
    let headers = response
        .headers()
        .iter()
        .filter_map(|(name, value)| value.to_str().ok().map(|value| (name.to_string(), value.to_string())))
        .collect();
    let body = response.bytes().await.map_err(|error| error.to_string())?;

    Ok(RemoteResponse {
        status,
        headers,
        body: BASE64.encode(body),
    })
}

// Non-macOS desktop tokens live in the OS credential store. macOS Keychain
// access prompts for the login-keychain password when this unsigned build's
// identity changes, so macOS stores tokens in a private app-data file instead.
// The directory and file are restricted to the current user. Old Keychain
// entries are intentionally not read: the app asks the user to sign in to the
// server once, then saves the replacement token without a Keychain prompt.
#[cfg(not(target_os = "macos"))]
fn token_entry(vault_root: &str) -> Result<keyring::Entry, String> {
    let account = format!("remote-vault-token:{vault_root}");
    keyring::Entry::new(KEYRING_SERVICE, &account).map_err(|error| error.to_string())
}

#[cfg(any(target_os = "macos", test))]
fn read_token_map(path: &Path) -> Result<BTreeMap<String, String>, String> {
    match fs::read(path) {
        Ok(bytes) => serde_json::from_slice(&bytes).map_err(|error| error.to_string()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(BTreeMap::new()),
        Err(error) => Err(error.to_string()),
    }
}

#[cfg(any(target_os = "macos", test))]
fn write_token_map(path: &Path, tokens: &BTreeMap<String, String>) -> Result<(), String> {
    let parent = path.parent().ok_or_else(|| "Token store has no parent directory".to_string())?;
    fs::create_dir_all(parent).map_err(|error| error.to_string())?;

    #[cfg(all(target_os = "macos", unix))]
    fs::set_permissions(parent, fs::Permissions::from_mode(0o700)).map_err(|error| error.to_string())?;

    let temp_path = path.with_extension(format!("{}.json.tmp", std::process::id()));
    let mut options = OpenOptions::new();
    options.write(true).create(true).truncate(true);
    #[cfg(all(target_os = "macos", unix))]
    options.mode(0o600);

    let mut file = options.open(&temp_path).map_err(|error| error.to_string())?;
    #[cfg(all(target_os = "macos", unix))]
    file.set_permissions(fs::Permissions::from_mode(0o600))
        .map_err(|error| error.to_string())?;
    let bytes = serde_json::to_vec(tokens).map_err(|error| error.to_string())?;
    file.write_all(&bytes).map_err(|error| error.to_string())?;
    file.sync_all().map_err(|error| error.to_string())?;
    drop(file);
    fs::rename(temp_path, path).map_err(|error| error.to_string())
}

#[cfg(target_os = "macos")]
fn token_file_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("credentials");
    Ok(directory.join(REMOTE_TOKEN_FILE))
}

#[cfg(target_os = "macos")]
fn get_file_token(path: &Path, vault_root: &str) -> Result<Option<String>, String> {
    let _guard = REMOTE_TOKEN_FILE_LOCK.lock().map_err(|error| error.to_string())?;
    Ok(read_token_map(path)?.remove(vault_root))
}

#[cfg(target_os = "macos")]
fn set_file_token(path: &Path, vault_root: &str, token: Option<&str>) -> Result<(), String> {
    let _guard = REMOTE_TOKEN_FILE_LOCK.lock().map_err(|error| error.to_string())?;
    let mut tokens = read_token_map(path)?;
    if let Some(token) = token {
        tokens.insert(vault_root.to_string(), token.to_string());
    } else {
        tokens.remove(vault_root);
    }
    write_token_map(path, &tokens)
}

#[tauri::command]
pub fn store_remote_vault_token(app: AppHandle, vault_root: String, token: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        return set_file_token(&token_file_path(&app)?, &vault_root, Some(&token));
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
        token_entry(&vault_root)?.set_password(&token).map_err(|error| error.to_string())
    }
}

#[tauri::command]
pub fn get_remote_vault_token(app: AppHandle, vault_root: String) -> Result<Option<String>, String> {
    #[cfg(target_os = "macos")]
    {
        return get_file_token(&token_file_path(&app)?, &vault_root);
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
        match token_entry(&vault_root)?.get_password() {
            Ok(token) => Ok(Some(token)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(error) => Err(error.to_string()),
        }
    }
}

#[tauri::command]
pub fn delete_remote_vault_token(app: AppHandle, vault_root: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        return set_file_token(&token_file_path(&app)?, &vault_root, None);
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
        match token_entry(&vault_root)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(error) => Err(error.to_string()),
        }
    }
}

#[cfg(test)]
mod token_file_tests {
    use super::*;
    use std::{fs, path::PathBuf, sync::atomic::{AtomicU64, Ordering}};

    static NEXT_ID: AtomicU64 = AtomicU64::new(0);

    fn temp_file() -> PathBuf {
        std::env::temp_dir()
            .join(format!("scribecat-token-store-{}-{}", std::process::id(), NEXT_ID.fetch_add(1, Ordering::Relaxed)))
            .join("remote-vault-tokens.json")
    }

    #[test]
    fn token_map_persists_and_removes_per_server_entries() {
        let path = temp_file();
        let mut tokens = BTreeMap::new();
        tokens.insert("/@remote/one".to_string(), "secret-one".to_string());
        tokens.insert("/@remote/two".to_string(), "secret-two".to_string());

        write_token_map(&path, &tokens).unwrap();
        let mut loaded = read_token_map(&path).unwrap();
        assert_eq!(loaded.remove("/@remote/one").as_deref(), Some("secret-one"));
        assert_eq!(loaded.get("/@remote/two").map(String::as_str), Some("secret-two"));

        loaded.remove("/@remote/one");
        write_token_map(&path, &loaded).unwrap();
        assert_eq!(read_token_map(&path).unwrap().len(), 1);
        fs::remove_dir_all(path.parent().unwrap()).unwrap();
    }
}

/// Ends the live connection, if any. Also called by `watch_folder` when a
/// local folder takes over, so only one vault is ever watched.
pub fn stop_watch(state: &RemoteVaultState) {
    if let Ok(mut watch) = state.watch.lock() {
        if let Some(task) = watch.take() {
            task.abort();
        }
    }
}

fn is_files_changed(text: &str) -> bool {
    serde_json::from_str::<serde_json::Value>(text)
        .ok()
        .and_then(|value| value.get("type").and_then(|kind| kind.as_str()).map(|kind| kind == "files-changed"))
        .unwrap_or(false)
}

type WsStream = tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>;

/// One connection attempt; see `connect_tcp` for why the socket is opened by hand.
async fn connect(events_url: &str, request: tokio_tungstenite::tungstenite::handshake::client::Request) -> Result<WsStream, WsError> {
    let url = reqwest::Url::parse(events_url).map_err(|_| WsError::Url(tokio_tungstenite::tungstenite::error::UrlError::NoHostName))?;
    let stream = connect_tcp(&url).await?;
    let (stream, _) = tokio_tungstenite::client_async_tls(request, stream).await?;

    Ok(stream)
}

const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);

/// Opens the TCP connection for the handshake. Done by hand rather than by
/// `connect_async`, which tries the resolved addresses one after the other
/// with no time limit: on Windows "localhost" resolves to the IPv6 loopback
/// first, and a connection there can sit for seconds before it fails when
/// the server only listens on IPv4. IPv4 goes first here, and no address
/// gets more than `CONNECT_TIMEOUT`.
async fn connect_tcp(url: &reqwest::Url) -> Result<tokio::net::TcpStream, WsError> {
    let host = url
        .host_str()
        .ok_or(WsError::Url(tokio_tungstenite::tungstenite::error::UrlError::NoHostName))?;
    let port = url
        .port_or_known_default()
        .ok_or(WsError::Url(tokio_tungstenite::tungstenite::error::UrlError::UnsupportedUrlScheme))?;
    let mut addresses: Vec<std::net::SocketAddr> = tokio::net::lookup_host((host, port))
        .await
        .map_err(WsError::Io)?
        .collect();
    addresses.sort_by_key(|address| address.is_ipv6());

    let mut last_error = std::io::Error::new(std::io::ErrorKind::NotFound, "no address");

    for address in addresses {
        match tokio::time::timeout(CONNECT_TIMEOUT, tokio::net::TcpStream::connect(address)).await {
            Ok(Ok(stream)) => return Ok(stream),
            Ok(Err(error)) => last_error = error,
            Err(_) => {
                last_error = std::io::Error::new(std::io::ErrorKind::TimedOut, "connect timed out");
            }
        }
    }

    Err(WsError::Io(last_error))
}

async fn run_watch(app: AppHandle, vault_root: String, events_url: String, token: String) {
    let mut delay = RECONNECT_MIN;

    loop {
        // Rebuilt per attempt: the handshake consumes the request.
        let Ok(mut request) = events_url.as_str().into_client_request() else {
            return;
        };
        let Ok(authorization) = HeaderValue::from_str(&format!("Bearer {token}")) else {
            return;
        };
        request.headers_mut().insert("authorization", authorization);

        match connect(&events_url, request).await {
            Ok(stream) => {
                delay = RECONNECT_MIN;
                let (_, mut incoming) = stream.split();

                while let Some(message) = incoming.next().await {
                    match message {
                        Ok(Message::Text(text)) => {
                            if is_files_changed(&text) {
                                let _ = app.emit(FOLDER_FILES_CHANGED_EVENT, &vault_root);
                            }
                        }
                        Ok(Message::Close(_)) | Err(_) => break,
                        _ => {}
                    }
                }
            }
            // A refused upgrade means the token is gone (revoked, or the
            // password changed). Retrying would only repeat the answer; the
            // frontend asks for the password and starts a new watch.
            Err(WsError::Http(response)) if response.status() == 401 => {
                let _ = app.emit(REMOTE_VAULT_UNAUTHORIZED_EVENT, &vault_root);
                return;
            }
            Err(_) => {}
        }

        tokio::time::sleep(delay).await;
        delay = (delay * 2).min(RECONNECT_MAX);
    }
}

#[tauri::command]
pub fn watch_remote_vault(
    app: AppHandle,
    state: State<'_, RemoteVaultState>,
    folder_state: State<'_, FolderWatchState>,
    vault_root: String,
    events_url: String,
    token: String,
) -> Result<(), String> {
    let url = reqwest::Url::parse(&events_url).map_err(|error| error.to_string())?;

    // The allowlist is by origin, and the socket's origin is the server's
    // with the scheme swapped; check the http form the user added.
    let mut http_url = url.clone();
    let scheme = match url.scheme() {
        "wss" => "https",
        "ws" => "http",
        other => return Err(format!("Unsupported scheme {other}.")),
    };
    http_url.set_scheme(scheme).map_err(|_| "Unsupported scheme.".to_string())?;
    ensure_allowed(&state, &http_url)?;

    // Only one vault is open at a time: a local watcher, if any, ends here.
    if let Ok(mut watcher) = folder_state.watcher.lock() {
        watcher.take();
    }

    stop_watch(&state);

    let task = tauri::async_runtime::spawn(run_watch(app, vault_root, events_url, token));

    *state.watch.lock().map_err(|_| "watch state poisoned".to_string())? = Some(task);

    Ok(())
}
