#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod keychain_manager;
mod log_manager;
mod pty_manager;
mod ssh_manager;
mod system_info;

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Mutex;
use tauri::State;

pub struct AppState {
    pub sessions: Mutex<HashMap<String, pty_manager::PtySession>>,
    pub ssh_sessions: Mutex<HashMap<String, ssh_manager::SshSession>>,
    pub system: Mutex<sysinfo::System>,
    pub cached_path_commands: Mutex<Option<Vec<String>>>,
    pub log_manager: Mutex<log_manager::LogManager>,
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
    {
        let sessions = state.sessions.lock()
            .map_err(|e| format!("Session lock error: {}", e))?;
        if sessions.len() >= 20 {
            return Err("Maximum number of terminal sessions reached (20)".to_string());
        }
    }
    let session_id = uuid::Uuid::new_v4().to_string();
    let session = pty_manager::PtySession::new(&shell_path, &session_id, app_handle)
        .map_err(|e| e.to_string())?;

    state.sessions.lock()
        .map_err(|e| format!("Session lock error: {}", e))?
        .insert(session_id.clone(), session);
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

    entries.sort_by(|a, b| {
        b.is_dir.cmp(&a.is_dir).then(a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });

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
        let mut path_cmds = Vec::new();
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
                        if !path_cmds.contains(&clean_name) {
                            path_cmds.push(clean_name);
                        }
                    }
                }
            }
        }
        path_cmds.sort();
        *cache = Some(path_cmds);
    }

    if let Some(ref path_cmds) = *cache {
        for cmd in path_cmds {
            if cmd.to_lowercase().starts_with(&prefix_lower) && suggestions.len() < 20 {
                if !suggestions.contains(cmd) {
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
fn write_shell_init_script(shell_type: String) -> Result<String, String> {
    let tmp = std::env::temp_dir();
    let (filename, content) = match shell_type.as_str() {
        "powershell" => ("novashell_init.ps1", r#"
$e = [char]27

# Colored prompt: user@host path >
function prompt {
    "${e}[36m$env:USERNAME${e}[90m@${e}[35m$env:COMPUTERNAME${e}[0m ${e}[34m$($executionContext.SessionState.Path.CurrentLocation)${e}[32m >${e}[0m "
}

# Colored directory listing
function global:Show-ColorDir {
    param([string]$Path = '.')
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
# Override ls with function (functions take precedence over AllScope aliases)
function global:ls { Show-ColorDir @args }
Set-Alias -Name ll -Value Show-ColorDir -Scope Global -Force

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

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_single_instance::init(|_app, _args, _cwd| {}))
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(AppState {
            sessions: Mutex::new(HashMap::new()),
            ssh_sessions: Mutex::new(HashMap::new()),
            system: Mutex::new(sysinfo::System::new_all()),
            cached_path_commands: Mutex::new(None),
            log_manager: Mutex::new(log_manager::LogManager::new()),
        })
        .invoke_handler(tauri::generate_handler![
            get_available_shells,
            create_pty_session,
            write_to_pty,
            resize_pty,
            close_pty_session,
            get_system_info,
            get_git_branch,
            list_directory,
            read_file_preview,
            get_command_suggestions,
            ssh_connect,
            ssh_write,
            ssh_resize,
            ssh_disconnect,
            ssh_test_connection,
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running NovaShell");
}
