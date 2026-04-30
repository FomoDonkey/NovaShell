#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod ai_manager;
mod collab_manager;
mod hacking_manager;
mod infra_monitor;
mod keychain_manager;
mod log_manager;
mod pty_manager;
mod rdp_manager;
mod session_doc_manager;
mod sftp_manager;
mod ssh_manager;
mod system_info;

use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::sync::{Mutex, RwLock};
use std::sync::atomic::{AtomicUsize, Ordering};
use tauri::{Manager, State};
use std::time::UNIX_EPOCH;

// Session capacity limits — bumped from earlier conservative defaults.
// These cap real concurrent connections; bumped upward so power users
// hitting the limit is rare. Surfaced in error messages for clarity.
pub const MAX_PTY_SESSIONS: usize = 50;
pub const MAX_SSH_SESSIONS: usize = 30;
pub const MAX_SFTP_SESSIONS: usize = 30;

pub struct AppState {
    pub sessions: Mutex<HashMap<String, pty_manager::PtySession>>,
    pub ssh_sessions: RwLock<HashMap<String, ssh_manager::SshSession>>,
    // Counts in-flight SSH connect handshakes (not yet inserted into
    // ssh_sessions). Reserved BEFORE the handshake so concurrent connects
    // can't all do an expensive handshake just to be rejected at insert
    // time. Decremented on both success and failure.
    pub ssh_in_flight: AtomicUsize,
    pub sftp_sessions: Mutex<HashMap<String, std::sync::Arc<sftp_manager::SftpSession>>>,
    pub log_streams: Mutex<HashMap<String, ssh_manager::LogStream>>,
    pub system: Mutex<sysinfo::System>,
    pub cached_path_commands: Mutex<Option<Vec<String>>>,
    pub log_manager: Mutex<log_manager::LogManager>,
    pub session_doc_manager: Mutex<session_doc_manager::SessionDocManager>,
    pub infra_monitors: Mutex<infra_monitor::InfraMonitors>,
    pub collab_host_sessions: Mutex<HashMap<String, std::sync::Arc<collab_manager::CollabSession>>>,
    pub collab_client_sessions: Mutex<HashMap<String, std::sync::Arc<collab_manager::CollabClient>>>,
    pub collab_listener_ids: Mutex<HashMap<String, tauri::EventId>>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct ShellInfo {
    pub name: String,
    pub path: String,
    pub available: bool,
}

#[tauri::command]
fn get_available_shells() -> Vec<ShellInfo> {
    let mut shells = Vec::new();

    #[cfg(target_os = "windows")]
    {
        shells.push(ShellInfo {
            name: "PowerShell".to_string(),
            path: "powershell.exe".to_string(),
            available: true,
        });
        shells.push(ShellInfo {
            name: "CMD".to_string(),
            path: "cmd.exe".to_string(),
            available: true,
        });
        // Check common Git Bash install locations
        let git_bash_paths = [
            "C:\\Program Files\\Git\\bin\\bash.exe",
            "C:\\Program Files (x86)\\Git\\bin\\bash.exe",
        ];
        if let Some(path) = git_bash_paths.iter().find(|p| std::path::Path::new(p).exists()) {
            shells.push(ShellInfo {
                name: "Git Bash".to_string(),
                path: path.to_string(),
                available: true,
            });
        }
        if std::path::Path::new("C:\\Windows\\System32\\wsl.exe").exists() {
            shells.push(ShellInfo {
                name: "WSL".to_string(),
                path: "C:\\Windows\\System32\\wsl.exe".to_string(),
                available: true,
            });
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        // Check standard + Homebrew + common install paths
        let candidates: &[(&str, &[&str])] = &[
            ("Bash", &["/bin/bash", "/usr/bin/bash", "/usr/local/bin/bash", "/opt/homebrew/bin/bash"]),
            ("Zsh", &["/bin/zsh", "/usr/bin/zsh", "/usr/local/bin/zsh", "/opt/homebrew/bin/zsh"]),
            ("Fish", &["/usr/bin/fish", "/usr/local/bin/fish", "/opt/homebrew/bin/fish"]),
        ];
        for (name, paths) in candidates {
            if let Some(path) = paths.iter().find(|p| std::path::Path::new(p).exists()) {
                shells.push(ShellInfo {
                    name: name.to_string(),
                    path: path.to_string(),
                    available: true,
                });
            }
        }
    }

    shells
}

#[tauri::command]
async fn create_pty_session(
    shell_path: String,
    state: State<'_, AppState>,
    app_handle: tauri::AppHandle,
) -> Result<String, String> {
    // Check limit BEFORE spawning the shell process to avoid wasting a fork
    // when at capacity (the previous code spawned then dropped on overflow).
    {
        let sessions = state.sessions.lock()
            .map_err(|e| format!("Session lock error: {}", e))?;
        if sessions.len() >= MAX_PTY_SESSIONS {
            return Err(format!(
                "Maximum number of terminal sessions reached ({}). Close an existing tab and try again.",
                MAX_PTY_SESSIONS
            ));
        }
    }
    let session_id = uuid::Uuid::new_v4().to_string();
    let session = pty_manager::PtySession::new(&shell_path, &session_id, app_handle)
        .map_err(|e| e.to_string())?;

    let mut sessions = state.sessions.lock()
        .map_err(|e| format!("Session lock error: {}", e))?;
    // Re-check after the (slow) spawn — defends against concurrent creates
    // racing past the first check.
    if sessions.len() >= MAX_PTY_SESSIONS {
        return Err(format!(
            "Maximum number of terminal sessions reached ({}). Close an existing tab and try again.",
            MAX_PTY_SESSIONS
        ));
    }
    sessions.insert(session_id.clone(), session);
    Ok(session_id)
}

#[tauri::command]
fn write_to_pty(
    session_id: String,
    data: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let sessions = state.sessions.lock()
        .map_err(|e| format!("Session lock error: {}", e))?;
    if let Some(session) = sessions.get(&session_id) {
        session.write(data.as_bytes()).map_err(|e| e.to_string())
    } else {
        Err(format!("Session '{}' not found", session_id))
    }
}

#[tauri::command]
fn resize_pty(
    session_id: String,
    cols: u16,
    rows: u16,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let sessions = state.sessions.lock()
        .map_err(|e| format!("Session lock error: {}", e))?;
    if let Some(session) = sessions.get(&session_id) {
        session.resize(cols, rows).map_err(|e| e.to_string())
    } else {
        Err(format!("Session '{}' not found", session_id))
    }
}

#[tauri::command]
fn close_pty_session(
    session_id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let mut sessions = state.sessions.lock()
        .map_err(|e| format!("Session lock error: {}", e))?;
    if sessions.remove(&session_id).is_some() {
        Ok(())
    } else {
        Err(format!("Session '{}' not found", session_id))
    }
}

#[tauri::command]
fn get_system_info(state: State<'_, AppState>) -> Result<system_info::SystemStats, String> {
    let mut sys = state.system.lock()
        .map_err(|e| format!("System lock error: {}", e))?;
    Ok(system_info::get_stats(&mut sys))
}

#[tauri::command]
fn get_git_branch(path: Option<String>) -> Result<String, String> {
    let dir = path
        .map(std::path::PathBuf::from)
        .or_else(|| std::env::current_dir().ok())
        .unwrap_or_else(|| std::path::PathBuf::from("."));

    // Read .git/HEAD directly instead of spawning a git process
    // This prevents any console window flash on Windows
    let git_head = find_git_head(&dir).ok_or("Not a git repository")?;
    let content = std::fs::read_to_string(&git_head).map_err(|e| e.to_string())?;
    let trimmed = content.trim();

    if let Some(branch) = trimmed.strip_prefix("ref: refs/heads/") {
        Ok(branch.to_string())
    } else if trimmed.len() >= 7 {
        // Detached HEAD — return short hash
        Ok(trimmed[..7].to_string())
    } else {
        Err("Not a git repository".to_string())
    }
}

/// Walk up from `dir` to find .git/HEAD (supports nested project directories)
fn find_git_head(start: &std::path::Path) -> Option<std::path::PathBuf> {
    let mut current = start.to_path_buf();
    loop {
        let head = current.join(".git").join("HEAD");
        if head.is_file() {
            return Some(head);
        }
        if !current.pop() {
            return None;
        }
    }
}

#[derive(Serialize, Deserialize, Clone)]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: u64,
    pub extension: String,
}

#[tauri::command]
fn list_directory(path: Option<String>) -> Result<Vec<FileEntry>, String> {
    let dir = path
        .map(std::path::PathBuf::from)
        .or_else(|| dirs::home_dir())
        .unwrap_or_else(|| std::path::PathBuf::from("."));

    let mut entries = Vec::new();
    let read_dir = std::fs::read_dir(&dir).map_err(|e| e.to_string())?;

    for entry in read_dir {
        let entry = entry.map_err(|e| e.to_string())?;
        let metadata = entry.metadata().map_err(|e| e.to_string())?;
        let path = entry.path();

        entries.push(FileEntry {
            name: entry.file_name().to_string_lossy().to_string(),
            path: path.to_string_lossy().to_string(),
            is_dir: metadata.is_dir(),
            size: metadata.len(),
            extension: path.extension()
                .map(|e| e.to_string_lossy().to_string())
                .unwrap_or_default(),
        });
    }

    // Pre-compute lowercase keys once to avoid repeated allocations during sort
    let mut keyed: Vec<_> = entries.into_iter()
        .map(|e| { let k = e.name.to_lowercase(); (k, e) })
        .collect();
    keyed.sort_by(|a, b| b.1.is_dir.cmp(&a.1.is_dir).then(a.0.cmp(&b.0)));
    let entries: Vec<FileEntry> = keyed.into_iter().map(|(_, e)| e).collect();

    Ok(entries)
}

#[tauri::command]
fn read_file_preview(path: String) -> Result<String, String> {
    let file_path = std::path::Path::new(&path);
    let metadata = std::fs::metadata(file_path).map_err(|e| e.to_string())?;

    if metadata.len() > 5_242_880 {
        return Err("File too large for editor (>5MB)".to_string());
    }

    // Try UTF-8 first, then fallback to lossy conversion for non-UTF-8 encoded files
    match std::fs::read_to_string(file_path) {
        Ok(content) => Ok(content),
        Err(_) => {
            // Likely non-UTF-8 encoding or binary — try lossy conversion
            let bytes = std::fs::read(file_path).map_err(|e| e.to_string())?;
            // Check if file appears to be binary (has null bytes in first 8KB)
            let check_len = std::cmp::min(bytes.len(), 8192);
            if bytes[..check_len].contains(&0) {
                return Err("Binary file — cannot display in editor".to_string());
            }
            Ok(String::from_utf8_lossy(&bytes).into_owned())
        }
    }
}

#[tauri::command]
fn get_command_suggestions(prefix: String, state: State<'_, AppState>) -> Vec<String> {
    let mut suggestions = Vec::new();

    let common_commands = [
        "cd", "ls", "dir", "mkdir", "rmdir", "cp", "mv", "rm", "cat", "echo",
        "git status", "git add", "git commit", "git push", "git pull", "git log",
        "git branch", "git checkout", "git merge", "git diff", "git clone",
        "npm install", "npm run", "npm start", "npm test", "npm build",
        "docker ps", "docker images", "docker run", "docker build", "docker compose",
        "cargo build", "cargo run", "cargo test", "cargo check",
        "python", "python3", "pip install", "node", "npx",
        "kubectl get pods", "kubectl get services", "kubectl apply",
        "ssh", "scp", "curl", "wget", "ping", "tracert", "ipconfig", "netstat",
        "code", "notepad", "explorer", "tasklist", "taskkill",
        "cls", "clear", "exit", "history", "whoami", "hostname",
    ];

    let prefix_lower = prefix.to_lowercase();
    for cmd in &common_commands {
        if cmd.to_lowercase().starts_with(&prefix_lower) {
            suggestions.push(cmd.to_string());
        }
    }

    // Use cached PATH commands or build cache on first call
    let mut cache = match state.cached_path_commands.lock() {
        Ok(c) => c,
        Err(e) => e.into_inner(),
    };
    if cache.is_none() {
        let mut path_cmds_set: HashSet<String> = HashSet::new();
        if let Ok(path_var) = std::env::var("PATH") {
            let separator = if cfg!(windows) { ';' } else { ':' };
            for dir in path_var.split(separator) {
                if let Ok(entries) = std::fs::read_dir(dir) {
                    for entry in entries.flatten() {
                        let name = entry.file_name().to_string_lossy().to_string();
                        let clean_name = if cfg!(windows) {
                            name.strip_suffix(".exe")
                                .or_else(|| name.strip_suffix(".cmd"))
                                .or_else(|| name.strip_suffix(".bat"))
                                .unwrap_or(&name)
                                .to_string()
                        } else {
                            name.clone()
                        };
                        path_cmds_set.insert(clean_name);
                    }
                }
            }
        }
        let mut path_cmds: Vec<String> = path_cmds_set.into_iter().collect();
        path_cmds.sort();
        *cache = Some(path_cmds);
    }

    // Build an owned HashSet from the already-collected suggestions for O(1) dedup
    let mut suggestions_set: HashSet<String> = suggestions.iter().cloned().collect();
    if let Some(ref path_cmds) = *cache {
        for cmd in path_cmds {
            if cmd.to_lowercase().starts_with(&prefix_lower) && suggestions.len() < 20 {
                if suggestions_set.insert(cmd.clone()) {
                    suggestions.push(cmd.clone());
                }
            }
        }
    }

    suggestions.sort();
    suggestions.truncate(15);
    suggestions
}

#[tauri::command]
async fn ssh_connect(
    host: String,
    port: u16,
    username: String,
    password: Option<String>,
    private_key: Option<String>,
    state: State<'_, AppState>,
    app_handle: tauri::AppHandle,
) -> Result<String, String> {
    // Reserve a slot atomically BEFORE the (slow) handshake. This prevents
    // 11 concurrent connects from all spending ~10s on a handshake just for
    // 1 to be rejected at insert time. Counts established + in-flight.
    let current_established = state.ssh_sessions.read()
        .map_err(|e| format!("SSH session lock error: {}", e))?
        .len();
    let in_flight = state.ssh_in_flight.fetch_add(1, Ordering::SeqCst);
    if current_established + in_flight + 1 > MAX_SSH_SESSIONS {
        state.ssh_in_flight.fetch_sub(1, Ordering::SeqCst);
        return Err(format!(
            "Maximum number of SSH sessions reached ({}). Disconnect an existing session and try again.",
            MAX_SSH_SESSIONS
        ));
    }

    // RAII guard: ensures the in-flight counter is always decremented even
    // if the handshake panics or returns an error early. Without this, a
    // panic during handshake would permanently leak a slot.
    struct InFlightGuard<'a>(&'a AtomicUsize);
    impl Drop for InFlightGuard<'_> {
        fn drop(&mut self) {
            self.0.fetch_sub(1, Ordering::SeqCst);
        }
    }
    let _guard = InFlightGuard(&state.ssh_in_flight);

    let session_id = uuid::Uuid::new_v4().to_string();
    let sid = session_id.clone();
    let session = tokio::task::spawn_blocking(move || {
        ssh_manager::SshSession::new(
            &host, port, &username,
            password.as_deref(), private_key.as_deref(),
            &sid, app_handle,
        )
    }).await.map_err(|e| format!("Task join error: {}", e))??;

    {
        let mut sessions = state.ssh_sessions.write()
            .map_err(|e| format!("SSH session lock error: {}", e))?;
        // Final authoritative check (defends against an extreme race where
        // multiple connects all reserved simultaneously and the established
        // count grew between the reserve and the insert).
        if sessions.len() >= MAX_SSH_SESSIONS {
            return Err(format!(
                "Maximum number of SSH sessions reached ({}). Disconnect an existing session and try again.",
                MAX_SSH_SESSIONS
            ));
        }
        sessions.insert(session_id.clone(), session);
    }

    Ok(session_id)
}

#[tauri::command]
fn ssh_write(
    session_id: String,
    data: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    // RwLock read — allows concurrent writes from multiple SSH sessions
    let sessions = state.ssh_sessions.read()
        .map_err(|e| format!("SSH session lock error: {}", e))?;
    if let Some(session) = sessions.get(&session_id) {
        session.write(data.as_bytes())
    } else {
        Err(format!("SSH session '{}' not found", session_id))
    }
}

#[tauri::command]
async fn ssh_resize(
    session_id: String,
    cols: u32,
    rows: u32,
    state: State<'_, AppState>,
) -> Result<(), String> {
    // Extract Arc refs from the session, then release the RwLock immediately
    let (session_arc, channel_arc) = {
        let sessions = state.ssh_sessions.read()
            .map_err(|e| format!("SSH session lock error: {}", e))?;
        let s = sessions.get(&session_id)
            .ok_or_else(|| format!("SSH session '{}' not found", session_id))?;
        s.get_resize_refs()
    };
    // Run the blocking resize (mutex + SSH I/O) off the async runtime
    tokio::task::spawn_blocking(move || {
        ssh_manager::resize_with_refs(&session_arc, &channel_arc, cols, rows)
    }).await.map_err(|e| format!("Task join error: {}", e))?
}

#[tauri::command]
fn ssh_get_scrollback(
    session_id: String,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let sessions = state.ssh_sessions.read()
        .map_err(|e| format!("SSH session lock error: {}", e))?;
    if let Some(session) = sessions.get(&session_id) {
        Ok(session.get_scrollback())
    } else {
        Err(format!("SSH session '{}' not found", session_id))
    }
}

#[tauri::command]
fn ssh_disconnect(
    session_id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let mut sessions = state.ssh_sessions.write()
        .map_err(|e| format!("SSH session lock error: {}", e))?;
    if sessions.remove(&session_id).is_some() {
        Ok(())
    } else {
        Err(format!("SSH session '{}' not found", session_id))
    }
}

#[tauri::command]
async fn ssh_test_connection(
    host: String,
    port: u16,
    username: String,
    password: Option<String>,
    private_key: Option<String>,
) -> Result<String, String> {
    ssh_manager::test_ssh_connection(
        &host,
        port,
        &username,
        password.as_deref(),
        private_key.as_deref(),
    )
}

#[tauri::command]
fn debug_log_save(
    entries: Vec<log_manager::LogEntry>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let mgr = state.log_manager.lock()
        .map_err(|e| format!("Log lock error: {}", e))?;
    mgr.append_batch(&entries)
}

#[tauri::command]
fn debug_log_list_sessions(
    state: State<'_, AppState>,
) -> Result<Vec<log_manager::LogSessionInfo>, String> {
    let mgr = state.log_manager.lock()
        .map_err(|e| format!("Log lock error: {}", e))?;
    mgr.list_sessions()
}

#[tauri::command]
fn debug_log_load_session(
    filename: String,
    state: State<'_, AppState>,
) -> Result<Vec<log_manager::LogEntry>, String> {
    let mgr = state.log_manager.lock()
        .map_err(|e| format!("Log lock error: {}", e))?;
    mgr.load_session(&filename)
}

#[tauri::command]
fn debug_log_delete_session(
    filename: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let mgr = state.log_manager.lock()
        .map_err(|e| format!("Log lock error: {}", e))?;
    mgr.delete_session(&filename)
}

#[tauri::command]
fn debug_log_cleanup(
    state: State<'_, AppState>,
) -> Result<u32, String> {
    let mgr = state.log_manager.lock()
        .map_err(|e| format!("Log lock error: {}", e))?;
    mgr.cleanup_old()
}

#[tauri::command]
fn debug_log_get_dir(
    state: State<'_, AppState>,
) -> Result<String, String> {
    let mgr = state.log_manager.lock()
        .map_err(|e| format!("Log lock error: {}", e))?;
    Ok(mgr.get_log_dir())
}

#[tauri::command]
fn keychain_save_password(connection_id: String, password: String) -> Result<(), String> {
    keychain_manager::save_password(&connection_id, &password)
}

#[tauri::command]
fn keychain_get_password(connection_id: String) -> Result<Option<String>, String> {
    keychain_manager::get_password(&connection_id)
}

#[tauri::command]
fn keychain_delete_password(connection_id: String) -> Result<(), String> {
    keychain_manager::delete_password(&connection_id)
}

#[tauri::command]
fn rdp_connect(
    host: String,
    port: Option<u16>,
    username: String,
    domain: Option<String>,
    password: Option<String>,
    fullscreen: Option<bool>,
    width: Option<u32>,
    height: Option<u32>,
    multimon: Option<bool>,
    admin: Option<bool>,
) -> Result<(), String> {
    rdp_manager::launch_rdp(
        host, port, username, domain, password,
        fullscreen, width, height, multimon, admin,
    )
}

#[tauri::command]
fn load_app_config() -> Result<String, String> {
    let config_path = get_config_path()?;
    if config_path.exists() {
        std::fs::read_to_string(&config_path).map_err(|e| e.to_string())
    } else {
        Ok("{}".to_string())
    }
}

#[tauri::command]
fn save_app_config(data: String) -> Result<(), String> {
    let config_path = get_config_path()?;
    if let Some(parent) = config_path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(&config_path, data).map_err(|e| e.to_string())
}

#[tauri::command]
fn load_shared_snippets(path: String) -> Result<String, String> {
    let content = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    Ok(content)
}

#[tauri::command]
fn save_shared_snippets(path: String, data: String) -> Result<(), String> {
    std::fs::write(&path, &data).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_file_mtime(path: String) -> Result<u64, String> {
    let metadata = std::fs::metadata(&path).map_err(|e| e.to_string())?;
    let modified = metadata.modified().map_err(|e| e.to_string())?;
    let duration = modified.duration_since(UNIX_EPOCH).map_err(|e| e.to_string())?;
    Ok(duration.as_secs())
}

#[tauri::command]
fn pick_folder(default_path: Option<String>) -> Result<Option<String>, String> {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        let script = if let Some(ref p) = default_path {
            format!(
                "Add-Type -AssemblyName System.Windows.Forms; $d = New-Object System.Windows.Forms.FolderBrowserDialog; $d.SelectedPath = '{}'; if ($d.ShowDialog() -eq 'OK') {{ $d.SelectedPath }}",
                p.replace('\'', "''")
            )
        } else {
            "Add-Type -AssemblyName System.Windows.Forms; $d = New-Object System.Windows.Forms.FolderBrowserDialog; if ($d.ShowDialog() -eq 'OK') { $d.SelectedPath }".to_string()
        };
        let output = std::process::Command::new("powershell")
            .args(["-NoProfile", "-Command", &script])
            .creation_flags(CREATE_NO_WINDOW)
            .output()
            .map_err(|e| format!("Dialog error: {}", e))?;
        let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if path.is_empty() { Ok(None) } else { Ok(Some(path)) }
    }
    #[cfg(target_os = "macos")]
    {
        let output = std::process::Command::new("osascript")
            .args(["-e", "POSIX path of (choose folder)"])
            .output()
            .map_err(|e| format!("Dialog error: {}", e))?;
        let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if path.is_empty() || !output.status.success() { Ok(None) } else { Ok(Some(path)) }
    }
    #[cfg(target_os = "linux")]
    {
        let output = std::process::Command::new("zenity")
            .args(["--file-selection", "--directory"])
            .output()
            .map_err(|e| format!("Dialog error: {}", e))?;
        let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if path.is_empty() || !output.status.success() { Ok(None) } else { Ok(Some(path)) }
    }
}

#[tauri::command]
fn open_in_explorer(path: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        std::process::Command::new("explorer")
            .arg(&path)
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
            .map_err(|e| format!("Cannot open explorer: {}", e))?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("Cannot open: {}", e))?;
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("Cannot open: {}", e))?;
    }
    Ok(())
}

fn get_config_path() -> Result<std::path::PathBuf, String> {
    let data_dir = dirs::data_dir()
        .or_else(|| dirs::home_dir())
        .ok_or("Cannot determine data directory")?;
    Ok(data_dir.join("novashell").join("config.json"))
}

#[tauri::command]
fn write_shell_init_script(shell_type: String) -> Result<String, String> {
    let tmp = std::env::temp_dir();
    let (filename, content) = match shell_type.as_str() {
        "powershell" => ("novashell_init.ps1", r#"
$global:e = [char]27

# Colored prompt: user@host path >
function prompt {
    "${e}[36m$env:USERNAME${e}[90m@${e}[35m$env:COMPUTERNAME${e}[0m ${e}[34m$($executionContext.SessionState.Path.CurrentLocation)${e}[32m >${e}[0m "
}

# Colored directory listing
function global:Show-ColorDir {
    param([Parameter(ValueFromRemainingArguments=$true)][string[]]$Paths)
    if (-not $Paths) { $Paths = @('.') }
    foreach ($Path in $Paths) {
        $items = Get-ChildItem -Path $Path -Force:$false -ErrorAction SilentlyContinue
        foreach ($item in $items) {
            $n = $item.Name
            $sz = if ($item.PSIsContainer) { '<DIR>   ' } else { '{0,8}' -f $item.Length }
            $dt = $item.LastWriteTime.ToString('MM/dd HH:mm')
            $colored = if ($item.PSIsContainer) {
                "${e}[1;34m${n}/${e}[0m"
            } elseif ($item.Extension -match '\.(exe|cmd|bat|ps1|msi|com)$') {
                "${e}[1;32m${n}${e}[0m"
            } elseif ($item.Extension -match '\.(zip|tar|gz|7z|rar|bz2|xz)$') {
                "${e}[1;31m${n}${e}[0m"
            } elseif ($item.Extension -match '\.(jpg|jpeg|png|gif|bmp|svg|ico|webp)$') {
                "${e}[1;35m${n}${e}[0m"
            } elseif ($item.Extension -match '\.(mp3|mp4|avi|mkv|wav|flac|mov)$') {
                "${e}[1;36m${n}${e}[0m"
            } elseif ($item.Extension -match '\.(doc|docx|pdf|xls|xlsx|ppt|pptx|txt|md)$') {
                "${e}[33m${n}${e}[0m"
            } elseif ($n.StartsWith('.')) {
                "${e}[90m${n}${e}[0m"
            } else {
                $n
            }
            "  ${e}[90m${dt}${e}[0m  ${e}[33m${sz}${e}[0m  ${colored}"
        }
    }
}
# Remove built-in ls alias first, then define function
# On PS 5.1 ls is AllScope so Remove-Item may fail — that's OK, function still wins
try { Remove-Item alias:\ls -Force -ErrorAction Stop } catch {}
function global:ls { Show-ColorDir @args }
function global:ll { Show-ColorDir @args }
function global:dir { Show-ColorDir @args }

# PSReadLine syntax colors
try {
    Set-PSReadLineOption -Colors @{
        Command   = 'Green'
        Parameter = 'DarkCyan'
        String    = 'DarkYellow'
        Operator  = 'DarkGray'
        Variable  = 'Cyan'
        Number    = 'Yellow'
        Type      = 'Blue'
        Comment   = 'DarkGreen'
        Keyword   = 'Magenta'
    }
} catch {}

Clear-Host
"#),
        "cmd" => ("novashell_init.cmd", r#"@echo off
prompt $E[36m%USERNAME%$E[90m@$E[35m%COMPUTERNAME%$E[0m $E[34m$P$E[32m $g$E[0m
cls
"#),
        "bash" => ("novashell_init.sh", r#"
export PS1='\[\e[36m\]\u\[\e[90m\]@\[\e[35m\]\h\[\e[0m\] \[\e[34m\]\w\[\e[32m\] \$\[\e[0m\] '
export CLICOLOR=1
export LS_COLORS='di=1;34:fi=0:ln=1;36:pi=33:so=1;35:bd=1;33:cd=1;33:or=31:mi=31:ex=1;32:*.zip=1;31:*.tar=1;31:*.gz=1;31:*.jpg=1;35:*.png=1;35:*.mp3=1;36:*.mp4=1;36:*.pdf=33:*.md=33'
alias ls='ls --color=auto'
alias ll='ls -la --color=auto'
alias grep='grep --color=auto'
clear
"#),
        "zsh" => ("novashell_init.zsh", r#"
export PROMPT='%F{cyan}%n%F{8}@%F{magenta}%m%f %F{blue}%~%F{green} %%%f '
export CLICOLOR=1
export LS_COLORS='di=1;34:fi=0:ln=1;36:pi=33:so=1;35:bd=1;33:cd=1;33:or=31:mi=31:ex=1;32:*.zip=1;31:*.tar=1;31:*.gz=1;31:*.jpg=1;35:*.png=1;35:*.mp3=1;36:*.mp4=1;36:*.pdf=33:*.md=33'
alias ls='ls --color=auto'
alias ll='ls -la --color=auto'
alias grep='grep --color=auto'
clear
"#),
        _ => return Err("Unknown shell type".to_string()),
    };

    let path = tmp.join(filename);
    std::fs::write(&path, content).map_err(|e| format!("Failed to write init script: {}", e))?;
    Ok(path.to_string_lossy().to_string())
}

const ALLOWED_COMMANDS: &[&str] = &[
    "git", "docker", "node", "npm", "npx", "python", "python3", "pip", "pip3",
    "hostname", "uptime", "powershell", "powershell.exe",
    "kubectl", "cargo", "rustc", "go", "java", "javac",
];

#[tauri::command]
fn run_command_output(command: String, args: Vec<String>, cwd: Option<String>) -> Result<String, String> {
    // Extract base command name (strip path and extension)
    let base = std::path::Path::new(&command)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or(&command)
        .to_lowercase();

    if !ALLOWED_COMMANDS.iter().any(|&allowed| base == allowed) {
        return Err(format!("Command '{}' is not in the allowed list", command));
    }

    // Use provided cwd, or fall back to user's home directory
    let work_dir = cwd
        .map(std::path::PathBuf::from)
        .or_else(|| dirs::home_dir())
        .unwrap_or_else(|| std::path::PathBuf::from("."));

    #[cfg(windows)]
    let output = {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;

        // Try direct execution first — works for .exe files (git, node, python, etc.)
        let direct = {
            let mut cmd = std::process::Command::new(&command);
            cmd.args(&args)
                .current_dir(&work_dir)
                .stdout(std::process::Stdio::piped())
                .stderr(std::process::Stdio::piped())
                .creation_flags(CREATE_NO_WINDOW);
            cmd.output()
        };

        match direct {
            Ok(out) => out,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                // Command not found as .exe — retry via cmd /c for .cmd/.bat scripts (npm, npx)
                let mut cmd = std::process::Command::new("cmd");
                cmd.arg("/c")
                    .arg(&command)
                    .args(&args)
                    .current_dir(&work_dir)
                    .stdout(std::process::Stdio::piped())
                    .stderr(std::process::Stdio::piped())
                    .creation_flags(CREATE_NO_WINDOW);
                cmd.output()
                    .map_err(|e2| format!("Failed to run '{}': {}", command, e2))?
            }
            Err(e) => return Err(format!("Failed to run '{}': {}", command, e)),
        }
    };

    #[cfg(not(windows))]
    let output = {
        let mut cmd = std::process::Command::new(&command);
        cmd.args(&args)
            .current_dir(&work_dir)
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped());
        cmd.output()
            .map_err(|e| format!("Failed to run '{}': {}", command, e))?
    };

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        Err(format!("{}", stderr.trim()))
    }
}

// ─── Ollama AI Commands ───

#[tauri::command]
async fn ai_health() -> Result<bool, String> {
    ai_manager::check_health().await
}

#[tauri::command]
async fn ai_list_models() -> Result<Vec<ai_manager::OllamaModel>, String> {
    ai_manager::list_models().await
}

#[tauri::command]
async fn ai_pull_model(model: String) -> Result<(), String> {
    ai_manager::pull_model(&model).await
}

#[tauri::command]
async fn ai_chat(
    model: String,
    system_prompt: String,
    messages: Vec<ai_manager::ChatMessage>,
) -> Result<String, String> {
    ai_manager::chat(&model, &system_prompt, &messages).await
}

#[tauri::command]
async fn ai_generate_session_doc(
    commands: Vec<String>,
    errors: Vec<String>,
    duration_minutes: u64,
) -> Result<String, String> {
    ai_manager::generate_session_doc(&commands, &errors, duration_minutes).await
}

#[tauri::command]
async fn ai_generate_session_doc_with_template(
    commands: Vec<String>,
    errors: Vec<String>,
    duration_minutes: u64,
    template_structure: String,
) -> Result<String, String> {
    ai_manager::generate_session_doc_with_template(&commands, &errors, duration_minutes, &template_structure).await
}

#[tauri::command]
fn save_pdf_to_downloads(bytes: Vec<u8>, filename: String) -> Result<String, String> {
    let safe_filename = std::path::Path::new(&filename)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("export.pdf");
    let downloads = dirs::download_dir()
        .or_else(|| dirs::home_dir().map(|h| h.join("Downloads")))
        .unwrap_or_else(|| std::path::PathBuf::from("."));
    let dest = downloads.join(safe_filename);
    std::fs::write(&dest, &bytes).map_err(|e| format!("Write error: {}", e))?;
    Ok(dest.to_string_lossy().to_string())
}

// ─── Session Doc Commands ───

#[tauri::command]
fn session_doc_save(
    content: String,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let mgr = state.session_doc_manager.lock()
        .map_err(|e| format!("Lock error: {}", e))?;
    mgr.save_doc(&content)
}

#[tauri::command]
fn session_doc_list(
    state: State<'_, AppState>,
) -> Result<Vec<session_doc_manager::SessionDocInfo>, String> {
    let mgr = state.session_doc_manager.lock()
        .map_err(|e| format!("Lock error: {}", e))?;
    mgr.list_docs()
}

#[tauri::command]
fn session_doc_load(
    filename: String,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let mgr = state.session_doc_manager.lock()
        .map_err(|e| format!("Lock error: {}", e))?;
    mgr.load_doc(&filename)
}

#[tauri::command]
fn session_doc_delete(
    filename: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let mgr = state.session_doc_manager.lock()
        .map_err(|e| format!("Lock error: {}", e))?;
    mgr.delete_doc(&filename)
}

#[tauri::command]
fn export_file_to_downloads(filename: String, content: String) -> Result<String, String> {
    let safe_filename = std::path::Path::new(&filename)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("export.txt");
    let downloads = dirs::download_dir()
        .or_else(|| dirs::home_dir().map(|h| h.join("Downloads")))
        .unwrap_or_else(|| std::path::PathBuf::from("."));
    let dest = downloads.join(safe_filename);
    std::fs::write(&dest, &content).map_err(|e| format!("Export error: {}", e))?;
    Ok(dest.to_string_lossy().to_string())
}

#[tauri::command]
fn get_process_list(state: State<'_, AppState>) -> Result<Vec<system_info::ProcessInfo>, String> {
    let mut sys = state.system.lock()
        .map_err(|e| format!("System lock error: {}", e))?;
    Ok(system_info::get_top_processes(&mut sys, 15))
}

// ──────────── SSH Exec & Server Map ────────────

#[derive(Serialize, Deserialize, Clone)]
pub struct DetectedService {
    pub name: String,
    pub kind: String,       // "systemd" | "docker" | "port"
    pub status: String,     // "running" | "active" | "listening"
    pub port: Option<u16>,
    pub detail: String,     // version, image, etc.
}

#[tauri::command]
async fn ssh_exec(
    host: String,
    port: u16,
    username: String,
    password: Option<String>,
    private_key: Option<String>,
    command: String,
) -> Result<String, String> {
    tokio::task::spawn_blocking(move || {
        let (stdout, _) = ssh_manager::exec_command(
            &host, port, &username,
            password.as_deref(), private_key.as_deref(),
            &command,
        )?;
        Ok(stdout)
    }).await.map_err(|e| format!("Task join error: {}", e))?
}

#[tauri::command]
async fn server_map_scan(
    host: String,
    port: u16,
    username: String,
    password: Option<String>,
    private_key: Option<String>,
) -> Result<Vec<DetectedService>, String> {
    // Run all 4 detection commands in a single SSH session via compound shell command.
    // Uses unique delimiters to split the combined output into sections.
    // This avoids opening 4 separate TCP+SSH connections.
    let compound_cmd = concat!(
        "echo '===PORTS_START==='; ss -tlnp 2>/dev/null || netstat -tlnp 2>/dev/null; ",
        "echo '===SYSTEMD_START==='; systemctl list-units --type=service --state=running --no-pager --plain --no-legend 2>/dev/null; ",
        "echo '===DOCKER_START==='; docker ps --format '{{.Names}}|{{.Image}}|{{.Status}}|{{.Ports}}' 2>/dev/null; ",
        "echo '===VERSIONS_START==='; nginx -v 2>&1; apache2 -v 2>&1 | head -1; node -v 2>&1; python3 --version 2>&1; php -v 2>&1 | head -1; java -version 2>&1 | head -1; go version 2>&1; redis-server --version 2>&1; psql --version 2>&1"
    );

    let full_output = tokio::task::spawn_blocking(move || {
        ssh_manager::exec_command(
            &host, port, &username,
            password.as_deref(), private_key.as_deref(),
            compound_cmd,
        ).map(|(out, _)| out).unwrap_or_default()
    }).await.map_err(|e| format!("Task join error: {}", e))?;

    // Split the combined output into sections using delimiters
    let sections: Vec<&str> = full_output.split("===PORTS_START===").collect();
    let after_ports = sections.get(1).unwrap_or(&"");
    let parts_by_systemd: Vec<&str> = after_ports.split("===SYSTEMD_START===").collect();
    let ports_output = parts_by_systemd.first().unwrap_or(&"");
    let after_systemd = parts_by_systemd.get(1).unwrap_or(&"");
    let parts_by_docker: Vec<&str> = after_systemd.split("===DOCKER_START===").collect();
    let systemd_output = parts_by_docker.first().unwrap_or(&"");
    let after_docker = parts_by_docker.get(1).unwrap_or(&"");
    let parts_by_versions: Vec<&str> = after_docker.split("===VERSIONS_START===").collect();
    let docker_output = parts_by_versions.first().unwrap_or(&"");
    let versions = parts_by_versions.get(1).unwrap_or(&"");

    let mut services: Vec<DetectedService> = Vec::new();

    // 1. Detect listening ports
    for line in ports_output.lines().skip(1) {
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() < 4 { continue; }
        let addr = parts[3];
        if let Some(port_str) = addr.rsplit(':').next() {
            if let Ok(p) = port_str.parse::<u16>() {
                let process = parts.get(5).or(parts.get(6)).unwrap_or(&"").to_string();
                let svc_name = match p {
                    22 => "SSH", 80 => "HTTP", 443 => "HTTPS", 3306 => "MySQL",
                    5432 => "PostgreSQL", 6379 => "Redis", 8080 => "HTTP-Alt",
                    27017 => "MongoDB", 9090 => "Prometheus", 3000 => "Grafana/Dev",
                    5000 => "Flask/Dev", 8443 => "HTTPS-Alt", 9200 => "Elasticsearch",
                    _ => "Service",
                };
                services.push(DetectedService {
                    name: svc_name.to_string(),
                    kind: "port".to_string(),
                    status: "listening".to_string(),
                    port: Some(p),
                    detail: process.trim_start_matches("users:((\"").trim_end_matches("\"))").to_string(),
                });
            }
        }
    }

    // 2. Detect systemd services
    for line in systemd_output.lines() {
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.is_empty() { continue; }
        let unit = parts[0].trim_end_matches(".service");
        // Skip generic/internal services
        if unit.starts_with("sys-") || unit.starts_with("user@") || unit.contains("dbus")
            || unit.contains("systemd-") || unit.contains("getty") || unit.contains("cron")
            || unit.contains("snapd") || unit.contains("unattended") {
            continue;
        }
        // Avoid duplicating port-based entries
        let already = services.iter().any(|s| s.name.to_lowercase().contains(&unit.to_lowercase()));
        if !already {
            services.push(DetectedService {
                name: unit.to_string(),
                kind: "systemd".to_string(),
                status: "running".to_string(),
                port: None,
                detail: parts.get(4..).map(|p| p.join(" ")).unwrap_or_default(),
            });
        }
    }

    // 3. Detect Docker containers
    for line in docker_output.lines() {
        let parts: Vec<&str> = line.split('|').collect();
        if parts.len() < 3 { continue; }
        services.push(DetectedService {
            name: parts[0].to_string(),
            kind: "docker".to_string(),
            status: parts.get(2).unwrap_or(&"").to_string(),
            port: None,
            detail: format!("{} — {}", parts.get(1).unwrap_or(&""), parts.get(3).unwrap_or(&"")),
        });
    }

    // 4. Get versions of common services
    for line in versions.lines() {
        let line = line.trim();
        if line.is_empty() || line.contains("not found") || line.contains("No such") { continue; }
        // Try to enrich existing services with version info
        let lower = line.to_lowercase();
        for svc in services.iter_mut() {
            let svc_lower = svc.name.to_lowercase();
            if (svc_lower.contains("nginx") && lower.contains("nginx"))
                || (svc_lower.contains("apache") && lower.contains("apache"))
                || (svc_lower.contains("redis") && lower.contains("redis"))
                || (svc_lower.contains("postgres") && lower.contains("psql"))
            {
                svc.detail = line.to_string();
            }
        }
    }

    // Sort then dedup — dedup_by only removes adjacent duplicates
    services.sort_by(|a, b| (&a.name, a.port).cmp(&(&b.name, b.port)));
    services.dedup_by(|a, b| a.name == b.name && a.port == b.port);

    Ok(services)
}

#[derive(Serialize, Deserialize, Clone)]
pub struct ServerSystemInfo {
    pub os: String,
    pub kernel: String,
    pub uptime: String,
    pub cpu_count: String,
    pub ram_usage: String,
    pub disk_usage: String,
}

#[tauri::command]
async fn server_map_system_info(
    host: String,
    port: u16,
    username: String,
    password: Option<String>,
    private_key: Option<String>,
) -> Result<ServerSystemInfo, String> {
    let cmd = r#"echo "KERNEL:$(uname -srm)"; echo "OS:$(cat /etc/os-release 2>/dev/null | grep PRETTY_NAME | cut -d= -f2 | tr -d '"' || uname -o)"; echo "UPTIME:$(uptime -p 2>/dev/null || uptime | sed 's/.*up/up/')"; echo "CPU:$(nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo '?')"; echo "RAM:$(free -m 2>/dev/null | awk '/Mem:/{printf "%s/%sMB", $3, $2}' || echo 'N/A')"; echo "DISK:$(df -h / 2>/dev/null | awk 'NR==2{printf "%s/%s (%s)", $3, $2, $5}' || echo 'N/A')"#;

    let cmd_owned = cmd.to_string();
    tokio::task::spawn_blocking(move || {
        let (out, _) = ssh_manager::exec_command(
            &host, port, &username,
            password.as_deref(), private_key.as_deref(), &cmd_owned,
        )?;

        let mut info = ServerSystemInfo {
            os: String::new(), kernel: String::new(), uptime: String::new(),
            cpu_count: String::new(), ram_usage: String::new(), disk_usage: String::new(),
        };
        for line in out.lines() {
            if let Some(v) = line.strip_prefix("KERNEL:") { info.kernel = v.trim().to_string(); }
            else if let Some(v) = line.strip_prefix("OS:") { info.os = v.trim().to_string(); }
            else if let Some(v) = line.strip_prefix("UPTIME:") { info.uptime = v.trim().to_string(); }
            else if let Some(v) = line.strip_prefix("CPU:") { info.cpu_count = v.trim().to_string(); }
            else if let Some(v) = line.strip_prefix("RAM:") { info.ram_usage = v.trim().to_string(); }
            else if let Some(v) = line.strip_prefix("DISK:") { info.disk_usage = v.trim().to_string(); }
        }
        Ok(info)
    }).await.map_err(|e| format!("Task join error: {}", e))?
}

#[derive(Serialize, Deserialize, Clone)]
pub struct ServerQuickStats {
    pub cpu_percent: String,
    pub mem_percent: String,
    pub disk_percent: String,
    pub load_avg: String,
    pub top_processes: Vec<String>,
}

#[tauri::command]
async fn server_map_quick_stats(
    host: String,
    port: u16,
    username: String,
    password: Option<String>,
    private_key: Option<String>,
) -> Result<ServerQuickStats, String> {
    let cmd = r#"echo "CPU:$(top -bn1 2>/dev/null | grep 'Cpu(s)' | awk '{printf "%.1f", $2+$4}' || echo '0')"; echo "MEM:$(free 2>/dev/null | awk '/Mem:/{printf "%.1f", $3/$2*100}' || echo '0')"; echo "DISK:$(df / 2>/dev/null | awk 'NR==2{gsub(/%/,"",$5); print $5}' || echo '0')"; echo "LOAD:$(cat /proc/loadavg 2>/dev/null | cut -d' ' -f1-3 || uptime | sed 's/.*load average: //')"; echo "---PROCS---"; ps aux --sort=-%cpu 2>/dev/null | awk 'NR>1 && NR<=6{printf "%s %s%% %s\n", $11, $3, $4}'"#;

    let cmd_owned = cmd.to_string();
    tokio::task::spawn_blocking(move || {
        let (out, _) = ssh_manager::exec_command(
            &host, port, &username,
            password.as_deref(), private_key.as_deref(), &cmd_owned,
        )?;

        let mut stats = ServerQuickStats {
            cpu_percent: "0".into(), mem_percent: "0".into(),
            disk_percent: "0".into(), load_avg: "".into(),
            top_processes: Vec::new(),
        };
        let mut in_procs = false;
        for line in out.lines() {
            if line.contains("---PROCS---") { in_procs = true; continue; }
            if in_procs {
                if !line.trim().is_empty() { stats.top_processes.push(line.trim().to_string()); }
            } else if let Some(v) = line.strip_prefix("CPU:") { stats.cpu_percent = v.trim().to_string(); }
            else if let Some(v) = line.strip_prefix("MEM:") { stats.mem_percent = v.trim().to_string(); }
            else if let Some(v) = line.strip_prefix("DISK:") { stats.disk_percent = v.trim().to_string(); }
            else if let Some(v) = line.strip_prefix("LOAD:") { stats.load_avg = v.trim().to_string(); }
        }
        Ok(stats)
    }).await.map_err(|e| format!("Task join error: {}", e))?
}

// ──────────── Hacking Mode Commands ────────────

#[tauri::command]
async fn hacking_detect_environment() -> Result<hacking_manager::EnvironmentInfo, String> {
    tokio::task::spawn_blocking(|| hacking_manager::detect_environment())
        .await.map_err(|e| format!("Task join error: {}", e))
}

#[tauri::command]
async fn hacking_scan_ports(target: String) -> Result<Vec<hacking_manager::PortScanResult>, String> {
    tokio::task::spawn_blocking(move || hacking_manager::scan_common_ports(&target))
        .await.map_err(|e| format!("Task join error: {}", e))
}

#[tauri::command]
async fn hacking_scan_custom_ports(target: String, ports: Vec<u16>) -> Result<Vec<hacking_manager::PortScanResult>, String> {
    tokio::task::spawn_blocking(move || hacking_manager::scan_ports(&target, &ports))
        .await.map_err(|e| format!("Task join error: {}", e))
}

#[tauri::command]
async fn hacking_grab_banner(host: String, port: u16) -> Result<Option<String>, String> {
    tokio::task::spawn_blocking(move || hacking_manager::grab_banner(&host, port))
        .await.map_err(|e| format!("Task join error: {}", e))
}

#[tauri::command]
fn hacking_network_map(
    env: hacking_manager::EnvironmentInfo,
    ports: Vec<hacking_manager::PortScanResult>,
) -> String {
    hacking_manager::generate_network_map(&env, &ports)
}

#[tauri::command]
fn hacking_get_scripts() -> Vec<hacking_manager::PentestScript> {
    hacking_manager::get_pentest_scripts()
}

#[tauri::command]
fn hacking_generate_report(
    env: hacking_manager::EnvironmentInfo,
    ports: Vec<hacking_manager::PortScanResult>,
) -> String {
    hacking_manager::generate_security_report(&env, &ports)
}

#[tauri::command]
fn hacking_save_session(data: String, password: String) -> Result<String, String> {
    let encrypted = hacking_manager::encrypt_data(&data, &password);
    let data_dir = dirs::data_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join("novashell")
        .join("hacking_sessions");
    std::fs::create_dir_all(&data_dir)
        .map_err(|e| format!("Cannot create directory: {}", e))?;
    let filename = format!("session_{}.enc", chrono_timestamp());
    let filepath = data_dir.join(&filename);
    std::fs::write(&filepath, &encrypted)
        .map_err(|e| format!("Cannot write session: {}", e))?;
    Ok(filename)
}

#[tauri::command]
fn hacking_load_session(filename: String, password: String) -> Result<String, String> {
    if filename.contains("..") || filename.contains('/') || filename.contains('\\') {
        return Err("Invalid filename".to_string());
    }
    let data_dir = dirs::data_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join("novashell")
        .join("hacking_sessions");
    let filepath = data_dir.join(&filename);
    let data = std::fs::read(&filepath)
        .map_err(|e| format!("Cannot read session: {}", e))?;
    Ok(hacking_manager::decrypt_data(&data, &password))
}

#[tauri::command]
fn hacking_list_sessions() -> Result<Vec<String>, String> {
    let data_dir = dirs::data_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join("novashell")
        .join("hacking_sessions");
    if !data_dir.exists() {
        return Ok(Vec::new());
    }
    let mut sessions = Vec::new();
    for entry in std::fs::read_dir(&data_dir).map_err(|e| format!("Read error: {}", e))? {
        if let Ok(entry) = entry {
            if let Some(name) = entry.file_name().to_str() {
                if name.ends_with(".enc") {
                    sessions.push(name.to_string());
                }
            }
        }
    }
    sessions.sort_by(|a, b| b.cmp(a)); // newest first
    Ok(sessions)
}

#[tauri::command]
fn hacking_delete_session(filename: String) -> Result<(), String> {
    if filename.contains("..") || filename.contains('/') || filename.contains('\\') {
        return Err("Invalid filename".to_string());
    }
    let data_dir = dirs::data_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join("novashell")
        .join("hacking_sessions");
    let filepath = data_dir.join(&filename);
    std::fs::remove_file(&filepath).map_err(|e| format!("Delete error: {}", e))
}

// ──────────── NEW Hacking Commands ────────────

#[tauri::command]
async fn hacking_ping_sweep(subnet: String) -> Result<Vec<hacking_manager::PingSweepResult>, String> {
    tokio::task::spawn_blocking(move || hacking_manager::ping_sweep(&subnet))
        .await.map_err(|e| format!("Task join error: {}", e))?
}

#[tauri::command]
async fn hacking_http_security(url: String) -> Result<hacking_manager::HttpSecurityResult, String> {
    hacking_manager::analyze_http_security(&url).await
}

#[tauri::command]
async fn hacking_wifi_scan() -> Result<Vec<hacking_manager::WifiNetwork>, String> {
    tokio::task::spawn_blocking(|| hacking_manager::scan_wifi())
        .await.map_err(|e| format!("Task join error: {}", e))?
}

#[tauri::command]
fn hacking_subnet_calc(ip: String, cidr: u8) -> Result<hacking_manager::SubnetInfo, String> {
    hacking_manager::calculate_subnet(&ip, cidr)
}

#[tauri::command]
async fn hacking_dns_enum(domain: String) -> Result<hacking_manager::DnsResult, String> {
    tokio::task::spawn_blocking(move || hacking_manager::dns_enumerate(&domain))
        .await.map_err(|e| format!("Task join error: {}", e))?
}

#[tauri::command]
async fn hacking_http_forge(request: hacking_manager::HttpForgeRequest) -> Result<hacking_manager::HttpForgeResponse, String> {
    hacking_manager::http_forge(request).await
}

// ──────────── SFTP Commands ────────────

#[tauri::command]
async fn sftp_connect(
    host: String,
    port: u16,
    username: String,
    password: Option<String>,
    private_key: Option<String>,
    state: State<'_, AppState>,
) -> Result<String, String> {
    {
        let sessions = state.sftp_sessions.lock()
            .map_err(|e| format!("SFTP session lock error: {}", e))?;
        if sessions.len() >= MAX_SFTP_SESSIONS {
            return Err(format!(
                "Maximum number of SFTP sessions reached ({}). Disconnect an existing session and try again.",
                MAX_SFTP_SESSIONS
            ));
        }
    }
    let session_id = uuid::Uuid::new_v4().to_string();
    let sid = session_id.clone();
    let session = tokio::task::spawn_blocking(move || {
        sftp_manager::SftpSession::new(
            &host, port, &username,
            password.as_deref(), private_key.as_deref(), &sid,
        )
    }).await.map_err(|e| format!("Task join error: {}", e))??;

    {
        let mut sessions = state.sftp_sessions.lock()
            .map_err(|e| format!("SFTP session lock error: {}", e))?;
        // Re-check after the (slow) handshake to defend against concurrent
        // creates that all passed the initial check.
        if sessions.len() >= MAX_SFTP_SESSIONS {
            return Err(format!(
                "Maximum number of SFTP sessions reached ({}). Disconnect an existing session and try again.",
                MAX_SFTP_SESSIONS
            ));
        }
        sessions.insert(session_id.clone(), std::sync::Arc::new(session));
    }

    Ok(session_id)
}

#[tauri::command]
fn sftp_disconnect(
    session_id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let mut sessions = state.sftp_sessions.lock()
        .map_err(|e| format!("SFTP session lock error: {}", e))?;
    if sessions.remove(&session_id).is_some() {
        Ok(())
    } else {
        Err(format!("SFTP session '{}' not found", session_id))
    }
}

#[tauri::command]
async fn sftp_list_dir(
    session_id: String,
    path: String,
    state: State<'_, AppState>,
) -> Result<Vec<sftp_manager::RemoteFileEntry>, String> {
    let session = {
        let sessions = state.sftp_sessions.lock()
            .map_err(|e| format!("SFTP session lock error: {}", e))?;
        std::sync::Arc::clone(sessions.get(&session_id)
            .ok_or_else(|| format!("SFTP session '{}' not found", session_id))?)
    };
    tokio::task::spawn_blocking(move || session.list_dir(&path))
        .await.map_err(|e| format!("Task join error: {}", e))?
}

#[tauri::command]
async fn sftp_download(
    session_id: String,
    remote_path: String,
    local_path: String,
    state: State<'_, AppState>,
) -> Result<u64, String> {
    let session = {
        let sessions = state.sftp_sessions.lock()
            .map_err(|e| format!("SFTP session lock error: {}", e))?;
        std::sync::Arc::clone(sessions.get(&session_id)
            .ok_or_else(|| format!("SFTP session '{}' not found", session_id))?)
    }; // HashMap lock released here — won't block other SFTP commands during transfer
    tokio::task::spawn_blocking(move || session.download_file(&remote_path, &local_path))
        .await.map_err(|e| format!("Task join error: {}", e))?
}

#[tauri::command]
async fn sftp_upload(
    session_id: String,
    local_path: String,
    remote_path: String,
    state: State<'_, AppState>,
) -> Result<u64, String> {
    let session = {
        let sessions = state.sftp_sessions.lock()
            .map_err(|e| format!("SFTP session lock error: {}", e))?;
        std::sync::Arc::clone(sessions.get(&session_id)
            .ok_or_else(|| format!("SFTP session '{}' not found", session_id))?)
    }; // HashMap lock released here
    tokio::task::spawn_blocking(move || session.upload_file(&local_path, &remote_path))
        .await.map_err(|e| format!("Task join error: {}", e))?
}

#[tauri::command]
async fn sftp_download_dir(
    session_id: String,
    remote_path: String,
    local_path: String,
    state: State<'_, AppState>,
) -> Result<u64, String> {
    let session = {
        let sessions = state.sftp_sessions.lock()
            .map_err(|e| format!("SFTP session lock error: {}", e))?;
        std::sync::Arc::clone(sessions.get(&session_id)
            .ok_or_else(|| format!("SFTP session '{}' not found", session_id))?)
    };
    tokio::task::spawn_blocking(move || session.download_dir(&remote_path, &local_path))
        .await.map_err(|e| format!("Task join error: {}", e))?
}

#[tauri::command]
async fn sftp_upload_dir(
    session_id: String,
    local_path: String,
    remote_path: String,
    state: State<'_, AppState>,
) -> Result<u64, String> {
    let session = {
        let sessions = state.sftp_sessions.lock()
            .map_err(|e| format!("SFTP session lock error: {}", e))?;
        std::sync::Arc::clone(sessions.get(&session_id)
            .ok_or_else(|| format!("SFTP session '{}' not found", session_id))?)
    };
    tokio::task::spawn_blocking(move || session.upload_dir(&local_path, &remote_path))
        .await.map_err(|e| format!("Task join error: {}", e))?
}

#[tauri::command]
async fn sftp_mkdir(
    session_id: String,
    path: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let session = {
        let sessions = state.sftp_sessions.lock()
            .map_err(|e| format!("SFTP session lock error: {}", e))?;
        std::sync::Arc::clone(sessions.get(&session_id)
            .ok_or_else(|| format!("SFTP session '{}' not found", session_id))?)
    };
    tokio::task::spawn_blocking(move || session.mkdir(&path))
        .await.map_err(|e| format!("Task join error: {}", e))?
}

#[tauri::command]
async fn sftp_delete(
    session_id: String,
    path: String,
    is_dir: bool,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let session = {
        let sessions = state.sftp_sessions.lock()
            .map_err(|e| format!("SFTP session lock error: {}", e))?;
        std::sync::Arc::clone(sessions.get(&session_id)
            .ok_or_else(|| format!("SFTP session '{}' not found", session_id))?)
    };
    tokio::task::spawn_blocking(move || {
        if is_dir { session.delete_dir(&path) } else { session.delete_file(&path) }
    }).await.map_err(|e| format!("Task join error: {}", e))?
}

#[tauri::command]
async fn sftp_rename(
    session_id: String,
    old_path: String,
    new_path: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let session = {
        let sessions = state.sftp_sessions.lock()
            .map_err(|e| format!("SFTP session lock error: {}", e))?;
        std::sync::Arc::clone(sessions.get(&session_id)
            .ok_or_else(|| format!("SFTP session '{}' not found", session_id))?)
    };
    tokio::task::spawn_blocking(move || session.rename(&old_path, &new_path))
        .await.map_err(|e| format!("Task join error: {}", e))?
}

#[tauri::command]
async fn sftp_home_dir(
    session_id: String,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let session = {
        let sessions = state.sftp_sessions.lock()
            .map_err(|e| format!("SFTP session lock error: {}", e))?;
        std::sync::Arc::clone(sessions.get(&session_id)
            .ok_or_else(|| format!("SFTP session '{}' not found", session_id))?)
    };
    tokio::task::spawn_blocking(move || session.home_dir())
        .await.map_err(|e| format!("Task join error: {}", e))?
}

#[tauri::command]
async fn sftp_read_text(
    session_id: String,
    path: String,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let session = {
        let sessions = state.sftp_sessions.lock()
            .map_err(|e| format!("SFTP session lock error: {}", e))?;
        std::sync::Arc::clone(sessions.get(&session_id)
            .ok_or_else(|| format!("SFTP session '{}' not found", session_id))?)
    };
    tokio::task::spawn_blocking(move || session.read_text_file(&path, 1_048_576))
        .await.map_err(|e| format!("Task join error: {}", e))?
}

/// Save a base64 PNG screenshot to the session-docs directory, return the filename
#[tauri::command]
fn save_screenshot(data_url: String) -> Result<String, String> {
    let base64_data = data_url
        .strip_prefix("data:image/png;base64,")
        .ok_or("Invalid data URL")?;
    let bytes = base64_decode(base64_data)
        .map_err(|e| format!("Base64 decode error: {}", e))?;

    let doc_dir = dirs::data_dir()
        .or_else(|| dirs::home_dir())
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join("novashell")
        .join("session-docs")
        .join("screenshots");
    std::fs::create_dir_all(&doc_dir)
        .map_err(|e| format!("Cannot create screenshots dir: {}", e))?;

    let filename = format!("screenshot_{}.png", chrono_timestamp());
    let filepath = doc_dir.join(&filename);
    std::fs::write(&filepath, &bytes)
        .map_err(|e| format!("Write error: {}", e))?;

    Ok(filepath.to_string_lossy().to_string())
}

fn base64_decode(input: &str) -> Result<Vec<u8>, String> {
    // O(1) lookup table instead of O(64) linear scan per byte
    const DECODE: [u8; 256] = {
        let mut t = [255u8; 256];
        let chars = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        let mut i = 0;
        while i < 64 { t[chars[i] as usize] = i as u8; i += 1; }
        t
    };
    let mut buf: Vec<u8> = Vec::with_capacity(input.len() * 3 / 4);
    let mut bits: u32 = 0;
    let mut bit_count: u32 = 0;
    for &b in input.as_bytes() {
        let val = DECODE[b as usize];
        if val == 255 { continue; } // skip =, whitespace, invalid
        bits = (bits << 6) | val as u32;
        bit_count += 6;
        if bit_count >= 8 {
            bit_count -= 8;
            buf.push((bits >> bit_count) as u8);
            bits &= (1 << bit_count) - 1;
        }
    }
    Ok(buf)
}

// ──────────── Log Streams ────────────

#[tauri::command]
async fn start_log_stream(
    host: String,
    port: u16,
    username: String,
    password: Option<String>,
    private_key: Option<String>,
    command: String,
    state: State<'_, AppState>,
    app_handle: tauri::AppHandle,
) -> Result<String, String> {
    let stream_id = uuid::Uuid::new_v4().to_string();
    let sid = stream_id.clone();
    let stream = tokio::task::spawn_blocking(move || {
        ssh_manager::LogStream::new(
            &host, port, &username,
            password.as_deref(), private_key.as_deref(),
            &command, &sid, app_handle,
        )
    }).await.map_err(|e| format!("Task join error: {}", e))??;
    state.log_streams.lock()
        .map_err(|e| format!("Lock error: {}", e))?
        .insert(stream_id.clone(), stream);
    Ok(stream_id)
}

#[tauri::command]
fn stop_log_stream(
    stream_id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    state.log_streams.lock()
        .map_err(|e| format!("Lock error: {}", e))?
        .remove(&stream_id); // Drop triggers cleanup
    Ok(())
}

#[tauri::command]
fn tail_local_file(path: String, lines: u32) -> Result<String, String> {
    use std::io::{Seek, SeekFrom, BufRead, BufReader};
    let file = std::fs::File::open(&path).map_err(|e| format!("Read error: {}", e))?;
    let file_len = file.metadata().map(|m| m.len()).unwrap_or(0);
    // For small files (< 64KB), just read the whole thing
    if file_len < 65536 {
        let content = std::io::read_to_string(file).map_err(|e| format!("Read error: {}", e))?;
        let all_lines: Vec<&str> = content.lines().collect();
        let start = if all_lines.len() > lines as usize { all_lines.len() - lines as usize } else { 0 };
        return Ok(all_lines[start..].join("\n"));
    }
    // For large files, read from the end to avoid loading entire file
    let want = lines as usize;
    let chunk_size: u64 = std::cmp::min(file_len, (want as u64) * 200); // estimate ~200 bytes/line
    let mut reader = BufReader::new(file);
    reader.seek(SeekFrom::End(-(chunk_size as i64))).map_err(|e| format!("Seek error: {}", e))?;
    // Skip partial first line
    let mut _partial = String::new();
    let _ = reader.read_line(&mut _partial);
    let mut tail_lines: Vec<String> = Vec::with_capacity(want);
    for line in reader.lines() {
        if let Ok(l) = line { tail_lines.push(l); }
    }
    let start = if tail_lines.len() > want { tail_lines.len() - want } else { 0 };
    Ok(tail_lines[start..].join("\n"))
}

// ──────────── File Write ────────────

#[tauri::command]
fn write_file(path: String, content: String) -> Result<(), String> {
    std::fs::write(&path, &content).map_err(|e| format!("Write error: {}", e))
}

#[tauri::command]
async fn sftp_write_text(
    session_id: String,
    path: String,
    content: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let session = {
        let sessions = state.sftp_sessions.lock()
            .map_err(|e| format!("SFTP session lock error: {}", e))?;
        std::sync::Arc::clone(sessions.get(&session_id)
            .ok_or_else(|| format!("SFTP session '{}' not found", session_id))?)
    };
    tokio::task::spawn_blocking(move || session.write_text_file(&path, &content))
        .await.map_err(|e| format!("Task join error: {}", e))?
}

fn chrono_timestamp() -> String {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    format!("{}", now)
}

// ──────────── Collaborative Terminal Commands ────────────

#[tauri::command]
async fn collab_start_hosting(
    session_id: String,
    host_name: String,
    cols: u16,
    rows: u16,
    state: State<'_, AppState>,
    app_handle: tauri::AppHandle,
) -> Result<collab_manager::CollabHostInfo, String> {
    // Enable collab broadcast on the PTY session and get the receiver
    let (pty_rx, scrollback) = {
        let sessions = state.sessions.lock()
            .map_err(|e| format!("Session lock error: {}", e))?;
        let pty = sessions.get(&session_id)
            .ok_or_else(|| format!("PTY session '{}' not found", session_id))?;
        let rx = pty.enable_collab();
        let sb = pty.get_scrollback();
        (rx, sb)
    };

    // Create and start the collab session
    let mut collab = collab_manager::CollabSession::new(
        session_id.clone(),
        host_name,
        pty_rx,
        cols,
        rows,
    );

    let info = match collab.start(app_handle.clone(), scrollback).await {
        Ok(info) => info,
        Err(e) => {
            // Rollback: disable collab on the PTY since server failed to start
            let sessions = state.sessions.lock()
                .map_err(|e| format!("Session lock error: {}", e))?;
            if let Some(pty) = sessions.get(&session_id) {
                pty.disable_collab();
            }
            return Err(e);
        }
    };

    // Register guest input handler — when a guest with FullControl types,
    // forward their input to the PTY
    let sid_for_input = session_id.clone();
    let event_name = format!("collab-guest-input-{}", session_id);
    let app_for_listen_call = app_handle.clone();
    let app_inside_closure = app_handle.clone();

    // Use Tauri event listener to forward guest input to PTY
    use tauri::Listener;
    let listener_id = app_for_listen_call.listen(event_name, move |event| {
        // Parse the payload as a proper JSON string to handle all escape sequences
        let unescaped = match serde_json::from_str::<String>(event.payload()) {
            Ok(s) => s,
            Err(_) => return,
        };
        if unescaped.is_empty() { return; }
        let state_ref = app_inside_closure.state::<AppState>();
        let sessions = match state_ref.sessions.lock() {
            Ok(s) => s,
            Err(_) => return,
        };
        if let Some(session) = sessions.get(&sid_for_input) {
            let _ = session.write(unescaped.as_bytes());
        }
    });

    // Store the listener ID for cleanup
    {
        let mut listeners = state.collab_listener_ids.lock()
            .map_err(|e| format!("Listener lock error: {}", e))?;
        listeners.insert(session_id.clone(), listener_id);
    }

    // Store the collab session (wrapped in Arc)
    {
        let mut collab_sessions = state.collab_host_sessions.lock()
            .map_err(|e| format!("Collab lock error: {}", e))?;
        collab_sessions.insert(session_id, std::sync::Arc::new(collab));
    }

    Ok(info)
}

#[tauri::command]
async fn collab_stop_hosting(
    session_id: String,
    state: State<'_, AppState>,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    // Disable collab broadcast on the PTY session
    {
        let sessions = state.sessions.lock()
            .map_err(|e| format!("Session lock error: {}", e))?;
        if let Some(pty) = sessions.get(&session_id) {
            pty.disable_collab();
        }
    }

    // Remove and cleanup the event listener
    {
        use tauri::Listener;
        let mut listeners = state.collab_listener_ids.lock()
            .map_err(|e| format!("Listener lock error: {}", e))?;
        if let Some(id) = listeners.remove(&session_id) {
            app_handle.unlisten(id);
        }
    }

    // Remove and drop the collab session (triggers stop)
    let removed = {
        let mut collab_sessions = state.collab_host_sessions.lock()
            .map_err(|e| format!("Collab lock error: {}", e))?;
        collab_sessions.remove(&session_id)
    };
    if let Some(session) = removed {
        session.stop();
    }
    Ok(())
}

#[tauri::command]
async fn collab_join_session(
    host_address: String,
    session_code: String,
    guest_name: String,
    state: State<'_, AppState>,
    app_handle: tauri::AppHandle,
) -> Result<collab_manager::CollabJoinInfo, String> {
    let (client, join_info) = collab_manager::CollabClient::connect(
        &host_address,
        &session_code,
        &guest_name,
        app_handle,
    ).await?;

    let collab_id = client.collab_id.clone();
    {
        let mut clients = state.collab_client_sessions.lock()
            .map_err(|e| format!("Collab lock error: {}", e))?;
        clients.insert(collab_id, std::sync::Arc::new(client));
    }

    Ok(join_info)
}

#[tauri::command]
async fn collab_leave_session(
    collab_id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let removed = {
        let mut clients = state.collab_client_sessions.lock()
            .map_err(|e| format!("Collab lock error: {}", e))?;
        clients.remove(&collab_id)
    };
    if let Some(client) = removed {
        client.disconnect().await;
    }
    Ok(())
}

#[tauri::command]
async fn collab_send_input(
    collab_id: String,
    data: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let client = {
        let clients = state.collab_client_sessions.lock()
            .map_err(|e| format!("Collab lock error: {}", e))?;
        clients.get(&collab_id).cloned()
            .ok_or_else(|| format!("Collab session '{}' not found", collab_id))?
    };
    client.send_input(data).await
}

#[tauri::command]
async fn collab_send_chat(
    session_id: String,
    content: String,
    sender_name: String,
    is_host: bool,
    state: State<'_, AppState>,
) -> Result<(), String> {
    if is_host {
        let session = {
            let collab_sessions = state.collab_host_sessions.lock()
                .map_err(|e| format!("Collab lock error: {}", e))?;
            collab_sessions.get(&session_id).cloned()
                .ok_or_else(|| format!("Collab host session '{}' not found", session_id))?
        };
        session.host_chat(content, &sender_name).await
    } else {
        let client = {
            let clients = state.collab_client_sessions.lock()
                .map_err(|e| format!("Collab lock error: {}", e))?;
            clients.get(&session_id).cloned()
                .ok_or_else(|| format!("Collab client session '{}' not found", session_id))?
        };
        client.send_chat(content, &sender_name).await
    }
}

#[tauri::command]
async fn collab_set_permission(
    session_id: String,
    guest_id: String,
    permission: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let perm = match permission.as_str() {
        "FullControl" => collab_manager::CollabPermission::FullControl,
        _ => collab_manager::CollabPermission::ReadOnly,
    };
    let session = {
        let collab_sessions = state.collab_host_sessions.lock()
            .map_err(|e| format!("Collab lock error: {}", e))?;
        collab_sessions.get(&session_id).cloned()
            .ok_or_else(|| format!("Collab session '{}' not found", session_id))?
    };
    session.set_permission(&guest_id, perm).await
}

#[tauri::command]
async fn collab_kick_guest(
    session_id: String,
    guest_id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let session = {
        let collab_sessions = state.collab_host_sessions.lock()
            .map_err(|e| format!("Collab lock error: {}", e))?;
        collab_sessions.get(&session_id).cloned()
            .ok_or_else(|| format!("Collab session '{}' not found", session_id))?
    };
    session.kick_guest(&guest_id).await
}

#[tauri::command]
async fn collab_get_users(
    session_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<collab_manager::CollabUserInfo>, String> {
    let session = {
        let collab_sessions = state.collab_host_sessions.lock()
            .map_err(|e| format!("Collab lock error: {}", e))?;
        collab_sessions.get(&session_id).cloned()
            .ok_or_else(|| format!("Collab session '{}' not found", session_id))?
    };
    Ok(session.get_users().await)
}

// ──────────── Infrastructure Monitor Commands ────────────

#[tauri::command]
fn infra_monitor_start(
    connection_id: String,
    host: String,
    port: u16,
    username: String,
    password: Option<String>,
    private_key: Option<String>,
    interval: u64,
    state: State<'_, AppState>,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    let mut monitors = state.infra_monitors.lock()
        .map_err(|e| format!("Monitor lock error: {}", e))?;

    // Stop existing monitor for this connection if any
    monitors.monitors.remove(&connection_id);

    let monitor = infra_monitor::MonitoredServer::start(
        connection_id.clone(),
        host,
        port,
        username,
        password,
        private_key,
        interval,
        app_handle,
    );
    monitors.monitors.insert(connection_id, monitor);
    Ok(())
}

#[tauri::command]
fn infra_monitor_stop(
    connection_id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let mut monitors = state.infra_monitors.lock()
        .map_err(|e| format!("Monitor lock error: {}", e))?;
    monitors.monitors.remove(&connection_id); // Drop triggers stop
    Ok(())
}

#[tauri::command]
fn infra_monitor_stop_all(
    state: State<'_, AppState>,
) -> Result<(), String> {
    let mut monitors = state.infra_monitors.lock()
        .map_err(|e| format!("Monitor lock error: {}", e))?;
    monitors.monitors.clear();
    Ok(())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_single_instance::init(|_app, _args, _cwd| {}))
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(AppState {
            sessions: Mutex::new(HashMap::new()),
            ssh_sessions: RwLock::new(HashMap::new()),
            ssh_in_flight: AtomicUsize::new(0),
            sftp_sessions: Mutex::new(HashMap::new()),
            log_streams: Mutex::new(HashMap::new()),
            system: Mutex::new({
                let mut sys = sysinfo::System::new();
                system_info::init_system(&mut sys);
                sys
            }),
            cached_path_commands: Mutex::new(None),
            log_manager: Mutex::new(log_manager::LogManager::new()),
            session_doc_manager: Mutex::new(session_doc_manager::SessionDocManager::new()),
            infra_monitors: Mutex::new(infra_monitor::InfraMonitors::new()),
            collab_host_sessions: Mutex::new(HashMap::new()),
            collab_client_sessions: Mutex::new(HashMap::new()),
            collab_listener_ids: Mutex::new(HashMap::new()),
        })
        .invoke_handler(tauri::generate_handler![
            get_available_shells,
            create_pty_session,
            write_to_pty,
            resize_pty,
            close_pty_session,
            get_system_info,
            get_process_list,
            get_git_branch,
            list_directory,
            read_file_preview,
            get_command_suggestions,
            ssh_connect,
            ssh_write,
            ssh_resize,
            ssh_disconnect,
            ssh_get_scrollback,
            ssh_test_connection,
            ssh_exec,
            server_map_scan,
            server_map_system_info,
            server_map_quick_stats,
            keychain_save_password,
            keychain_get_password,
            keychain_delete_password,
            rdp_connect,
            debug_log_save,
            debug_log_list_sessions,
            debug_log_load_session,
            debug_log_delete_session,
            debug_log_cleanup,
            debug_log_get_dir,
            run_command_output,
            write_shell_init_script,
            load_app_config,
            save_app_config,
            open_in_explorer,
            save_screenshot,
            pick_folder,
            load_shared_snippets,
            save_shared_snippets,
            get_file_mtime,
            ai_health,
            ai_list_models,
            ai_pull_model,
            ai_chat,
            ai_generate_session_doc,
            ai_generate_session_doc_with_template,
            save_pdf_to_downloads,
            session_doc_save,
            session_doc_list,
            session_doc_load,
            session_doc_delete,
            export_file_to_downloads,
            hacking_detect_environment,
            hacking_scan_ports,
            hacking_scan_custom_ports,
            hacking_grab_banner,
            hacking_network_map,
            hacking_get_scripts,
            hacking_generate_report,
            hacking_save_session,
            hacking_load_session,
            hacking_list_sessions,
            hacking_delete_session,
            hacking_ping_sweep,
            hacking_http_security,
            hacking_wifi_scan,
            hacking_subnet_calc,
            hacking_dns_enum,
            hacking_http_forge,
            sftp_connect,
            sftp_disconnect,
            sftp_list_dir,
            sftp_download,
            sftp_upload,
            sftp_download_dir,
            sftp_upload_dir,
            sftp_mkdir,
            sftp_delete,
            sftp_rename,
            sftp_home_dir,
            sftp_read_text,
            sftp_write_text,
            write_file,
            start_log_stream,
            stop_log_stream,
            tail_local_file,
            infra_monitor_start,
            infra_monitor_stop,
            infra_monitor_stop_all,
            collab_start_hosting,
            collab_stop_hosting,
            collab_join_session,
            collab_leave_session,
            collab_send_input,
            collab_send_chat,
            collab_set_permission,
            collab_kick_guest,
            collab_get_users,
        ])
        .run(tauri::generate_context!())
        .expect("error while running NovaShell");
}
