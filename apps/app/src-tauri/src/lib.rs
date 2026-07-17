#[cfg(desktop)]
use keyring::{Entry, Error as KeyringError};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::{
  fs,
  io::{Read, Write},
  net::TcpListener,
  path::{Path, PathBuf},
  sync::{mpsc, Mutex},
  thread,
  time::{Duration, Instant},
};
use tauri::{AppHandle, Manager, Runtime, State};
#[cfg(desktop)]
use tauri::{WebviewWindow, WebviewWindowBuilder};
use tauri_plugin_log::{Target, TargetKind};
#[cfg(desktop)]
use tauri_plugin_window_state::{StateFlags, WindowExt};

const DESKTOP_DATA_DIRECTORY: &str = "data";
const DESKTOP_SETTINGS_DIRECTORY: &str = "settings";
const DESKTOP_WEBVIEW_DIRECTORY: &str = "webview";
const DESKTOP_CACHE_DIRECTORY: &str = "cache";
const GOOGLE_DESKTOP_LOOPBACK_PATH: &str = "/";
const GOOGLE_DESKTOP_LEGACY_LOOPBACK_PATH: &str = "/oauth/google-drive";
const GOOGLE_DESKTOP_LOOPBACK_BIND_HOST: &str = "127.0.0.1";
const GOOGLE_DESKTOP_LOOPBACK_REDIRECT_HOST: &str = "localhost";
const GOOGLE_DESKTOP_LOOPBACK_LISTENER_TIMEOUT_SECS: u64 = 190;
const GOOGLE_OAUTH_HTTP_TIMEOUT_SECS: u64 = 30;
const GOOGLE_OAUTH_TOKEN_URL: &str = "https://oauth2.googleapis.com/token";
const GOOGLE_OAUTH_REVOKE_URL: &str = "https://oauth2.googleapis.com/revoke";

#[derive(Default)]
struct DesktopGoogleOauthState {
  callback_receiver: Mutex<Option<mpsc::Receiver<DesktopGoogleOauthCallbackPayload>>>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DesktopGoogleOauthLoopbackSession {
  redirect_uri: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DesktopGoogleOauthCallbackPayload {
  url: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DesktopGoogleOauthExchangeCodeInput {
  client_id: String,
  code: String,
  code_verifier: String,
  redirect_uri: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DesktopGoogleOauthRefreshTokenInput {
  client_id: String,
  refresh_token: String,
}

#[derive(Clone, Serialize, Deserialize)]
struct DesktopGoogleOauthTokenResponse {
  access_token: Option<String>,
  expires_in: Option<u64>,
  refresh_token: Option<String>,
  error: Option<String>,
}

#[cfg(target_os = "android")]
mod android_bridge {
  use serde::de::DeserializeOwned;
  use serde_json::Value;
  use tauri::{
    plugin::{PluginHandle, TauriPlugin},
    AppHandle, Manager, Runtime,
  };

  const PLUGIN_IDENTIFIER: &str = "com.locoris.android";

  pub struct LocorisAndroidPlugin<R: Runtime>(PluginHandle<R>);

  pub fn init<R: Runtime>() -> TauriPlugin<R> {
    tauri::plugin::Builder::new("locorisAndroid")
      .setup(|app, api| {
        let handle = api.register_android_plugin(PLUGIN_IDENTIFIER, "LocorisAndroidPlugin")?;
        app.manage(LocorisAndroidPlugin(handle));
        Ok(())
      })
      .build()
  }

  pub fn run<R, T>(app: &AppHandle<R>, command: &str, payload: Value) -> Result<T, String>
  where
    R: Runtime,
    T: DeserializeOwned,
  {
    let plugin = app.state::<LocorisAndroidPlugin<R>>();
    plugin
      .inner()
      .0
      .run_mobile_plugin(command, payload)
      .map_err(|error| error.to_string())
  }
}

#[cfg(desktop)]
fn secure_secret_service_name(identifier: &str) -> String {
  let normalized_identifier = if identifier.trim().is_empty() {
    "com.locoris.desktop"
  } else {
    identifier.trim()
  };

  format!("{normalized_identifier}.secure-secrets")
}

#[cfg(desktop)]
fn sanitize_secure_secret_key(key: &str) -> Result<String, String> {
  let normalized_key = key.trim();

  if normalized_key.is_empty() {
    return Err("secure secret key is required".into());
  }

  Ok(normalized_key.to_string())
}

#[cfg(desktop)]
fn open_secure_secret_entry<R: Runtime>(app: &AppHandle<R>, key: &str) -> Result<Entry, String> {
  Entry::new(
    &secure_secret_service_name(&app.config().identifier),
    &sanitize_secure_secret_key(key)?,
  )
  .map_err(|error| format!("failed to create secure secret entry: {error}"))
}

fn sanitize_vault_path_segment(local_vault_id: &str) -> String {
  let sanitized: String = local_vault_id
    .trim()
    .chars()
    .map(|character| {
      if character.is_ascii_alphanumeric() || character == '_' || character == '-' {
        character
      } else {
        '_'
      }
    })
    .collect();

  if sanitized.is_empty() {
    "local-default".into()
  } else {
    sanitized
  }
}

#[cfg(any(target_os = "windows", target_os = "macos"))]
fn sanitize_runtime_version_token(version: &str) -> String {
  let trimmed = version.trim();

  if trimmed.is_empty() {
    return "dev".into();
  }

  trimmed
    .chars()
    .map(|character| {
      if character.is_ascii_alphanumeric() || matches!(character, '.' | '_' | '-') {
        character
      } else {
        '_'
      }
    })
    .collect()
}

#[cfg(target_os = "windows")]
fn build_runtime_version_token(identifier: &str, version: &str) -> String {
  let normalized_identifier = if identifier.trim().is_empty() {
    "com.locoris.desktop"
  } else {
    identifier.trim()
  };

  format!(
    "{}-{}",
    normalized_identifier,
    sanitize_runtime_version_token(version)
  )
  .chars()
  .map(|character| {
    if character.is_ascii_alphanumeric() || matches!(character, '.' | '_' | '-') {
      character
    } else {
      '_'
    }
  })
  .collect()
}

#[cfg(target_os = "macos")]
fn fnv1a32(input: &str, seed: u32) -> u32 {
  let mut hash = seed;

  for byte in input.as_bytes() {
    hash ^= *byte as u32;
    hash = hash.wrapping_mul(0x0100_0193);
  }

  hash
}

#[cfg(target_os = "macos")]
fn u32_to_bytes(value: u32) -> [u8; 4] {
  [
    (value & 0xff) as u8,
    ((value >> 8) & 0xff) as u8,
    ((value >> 16) & 0xff) as u8,
    ((value >> 24) & 0xff) as u8,
  ]
}

#[cfg(target_os = "macos")]
fn build_macos_data_store_identifier(identifier: &str, version: &str) -> [u8; 16] {
  let seed_source = format!(
    "{}@{}",
    if identifier.trim().is_empty() {
      "com.locoris.desktop"
    } else {
      identifier.trim()
    },
    sanitize_runtime_version_token(version)
  );
  let seeds = [0x811c9dc5, 0x9e3779b9, 0x85ebca6b, 0xc2b2ae35];
  let mut bytes = [0u8; 16];

  for (index, seed) in seeds.iter().enumerate() {
    let hashed = fnv1a32(&format!("{index}:{seed_source}"), *seed);
    let chunk = u32_to_bytes(hashed);
    let start = index * 4;
    bytes[start..start + 4].copy_from_slice(&chunk);
  }

  bytes
}

fn native_vault_database_path<R: Runtime>(
  app: &AppHandle<R>,
  local_vault_id: &str,
) -> Result<PathBuf, String> {
  let app_data_dir = app
    .path()
    .app_data_dir()
    .map_err(|error| format!("failed to resolve app data directory: {error}"))?;

  Ok(
    app_data_dir
      .join(DESKTOP_DATA_DIRECTORY)
      .join("vaults")
      .join(format!("{}.sqlite3", sanitize_vault_path_segment(local_vault_id))),
  )
}

fn ensure_parent_directory(path: &Path) -> Result<(), String> {
  let Some(parent_directory) = path.parent() else {
    return Ok(());
  };

  fs::create_dir_all(parent_directory)
    .map_err(|error| format!("failed to create native vault directory: {error}"))
}

fn ensure_native_vault_schema(connection: &Connection) -> Result<(), String> {
  connection
    .execute_batch(
      "
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS metadata (
        key TEXT PRIMARY KEY NOT NULL,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS collections (
        name TEXT PRIMARY KEY NOT NULL,
        payload TEXT NOT NULL
      );
      ",
    )
    .map_err(|error| format!("failed to prepare native vault schema: {error}"))
}

fn read_metadata_value(connection: &Connection, key: &str) -> Result<Option<String>, String> {
  connection
    .query_row("SELECT value FROM metadata WHERE key = ?1", params![key], |row| row.get(0))
    .optional()
    .map_err(|error| format!("failed to read native vault metadata: {error}"))
}

fn read_collection_value(connection: &Connection, name: &str) -> Result<Option<String>, String> {
  connection
    .query_row(
      "SELECT payload FROM collections WHERE name = ?1",
      params![name],
      |row| row.get(0),
    )
    .optional()
    .map_err(|error| format!("failed to read native vault collection: {error}"))
}

fn parse_collection_value(
  connection: &Connection,
  name: &str,
  fallback: Value,
) -> Result<Value, String> {
  let Some(payload) = read_collection_value(connection, name)? else {
    return Ok(fallback);
  };

  serde_json::from_str(&payload)
    .map_err(|error| format!("failed to decode native vault collection `{name}`: {error}"))
}

fn write_metadata_value(connection: &Connection, key: &str, value: &str) -> Result<(), String> {
  connection
    .execute(
      "INSERT INTO metadata (key, value) VALUES (?1, ?2)",
      params![key, value],
    )
    .map(|_| ())
    .map_err(|error| format!("failed to write native vault metadata: {error}"))
}

fn write_collection_value(connection: &Connection, name: &str, value: &Value) -> Result<(), String> {
  connection
    .execute(
      "INSERT INTO collections (name, payload) VALUES (?1, ?2)",
      params![name, value.to_string()],
    )
    .map(|_| ())
    .map_err(|error| format!("failed to write native vault collection `{name}`: {error}"))
}

fn ensure_runtime_layout<R: Runtime>(app: &mut tauri::App<R>) -> Result<(), Box<dyn std::error::Error>> {
  let app_data_dir = app.path().app_data_dir()?;
  let app_cache_dir = app.path().app_cache_dir()?;
  let app_log_dir = app.path().app_log_dir()?;

  fs::create_dir_all(app_data_dir.join(DESKTOP_DATA_DIRECTORY))?;
  fs::create_dir_all(app_data_dir.join(DESKTOP_SETTINGS_DIRECTORY))?;
  fs::create_dir_all(app_data_dir.join(DESKTOP_WEBVIEW_DIRECTORY))?;
  fs::create_dir_all(app_cache_dir.join(DESKTOP_CACHE_DIRECTORY))?;
  fs::create_dir_all(app_log_dir)?;

  Ok(())
}

#[cfg(desktop)]
fn desktop_window_state_flags() -> StateFlags {
  StateFlags::SIZE | StateFlags::POSITION | StateFlags::MAXIMIZED | StateFlags::FULLSCREEN
}

#[cfg(desktop)]
fn show_and_focus_window<R: Runtime>(
  window: &WebviewWindow<R>,
) -> Result<(), Box<dyn std::error::Error>> {
  let _ = window.unminimize();
  window.show()?;
  let _ = window.set_focus();
  Ok(())
}

#[cfg(desktop)]
fn restore_and_present_main_window<R: Runtime>(
  window: &WebviewWindow<R>,
) -> Result<(), Box<dyn std::error::Error>> {
  if let Err(error) = window.restore_state(desktop_window_state_flags()) {
    log::debug!("No saved main window state restored: {error}");
  }

  show_and_focus_window(window)
}

#[cfg(desktop)]
fn create_main_window<R: Runtime>(app: &AppHandle<R>) -> Result<(), Box<dyn std::error::Error>> {
  let window_config = app
    .config()
    .app
    .windows
    .iter()
    .find(|config| config.label == "main")
    .cloned()
    .or_else(|| app.config().app.windows.first().cloned())
    .ok_or("missing main window configuration")?;

  let identifier = app.config().identifier.clone();
  let version = app.package_info().version.to_string();
  let mut builder = WebviewWindowBuilder::from_config(app, &window_config)?;

  #[cfg(target_os = "windows")]
  {
    let label = window_config.label.clone();
    let data_directory = app
      .path()
      .app_data_dir()?
      .join(build_windows_webview_directory(&label, &identifier, &version));
    fs::create_dir_all(&data_directory)?;
    builder = builder.data_directory(data_directory);
  }

  #[cfg(target_os = "macos")]
  {
    builder = builder.data_store_identifier(build_macos_data_store_identifier(&identifier, &version));
  }

  let window = builder.build()?;
  restore_and_present_main_window(&window)?;
  Ok(())
}

#[cfg(desktop)]
fn focus_existing_main_window<R: Runtime>(
  app: &AppHandle<R>,
) -> Result<(), Box<dyn std::error::Error>> {
  if let Some(window) = app.get_webview_window("main") {
    return show_and_focus_window(&window);
  }

  create_main_window(app)
}

#[cfg(target_os = "windows")]
fn build_windows_webview_directory(label: &str, identifier: &str, version: &str) -> String {
  format!(
    "{}/{}/{}",
    DESKTOP_WEBVIEW_DIRECTORY,
    if label.trim().is_empty() { "main" } else { label.trim() },
    build_runtime_version_token(identifier, version)
  )
}

fn desktop_google_oauth_success_html() -> &'static str {
  r#"<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Locoris connected</title>
    <style>
      :root {
        color-scheme: light;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        background: #f6f4ee;
        color: #161311;
      }
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        padding: 24px;
      }
      main {
        width: min(480px, 100%);
        background: rgba(255, 255, 255, 0.88);
        border: 1px solid rgba(22, 19, 17, 0.08);
        border-radius: 24px;
        padding: 28px 24px;
        box-shadow: 0 24px 80px rgba(22, 19, 17, 0.12);
      }
      h1 {
        margin: 0 0 12px;
        font-size: 28px;
        line-height: 1.1;
      }
      p {
        margin: 0;
        font-size: 16px;
        line-height: 1.55;
        color: rgba(22, 19, 17, 0.74);
      }
    </style>
  </head>
  <body>
    <main>
      <h1>Locoris is connected</h1>
      <p>Locoris should continue automatically now. If it doesn't, switch back to the app.</p>
    </main>
    <script>
      window.setTimeout(() => {
        try {
          window.close();
        } catch (_) {
          // Best-effort only.
        }
      }, 200);
    </script>
  </body>
</html>"#
}

fn desktop_google_oauth_not_found_html() -> &'static str {
  r#"<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Locoris redirect not found</title>
  </head>
  <body>
    <p>This redirect is not handled by Locoris.</p>
  </body>
</html>"#
}

fn desktop_google_oauth_write_http_response(
  stream: &mut std::net::TcpStream,
  status_line: &str,
  body: &str,
) {
  let response = format!(
    "HTTP/1.1 {status_line}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n{body}",
    body.as_bytes().len()
  );

  let _ = stream.write_all(response.as_bytes());
  let _ = stream.flush();
}

fn desktop_google_oauth_extract_request_target(request: &str) -> Option<&str> {
  let request_line = request.lines().next()?.trim();
  let mut parts = request_line.split_whitespace();
  let method = parts.next()?;
  let target = parts.next()?;

  if method != "GET" {
    return None;
  }

  Some(target)
}

fn desktop_google_oauth_is_callback_target(target: &str) -> bool {
  target == GOOGLE_DESKTOP_LOOPBACK_PATH
    || target.starts_with("/?")
    || target.starts_with(GOOGLE_DESKTOP_LEGACY_LOOPBACK_PATH)
}

async fn desktop_google_oauth_submit_token_request(
  mut params: Vec<(&'static str, String)>,
) -> Result<DesktopGoogleOauthTokenResponse, String> {
  params.retain(|(_key, value)| !value.trim().is_empty());
  let encoded_body = url::form_urlencoded::Serializer::new(String::new())
    .extend_pairs(params.iter().map(|(key, value)| (*key, value.as_str())))
    .finish();

  let client = reqwest::Client::builder()
    .connect_timeout(Duration::from_secs(15))
    .timeout(Duration::from_secs(GOOGLE_OAUTH_HTTP_TIMEOUT_SECS))
    .build()
    .map_err(|_| "GOOGLE_OAUTH_FAILED".to_string())?;
  let response = client
    .post(GOOGLE_OAUTH_TOKEN_URL)
    .header("Content-Type", "application/x-www-form-urlencoded")
    .body(encoded_body)
    .send()
    .await
    .map_err(|error| {
      log::warn!("Desktop Google OAuth token request failed to reach Google: {error}");
      "SERVER_UNAVAILABLE".to_string()
    })?;
  let status = response.status();
  let raw_payload = response
    .text()
    .await
    .map_err(|error| {
      log::warn!("Desktop Google OAuth token response could not be decoded: {error}");
      "GOOGLE_OAUTH_FAILED".to_string()
    })?;
  let payload = serde_json::from_str::<DesktopGoogleOauthTokenResponse>(&raw_payload).map_err(|error| {
    log::warn!("Desktop Google OAuth token response JSON could not be parsed: {error}");
    "GOOGLE_OAUTH_FAILED".to_string()
  })?;

  if !status.is_success() {
    let error_code = payload.error.as_deref().map(str::trim).unwrap_or_default();
    log::warn!(
      "Desktop Google OAuth token exchange failed with status {} and error code `{}`",
      status,
      error_code
    );

    if error_code == "invalid_grant" {
      return Err("GOOGLE_DRIVE_AUTH_REQUIRED".into());
    }

    if matches!(error_code, "invalid_client" | "unauthorized_client" | "invalid_request") {
      return Err("GOOGLE_OAUTH_INVALID_REQUEST".into());
    }

    if error_code == "access_denied" {
      return Err("GOOGLE_OAUTH_ACCESS_DENIED".into());
    }

    if error_code == "temporarily_unavailable" || status.is_server_error() {
      return Err("SERVER_UNAVAILABLE".into());
    }

    return Err("GOOGLE_OAUTH_FAILED".into());
  }

  if payload
    .access_token
    .as_deref()
    .map(str::trim)
    .unwrap_or_default()
    .is_empty()
  {
    return Err("GOOGLE_DRIVE_AUTH_REQUIRED".into());
  }

  Ok(payload)
}

fn spawn_desktop_google_oauth_listener(
  listener: TcpListener,
  sender: mpsc::Sender<DesktopGoogleOauthCallbackPayload>,
) {
  let _ = listener.set_nonblocking(true);
  let local_port = listener.local_addr().map(|address| address.port()).unwrap_or_default();

  thread::spawn(move || {
    let deadline = Instant::now() + Duration::from_secs(GOOGLE_DESKTOP_LOOPBACK_LISTENER_TIMEOUT_SECS);

    loop {
      match listener.accept() {
        Ok((mut stream, _address)) => {
          let _ = stream.set_read_timeout(Some(Duration::from_secs(2)));
          let _ = stream.set_write_timeout(Some(Duration::from_secs(2)));

          let mut buffer = [0u8; 8192];
          let bytes_read = stream.read(&mut buffer).unwrap_or_default();
          let request = String::from_utf8_lossy(&buffer[..bytes_read]).to_string();

          if let Some(target) = desktop_google_oauth_extract_request_target(&request) {
            let url = format!(
              "http://{GOOGLE_DESKTOP_LOOPBACK_REDIRECT_HOST}:{local_port}{target}"
            );

            if desktop_google_oauth_is_callback_target(target) {
              desktop_google_oauth_write_http_response(
                &mut stream,
                "200 OK",
                desktop_google_oauth_success_html(),
              );
              let _ = sender.send(DesktopGoogleOauthCallbackPayload { url });
              break;
            }
          }

          desktop_google_oauth_write_http_response(
            &mut stream,
            "404 Not Found",
            desktop_google_oauth_not_found_html(),
          );
        }
        Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
          if Instant::now() >= deadline {
            break;
          }

          thread::sleep(Duration::from_millis(50));
        }
        Err(_) => break,
      }
    }
  });
}

#[tauri::command]
fn desktop_google_oauth_prepare_loopback(
  state: State<'_, DesktopGoogleOauthState>,
) -> Result<DesktopGoogleOauthLoopbackSession, String> {
  let listener = TcpListener::bind((GOOGLE_DESKTOP_LOOPBACK_BIND_HOST, 0))
    .map_err(|error| format!("failed to start local Google OAuth callback listener: {error}"))?;
  let local_port = listener
    .local_addr()
    .map_err(|error| format!("failed to inspect local Google OAuth callback listener: {error}"))?
    .port();
  let (sender, receiver) = mpsc::channel();
  let mut callback_receiver = state
    .callback_receiver
    .lock()
    .map_err(|_| "failed to acquire desktop OAuth callback state".to_string())?;

  if callback_receiver.is_some() {
    return Err("GOOGLE_OAUTH_IN_PROGRESS".into());
  }

  *callback_receiver = Some(receiver);
  spawn_desktop_google_oauth_listener(listener, sender);

  Ok(DesktopGoogleOauthLoopbackSession {
    redirect_uri: format!("http://{GOOGLE_DESKTOP_LOOPBACK_REDIRECT_HOST}:{local_port}"),
  })
}

#[tauri::command]
async fn desktop_google_oauth_wait_for_callback(
  state: State<'_, DesktopGoogleOauthState>,
  timeout_ms: Option<u64>,
) -> Result<DesktopGoogleOauthCallbackPayload, String> {
  let timeout = Duration::from_millis(timeout_ms.unwrap_or(180_000));
  let receiver = state
    .callback_receiver
    .lock()
    .map_err(|_| "failed to acquire desktop OAuth callback state".to_string())?
    .take()
    .ok_or_else(|| "GOOGLE_OAUTH_NOT_READY".to_string())?;

  tauri::async_runtime::spawn_blocking(move || match receiver.recv_timeout(timeout) {
    Ok(payload) => Ok(payload),
    Err(mpsc::RecvTimeoutError::Timeout) => Err("GOOGLE_OAUTH_REDIRECT_TIMEOUT".into()),
    Err(mpsc::RecvTimeoutError::Disconnected) => Err("GOOGLE_OAUTH_CALLBACK_FAILED".into()),
  })
  .await
  .map_err(|error| format!("Desktop Google OAuth callback wait failed: {error}"))?
}

#[tauri::command]
async fn desktop_google_oauth_exchange_code(
  input: DesktopGoogleOauthExchangeCodeInput,
) -> Result<DesktopGoogleOauthTokenResponse, String> {
  desktop_google_oauth_submit_token_request(vec![
    ("client_id", input.client_id.trim().to_string()),
    ("code", input.code.trim().to_string()),
    ("code_verifier", input.code_verifier.trim().to_string()),
    ("grant_type", "authorization_code".to_string()),
    ("redirect_uri", input.redirect_uri.trim().to_string()),
  ])
  .await
}

#[tauri::command]
async fn desktop_google_oauth_refresh_token(
  input: DesktopGoogleOauthRefreshTokenInput,
) -> Result<DesktopGoogleOauthTokenResponse, String> {
  desktop_google_oauth_submit_token_request(vec![
    ("client_id", input.client_id.trim().to_string()),
    ("refresh_token", input.refresh_token.trim().to_string()),
    ("grant_type", "refresh_token".to_string()),
  ])
  .await
}

#[tauri::command]
async fn desktop_google_oauth_revoke_token(token: String) -> Result<(), String> {
  let token = token.trim();

  if token.is_empty() {
    return Ok(());
  }

  let encoded_token = url::form_urlencoded::byte_serialize(token.as_bytes()).collect::<String>();
  let revoke_url = format!("{GOOGLE_OAUTH_REVOKE_URL}?token={encoded_token}");
  let client = reqwest::Client::builder()
    .connect_timeout(Duration::from_secs(15))
    .timeout(Duration::from_secs(GOOGLE_OAUTH_HTTP_TIMEOUT_SECS))
    .build()
    .map_err(|_| "GOOGLE_OAUTH_REVOKE_FAILED".to_string())?;
  let response = client
    .post(revoke_url)
    .send()
    .await
    .map_err(|error| {
      log::warn!("Desktop Google OAuth revoke request failed: {error}");
      "SERVER_UNAVAILABLE".to_string()
    })?;

  if response.status().is_success() || response.status().as_u16() == 400 {
    return Ok(());
  }

  Err("GOOGLE_OAUTH_REVOKE_FAILED".into())
}

#[tauri::command]
fn native_vault_store_read<R: Runtime>(
  app: AppHandle<R>,
  local_vault_id: String,
) -> Result<Option<String>, String> {
  let database_path = native_vault_database_path(&app, &local_vault_id)?;

  if !database_path.exists() {
    return Ok(None);
  }

  let connection = Connection::open(&database_path)
    .map_err(|error| format!("failed to open native vault database: {error}"))?;
  ensure_native_vault_schema(&connection)?;

  let Some(schema_version) = read_metadata_value(&connection, "schemaVersion")? else {
    return Ok(None);
  };

  let local_vault_id = read_metadata_value(&connection, "localVaultId")?
    .unwrap_or_else(|| local_vault_id.clone());
  let saved_at = read_metadata_value(&connection, "savedAt")?
    .and_then(|value| value.parse::<i64>().ok())
    .unwrap_or_default();

  let mut snapshot = Map::new();
  snapshot.insert(
    "schemaVersion".into(),
    Value::from(schema_version.parse::<i64>().unwrap_or(1)),
  );
  snapshot.insert("localVaultId".into(), Value::from(local_vault_id));
  snapshot.insert("savedAt".into(), Value::from(saved_at));
  snapshot.insert(
    "projects".into(),
    parse_collection_value(&connection, "projects", Value::Array(Vec::new()))?,
  );
  snapshot.insert(
    "folders".into(),
    parse_collection_value(&connection, "folders", Value::Array(Vec::new()))?,
  );
  snapshot.insert(
    "tags".into(),
    parse_collection_value(&connection, "tags", Value::Array(Vec::new()))?,
  );
  snapshot.insert(
    "notes".into(),
    parse_collection_value(&connection, "notes", Value::Array(Vec::new()))?,
  );
  snapshot.insert(
    "assets".into(),
    parse_collection_value(&connection, "assets", Value::Array(Vec::new()))?,
  );
  for name in ["tasks", "habits", "habitLogs", "goals", "timeBlocks"] {
    if let Some(payload) = read_collection_value(&connection, name)? {
      let collection = serde_json::from_str(&payload)
        .map_err(|error| format!("failed to decode native vault collection `{name}`: {error}"))?;
      snapshot.insert(name.into(), collection);
    }
  }
  snapshot.insert(
    "settings".into(),
    parse_collection_value(&connection, "settings", Value::Null)?,
  );
  snapshot.insert(
    "syncDirtyEntries".into(),
    parse_collection_value(&connection, "syncDirtyEntries", Value::Array(Vec::new()))?,
  );
  snapshot.insert(
    "syncShadows".into(),
    parse_collection_value(&connection, "syncShadows", Value::Array(Vec::new()))?,
  );
  snapshot.insert(
    "syncTombstones".into(),
    parse_collection_value(&connection, "syncTombstones", Value::Array(Vec::new()))?,
  );

  Ok(Some(Value::Object(snapshot).to_string()))
}

#[tauri::command]
fn native_vault_store_write<R: Runtime>(
  app: AppHandle<R>,
  local_vault_id: String,
  snapshot_json: String,
) -> Result<(), String> {
  let snapshot: Value = serde_json::from_str(&snapshot_json)
    .map_err(|error| format!("failed to decode native vault snapshot payload: {error}"))?;
  let snapshot_object = snapshot
    .as_object()
    .ok_or_else(|| "native vault snapshot must be a JSON object".to_string())?;
  let database_path = native_vault_database_path(&app, &local_vault_id)?;
  ensure_parent_directory(&database_path)?;

  let mut connection = Connection::open(&database_path)
    .map_err(|error| format!("failed to open native vault database: {error}"))?;
  ensure_native_vault_schema(&connection)?;

  let transaction = connection
    .transaction()
    .map_err(|error| format!("failed to open native vault transaction: {error}"))?;

  transaction
    .execute("DELETE FROM metadata", [])
    .map_err(|error| format!("failed to clear native vault metadata: {error}"))?;
  transaction
    .execute("DELETE FROM collections", [])
    .map_err(|error| format!("failed to clear native vault collections: {error}"))?;

  let schema_version = snapshot_object
    .get("schemaVersion")
    .and_then(Value::as_i64)
    .unwrap_or(1);
  let persisted_local_vault_id = snapshot_object
    .get("localVaultId")
    .and_then(Value::as_str)
    .unwrap_or(local_vault_id.as_str())
    .to_string();
  let saved_at = snapshot_object
    .get("savedAt")
    .and_then(Value::as_i64)
    .unwrap_or_default();
  let projects = snapshot_object
    .get("projects")
    .cloned()
    .unwrap_or(Value::Array(Vec::new()));
  let folders = snapshot_object
    .get("folders")
    .cloned()
    .unwrap_or(Value::Array(Vec::new()));
  let tags = snapshot_object
    .get("tags")
    .cloned()
    .unwrap_or(Value::Array(Vec::new()));
  let notes = snapshot_object
    .get("notes")
    .cloned()
    .unwrap_or(Value::Array(Vec::new()));
  let assets = snapshot_object
    .get("assets")
    .cloned()
    .unwrap_or(Value::Array(Vec::new()));
  let tasks = snapshot_object
    .get("tasks")
    .cloned()
    .unwrap_or(Value::Array(Vec::new()));
  let habits = snapshot_object
    .get("habits")
    .cloned()
    .unwrap_or(Value::Array(Vec::new()));
  let habit_logs = snapshot_object
    .get("habitLogs")
    .cloned()
    .unwrap_or(Value::Array(Vec::new()));
  let goals = snapshot_object
    .get("goals")
    .cloned()
    .unwrap_or(Value::Array(Vec::new()));
  let time_blocks = snapshot_object
    .get("timeBlocks")
    .cloned()
    .unwrap_or(Value::Array(Vec::new()));
  let settings = snapshot_object.get("settings").cloned().unwrap_or(Value::Null);
  let sync_dirty_entries = snapshot_object
    .get("syncDirtyEntries")
    .cloned()
    .unwrap_or(Value::Array(Vec::new()));
  let sync_shadows = snapshot_object
    .get("syncShadows")
    .cloned()
    .unwrap_or(Value::Array(Vec::new()));
  let sync_tombstones = snapshot_object
    .get("syncTombstones")
    .cloned()
    .unwrap_or(Value::Array(Vec::new()));

  write_metadata_value(&transaction, "schemaVersion", &schema_version.to_string())?;
  write_metadata_value(&transaction, "localVaultId", &persisted_local_vault_id)?;
  write_metadata_value(&transaction, "savedAt", &saved_at.to_string())?;
  write_collection_value(&transaction, "projects", &projects)?;
  write_collection_value(&transaction, "folders", &folders)?;
  write_collection_value(&transaction, "tags", &tags)?;
  write_collection_value(&transaction, "notes", &notes)?;
  write_collection_value(&transaction, "assets", &assets)?;
  write_collection_value(&transaction, "tasks", &tasks)?;
  write_collection_value(&transaction, "habits", &habits)?;
  write_collection_value(&transaction, "habitLogs", &habit_logs)?;
  write_collection_value(&transaction, "goals", &goals)?;
  write_collection_value(&transaction, "timeBlocks", &time_blocks)?;
  write_collection_value(&transaction, "settings", &settings)?;
  write_collection_value(&transaction, "syncDirtyEntries", &sync_dirty_entries)?;
  write_collection_value(&transaction, "syncShadows", &sync_shadows)?;
  write_collection_value(&transaction, "syncTombstones", &sync_tombstones)?;

  transaction
    .commit()
    .map_err(|error| format!("failed to commit native vault transaction: {error}"))
}

#[tauri::command]
fn native_vault_store_delete<R: Runtime>(
  app: AppHandle<R>,
  local_vault_id: String,
) -> Result<(), String> {
  let database_path = native_vault_database_path(&app, &local_vault_id)?;

  for suffix in ["", "-wal", "-shm"] {
    let path = if suffix.is_empty() {
      database_path.clone()
    } else {
      PathBuf::from(format!("{}{}", database_path.display(), suffix))
    };

    if path.exists() {
      fs::remove_file(&path)
        .map_err(|error| format!("failed to remove native vault database file: {error}"))?;
    }
  }

  if let Some(parent_directory) = database_path.parent() {
    if parent_directory.exists() && parent_directory.read_dir().map_err(|error| format!("{error}"))?.next().is_none()
    {
      let _ = fs::remove_dir(parent_directory);
    }
  }

  Ok(())
}

#[cfg(target_os = "android")]
#[tauri::command]
fn android_google_drive_check_availability<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
  let _: Value = android_bridge::run(&app, "googleDriveCheckAvailability", serde_json::json!({}))?;
  Ok(())
}

#[cfg(not(target_os = "android"))]
#[tauri::command]
fn android_google_drive_check_availability() -> Result<(), String> {
  Err("GOOGLE_OAUTH_UNAVAILABLE".into())
}

#[cfg(target_os = "android")]
#[tauri::command]
fn android_google_drive_authorize<R: Runtime>(
  app: AppHandle<R>,
  scopes: Vec<String>,
  silent: bool,
) -> Result<Value, String> {
  android_bridge::run(
    &app,
    "googleDriveAuthorize",
    serde_json::json!({
      "scopes": scopes,
      "silent": silent
    }),
  )
}

#[cfg(not(target_os = "android"))]
#[tauri::command]
fn android_google_drive_authorize(_scopes: Vec<String>, _silent: bool) -> Result<Value, String> {
  Err("GOOGLE_OAUTH_UNAVAILABLE".into())
}

#[cfg(target_os = "android")]
#[tauri::command]
fn android_google_drive_clear_token<R: Runtime>(
  app: AppHandle<R>,
  token: String,
) -> Result<(), String> {
  let _: Value = android_bridge::run(
    &app,
    "googleDriveClearToken",
    serde_json::json!({
      "token": token
    }),
  )?;
  Ok(())
}

#[cfg(not(target_os = "android"))]
#[tauri::command]
fn android_google_drive_clear_token(_token: String) -> Result<(), String> {
  Err("GOOGLE_OAUTH_UNAVAILABLE".into())
}

#[cfg(target_os = "android")]
#[tauri::command]
fn android_google_drive_revoke_access<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
  let _: Value = android_bridge::run(&app, "googleDriveRevokeAccess", serde_json::json!({}))?;
  Ok(())
}

#[cfg(not(target_os = "android"))]
#[tauri::command]
fn android_google_drive_revoke_access() -> Result<(), String> {
  Err("GOOGLE_OAUTH_UNAVAILABLE".into())
}

#[cfg(target_os = "android")]
#[tauri::command]
fn android_install_apk_update<R: Runtime>(
  app: AppHandle<R>,
  url: String,
  file_name: String,
  expected_package_name: String,
  expected_size_bytes: Option<i64>,
) -> Result<Value, String> {
  android_bridge::run(
    &app,
    "installApkUpdate",
    serde_json::json!({
      "url": url,
      "fileName": file_name,
      "expectedPackageName": expected_package_name,
      "expectedSizeBytes": expected_size_bytes
    }),
  )
}

#[cfg(not(target_os = "android"))]
#[tauri::command]
fn android_install_apk_update(
  _url: String,
  _file_name: String,
  _expected_package_name: String,
  _expected_size_bytes: Option<i64>,
) -> Result<Value, String> {
  Err("ANDROID_UPDATE_UNAVAILABLE".into())
}

#[cfg(target_os = "android")]
#[tauri::command]
fn android_get_apk_update_progress<R: Runtime>(app: AppHandle<R>) -> Result<Value, String> {
  android_bridge::run(&app, "getApkUpdateProgress", serde_json::json!({}))
}

#[cfg(not(target_os = "android"))]
#[tauri::command]
fn android_get_apk_update_progress() -> Result<Value, String> {
  Err("ANDROID_UPDATE_UNAVAILABLE".into())
}

#[cfg(target_os = "android")]
#[tauri::command]
fn android_open_install_permission_settings<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
  let _: Value = android_bridge::run(
    &app,
    "openInstallPermissionSettings",
    serde_json::json!({}),
  )?;
  Ok(())
}

#[cfg(not(target_os = "android"))]
#[tauri::command]
fn android_open_install_permission_settings() -> Result<(), String> {
  Err("ANDROID_UPDATE_UNAVAILABLE".into())
}

#[cfg(target_os = "android")]
#[tauri::command]
fn android_get_package_name<R: Runtime>(app: AppHandle<R>) -> Result<Value, String> {
  android_bridge::run(&app, "getPackageName", serde_json::json!({}))
}

#[cfg(not(target_os = "android"))]
#[tauri::command]
fn android_get_package_name() -> Result<Value, String> {
  Err("ANDROID_UPDATE_UNAVAILABLE".into())
}

#[cfg(desktop)]
#[tauri::command]
fn secure_secret_get<R: Runtime>(app: AppHandle<R>, key: String) -> Result<Option<String>, String> {
  let entry = open_secure_secret_entry(&app, &key)?;

  match entry.get_password() {
    Ok(value) => Ok(Some(value)),
    Err(KeyringError::NoEntry) => Ok(None),
    Err(error) => Err(format!("failed to read secure secret: {error}")),
  }
}

#[cfg(desktop)]
#[tauri::command]
fn secure_secret_set<R: Runtime>(
  app: AppHandle<R>,
  key: String,
  value: String,
) -> Result<(), String> {
  let entry = open_secure_secret_entry(&app, &key)?;

  entry
    .set_password(value.trim())
    .map_err(|error| format!("failed to write secure secret: {error}"))
}

#[cfg(desktop)]
#[tauri::command]
fn secure_secret_delete<R: Runtime>(app: AppHandle<R>, key: String) -> Result<(), String> {
  let entry = open_secure_secret_entry(&app, &key)?;

  match entry.delete_credential() {
    Ok(()) | Err(KeyringError::NoEntry) => Ok(()),
    Err(error) => Err(format!("failed to delete secure secret: {error}")),
  }
}

#[cfg(target_os = "android")]
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AndroidSecureSecretGetResponse {
  value: Option<String>,
}

#[cfg(target_os = "android")]
#[tauri::command]
fn secure_secret_get<R: Runtime>(app: AppHandle<R>, key: String) -> Result<Option<String>, String> {
  if key.trim().is_empty() {
    return Err("secure secret key is required".into());
  }

  let response: AndroidSecureSecretGetResponse = android_bridge::run(
    &app,
    "secureSecretGet",
    serde_json::json!({
      "key": key
    }),
  )?;

  Ok(response.value)
}

#[cfg(target_os = "android")]
#[tauri::command]
fn secure_secret_set<R: Runtime>(
  app: AppHandle<R>,
  key: String,
  value: String,
) -> Result<(), String> {
  if key.trim().is_empty() {
    return Err("secure secret key is required".into());
  }

  let _: Value = android_bridge::run(
    &app,
    "secureSecretSet",
    serde_json::json!({
      "key": key,
      "value": value
    }),
  )?;
  Ok(())
}

#[cfg(target_os = "android")]
#[tauri::command]
fn secure_secret_delete<R: Runtime>(app: AppHandle<R>, key: String) -> Result<(), String> {
  if key.trim().is_empty() {
    return Err("secure secret key is required".into());
  }

  let _: Value = android_bridge::run(
    &app,
    "secureSecretDelete",
    serde_json::json!({
      "key": key
    }),
  )?;
  Ok(())
}

#[cfg(all(not(desktop), not(target_os = "android")))]
#[tauri::command]
fn secure_secret_get(key: String) -> Result<Option<String>, String> {
  if key.trim().is_empty() {
    return Err("secure secret key is required".into());
  }

  Ok(None)
}

#[cfg(all(not(desktop), not(target_os = "android")))]
#[tauri::command]
fn secure_secret_set(key: String, _value: String) -> Result<(), String> {
  if key.trim().is_empty() {
    return Err("secure secret key is required".into());
  }

  Ok(())
}

#[cfg(all(not(desktop), not(target_os = "android")))]
#[tauri::command]
fn secure_secret_delete(key: String) -> Result<(), String> {
  if key.trim().is_empty() {
    return Err("secure secret key is required".into());
  }

  Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  let log_level = if cfg!(debug_assertions) {
    log::LevelFilter::Info
  } else {
    log::LevelFilter::Warn
  };

  let mut log_targets = vec![Target::new(TargetKind::LogDir {
    file_name: Some("locoris".into()),
  })];

  if cfg!(debug_assertions) {
    log_targets.push(Target::new(TargetKind::Stdout));
  }

  let mut builder = tauri::Builder::default();

  #[cfg(desktop)]
  {
    builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
      if let Err(error) = focus_existing_main_window(app) {
        log::warn!("Failed to focus existing Locoris window: {error}");
      }
    }));
  }

  #[cfg(target_os = "android")]
  {
    builder = builder.plugin(android_bridge::init());
  }

  builder = builder
    .manage(DesktopGoogleOauthState::default())
    .invoke_handler(tauri::generate_handler![
      desktop_google_oauth_prepare_loopback,
      desktop_google_oauth_wait_for_callback,
      desktop_google_oauth_exchange_code,
      desktop_google_oauth_refresh_token,
      desktop_google_oauth_revoke_token,
      android_google_drive_check_availability,
      android_google_drive_authorize,
      android_google_drive_clear_token,
      android_google_drive_revoke_access,
      android_install_apk_update,
      android_get_apk_update_progress,
      android_open_install_permission_settings,
      android_get_package_name,
      native_vault_store_read,
      native_vault_store_write,
      native_vault_store_delete,
      secure_secret_get,
      secure_secret_set,
      secure_secret_delete
    ])
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_deep_link::init())
    .plugin(tauri_plugin_fs::init())
    .plugin(
      tauri_plugin_log::Builder::new()
        .clear_targets()
        .targets(log_targets)
        .level(log_level)
        .build(),
    )
    .plugin(tauri_plugin_notification::init())
    .plugin(tauri_plugin_opener::init())
    .plugin(tauri_plugin_store::Builder::new().build());

  #[cfg(desktop)]
  {
    builder = builder
      .plugin(tauri_plugin_process::init())
      .plugin(tauri_plugin_updater::Builder::new().build())
      .plugin(
        tauri_plugin_window_state::Builder::default()
          .with_state_flags(desktop_window_state_flags())
          .skip_initial_state("main")
          .build(),
      );
  }

  builder
    .setup(|app| {
      ensure_runtime_layout(app)?;

      #[cfg(desktop)]
      create_main_window(&app.handle())?;

      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running Locoris application");
}
