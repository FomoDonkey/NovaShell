#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod ai_manager;
mod hacking_manager;
mod keychain_manager;
mod log_manager;
mod pty_manager;
mod session_doc_manager;
mod sftp_manager;
mod ssh_manager;
mod system_info;

use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::sync::Mutex;
use tauri::State;

pub struct AppState {
    pub sessions: Mutex<HashMap<String, pty_manager::PtySession>>,
    pub ssh_sessions: Mutex<HashMap<String, ssh_manager::SshSession>>,
    pub sftp_sessions: Mutex<HashMap<String, std::sync::Arc<sftp_manager::SftpSession>>>,
    pub system: Mutex<sysinfo::System>,
    pub cached_path_commands: Mutex<Option<Vec<String>>>,
    pub log_manager: Mutex<log_manager::LogManager>,
    pub session_doc_manager: Mutex<session_doc_manager::SessionDocManager>,
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
    let session_id = uuid::Uuid::new_v4().to_string();
    let session = pty_manager::PtySession::new(&shell_path, &session_id, app_handle)
        .map_err(|e| e.to_string())?;

    let mut sessions = state.sessions.lock()
        .map_err(|e| format!("Session lock error: {}", e))?;
    if sessions.len() >= 20 {
        return Err("Maximum number of terminal sessions reached (20)".to_string());
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

    if metadata.len() > 1_048_576 {
        return Err("File too large for preview (>1MB)".to_string());
    }

    std::fs::read_to_string(file_path).map_err(|e| e.to_string())
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
    {
        let sessions = state.ssh_sessions.lock()
            .map_err(|e| format!("SSH session lock error: {}", e))?;
        if sessions.len() >= 10 {
            return Err("Maximum number of SSH sessions reached (10)".to_string());
        }
    }
    let session_id = uuid::Uuid::new_v4().to_string();
    let session = ssh_manager::SshSession::new(
        &host,
        port,
        &username,
        password.as_deref(),
        private_key.as_deref(),
        &session_id,
        app_handle,
    )?;

    state.ssh_sessions.lock()
        .map_err(|e| format!("SSH session lock error: {}", e))?
        .insert(session_id.clone(), session);

    Ok(session_id)
}

#[tauri::command]
fn ssh_write(
    session_id: String,
    data: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let sessions = state.ssh_sessions.lock()
        .map_err(|e| format!("SSH session lock error: {}", e))?;
    if let Some(session) = sessions.get(&session_id) {
        session.write(data.as_bytes())
    } else {
        Err(format!("SSH session '{}' not found", session_id))
    }
}

#[tauri::command]
fn ssh_resize(
    session_id: String,
    cols: u32,
    rows: u32,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let sessions = state.ssh_sessions.lock()
        .map_err(|e| format!("SSH session lock error: {}", e))?;
    if let Some(session) = sessions.get(&session_id) {
        session.resize(cols, rows)
    } else {
        Err(format!("SSH session '{}' not found", session_id))
    }
}

#[tauri::command]
fn ssh_disconnect(
    session_id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let mut sessions = state.ssh_sessions.lock()
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
    let downloads = dirs::download_dir()
        .or_else(|| dirs::home_dir().map(|h| h.join("Downloads")))
        .unwrap_or_else(|| std::path::PathBuf::from("."));
    let dest = downloads.join(&filename);
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
    let downloads = dirs::download_dir()
        .or_else(|| dirs::home_dir().map(|h| h.join("Downloads")))
        .unwrap_or_else(|| std::path::PathBuf::from("."));
    let dest = downloads.join(&filename);
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
    let (stdout, _) = ssh_manager::exec_command(
        &host, port, &username,
        password.as_deref(), private_key.as_deref(),
        &command,
    )?;
    Ok(stdout)
}

#[tauri::command]
async fn server_map_scan(
    host: String,
    port: u16,
    username: String,
    password: Option<String>,
    private_key: Option<String>,
) -> Result<Vec<DetectedService>, String> {
    let exec = |cmd: &str| -> String {
        ssh_manager::exec_command(
            &host, port, &username,
            password.as_deref(), private_key.as_deref(),
            cmd,
        ).map(|(out, _)| out).unwrap_or_default()
    };

    let mut services: Vec<DetectedService> = Vec::new();

    // 1. Detect listening ports
    let ports_output = exec("ss -tlnp 2>/dev/null || netstat -tlnp 2>/dev/null");
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
    let systemd_output = exec("systemctl list-units --type=service --state=running --no-pager --plain --no-legend 2>/dev/null");
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
    let docker_output = exec("docker ps --format '{{.Names}}|{{.Image}}|{{.Status}}|{{.Ports}}' 2>/dev/null");
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
    let versions = exec("nginx -v 2>&1; apache2 -v 2>&1 | head -1; node -v 2>&1; python3 --version 2>&1; php -v 2>&1 | head -1; java -version 2>&1 | head -1; go version 2>&1; redis-server --version 2>&1; psql --version 2>&1");
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

    // Deduplicate by name+port
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

    let (out, _) = ssh_manager::exec_command(
        &host, port, &username,
        password.as_deref(), private_key.as_deref(), cmd,
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

    let (out, _) = ssh_manager::exec_command(
        &host, port, &username,
        password.as_deref(), private_key.as_deref(), cmd,
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
}

// ──────────── Hacking Mode Commands ────────────

#[tauri::command]
fn hacking_detect_environment() -> hacking_manager::EnvironmentInfo {
    hacking_manager::detect_environment()
}

#[tauri::command]
fn hacking_scan_ports(target: String) -> Vec<hacking_manager::PortScanResult> {
    hacking_manager::scan_common_ports(&target)
}

#[tauri::command]
fn hacking_scan_custom_ports(target: String, ports: Vec<u16>) -> Vec<hacking_manager::PortScanResult> {
    hacking_manager::scan_ports(&target, &ports)
}

#[tauri::command]
fn hacking_grab_banner(host: String, port: u16) -> Option<String> {
    hacking_manager::grab_banner(&host, port)
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
    let data_dir = dirs::data_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join("novashell")
        .join("hacking_sessions");
    let filepath = data_dir.join(&filename);
    std::fs::remove_file(&filepath).map_err(|e| format!("Delete error: {}", e))
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
        if sessions.len() >= 10 {
            return Err("Maximum number of SFTP sessions reached (10)".to_string());
        }
    }
    let session_id = uuid::Uuid::new_v4().to_string();
    let session = sftp_manager::SftpSession::new(
        &host,
        port,
        &username,
        password.as_deref(),
        private_key.as_deref(),
        &session_id,
    )?;

    state.sftp_sessions.lock()
        .map_err(|e| format!("SFTP session lock error: {}", e))?
        .insert(session_id.clone(), std::sync::Arc::new(session));

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
fn sftp_list_dir(
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
    session.list_dir(&path)
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
    session.download_file(&remote_path, &local_path)
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
    session.upload_file(&local_path, &remote_path)
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
    session.download_dir(&remote_path, &local_path)
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
    session.upload_dir(&local_path, &remote_path)
}

#[tauri::command]
fn sftp_mkdir(
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
    session.mkdir(&path)
}

#[tauri::command]
fn sftp_delete(
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
    if is_dir {
        session.delete_dir(&path)
    } else {
        session.delete_file(&path)
    }
}

#[tauri::command]
fn sftp_rename(
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
    session.rename(&old_path, &new_path)
}

#[tauri::command]
fn sftp_home_dir(
    session_id: String,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let session = {
        let sessions = state.sftp_sessions.lock()
            .map_err(|e| format!("SFTP session lock error: {}", e))?;
        std::sync::Arc::clone(sessions.get(&session_id)
            .ok_or_else(|| format!("SFTP session '{}' not found", session_id))?)
    };
    session.home_dir()
}

#[tauri::command]
fn sftp_read_text(
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
    session.read_text_file(&path, 1_048_576) // 1MB max
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
    // Simple base64 decoder
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut buf: Vec<u8> = Vec::with_capacity(input.len() * 3 / 4);
    let mut bits: u32 = 0;
    let mut bit_count: u32 = 0;
    for &b in input.as_bytes() {
        let val = if b == b'=' { continue }
        else if let Some(pos) = TABLE.iter().position(|&t| t == b) { pos as u32 }
        else { continue };
        bits = (bits << 6) | val;
        bit_count += 6;
        if bit_count >= 8 {
            bit_count -= 8;
            buf.push((bits >> bit_count) as u8);
            bits &= (1 << bit_count) - 1;
        }
    }
    Ok(buf)
}

fn chrono_timestamp() -> String {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    format!("{}", now)
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_single_instance::init(|_app, _args, _cwd| {}))
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(AppState {
            sessions: Mutex::new(HashMap::new()),
            ssh_sessions: Mutex::new(HashMap::new()),
            sftp_sessions: Mutex::new(HashMap::new()),
            system: Mutex::new(sysinfo::System::new_all()),
            cached_path_commands: Mutex::new(None),
            log_manager: Mutex::new(log_manager::LogManager::new()),
            session_doc_manager: Mutex::new(session_doc_manager::SessionDocManager::new()),
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
            ssh_test_connection,
            ssh_exec,
            server_map_scan,
            server_map_system_info,
            server_map_quick_stats,
            keychain_save_password,
            keychain_get_password,
            keychain_delete_password,
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running NovaShell");
}
