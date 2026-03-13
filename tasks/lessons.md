# NovaTerm - Lessons Learned

## SSH Integration
- ssh2 Rust crate v0.9 works well for native SSH without Node.js dependency
- Channel needs mut for request_pty_size call
- Non-blocking mode needed for reader thread, blocking for writes
- Temp key files must be cleaned up immediately after use
- Passwords must never be persisted to disk (only in-memory during session)
- localStorage stores connection configs without sensitive data
- sessionPassword field excluded from localStorage serialization alongside status/sessionId/errorMessage

## Performance Optimization
- sysinfo::System::new_all() is expensive - create once in AppState and reuse with targeted refresh_cpu/refresh_memory/refresh_processes
- sysinfo 0.30 API: use refresh_cpu() (no args), global_cpu_info().cpu_usage() (not global_cpu_usage)
- Dynamic imports of @tauri-apps/api modules should be cached at module level to avoid re-importing
- React useEffect deps that include state arrays/callbacks cause constant re-execution - use refs for values only read inside callbacks
- PATH command scanning is slow on Windows (many dirs) - cache results in Rust AppState
- Debounce user-driven searches (autocomplete) to avoid flooding backend
- Merging multiple useEffects with same lifecycle reduces overhead

## PTY Batching — CRITICAL
- Single-thread batching (read + time-check in same loop) causes data to get STUCK when `reader.read()` blocks
- Symptom: backspace doesn't work, keystroke echoes delayed until next input arrives
- Fix: TWO threads — one reader (appends to shared batch), one flusher (emits every 16ms regardless)
- The flusher guarantees data is never stuck waiting for the next blocking read()
- Large batch threshold (16KB) in reader provides fast-path for bulk output (e.g., `cat` large files)

## PowerShell AllScope Aliases
- `ls`, `dir`, `cd` etc. are built-in AllScope aliases in PowerShell 5.1
- `Set-Alias -Name ls -Value X -Force` FAILS with "La opcion de AllScope no se puede quitar"
- Cannot override AllScope aliases even with `-Force` — just don't try
- Use alternative alias names like `ll` instead, or define functions directly

## xterm.js Cursor & Selection
- `allowTransparency: true` is REQUIRED for proper cursor and selection rendering in WebView2
- Without it, cursor may become invisible and text selection overlay doesn't render
- `cursorWidth: 2` helps visibility for bar-style cursors
- Selection colors (selectionBackground/selectionForeground) in theme need alpha channel with allowTransparency

## Tab Close / PTY Cleanup
- Async PTY disposal can race with terminal.dispose() causing crashes
- Fix: remove from maps FIRST, unsubscribe listeners, THEN close PTY, dispose terminal in .finally()
- Never call terminal.dispose() before PTY close_pty_session completes

## Keychain / Credential Storage
- keyring crate v2 is the best option for cross-platform secure storage (no Tauri plugin needed)
- Windows: Credential Manager (DPAPI), macOS: Keychain, Linux: Secret Service/gnome-keyring
- keyring v2 API: delete_password() not delete_credential() (v3 renamed it)
- Lucide React icons don't accept title prop - wrap in <span title="..."> instead
- Always clean up keychain entries when deleting a connection to avoid orphaned credentials

## Debug / Log Monitoring
- Terminal output (PTY data) arrives as raw strings with ANSI escape codes - strip them before parsing
- Log level detection via regex patterns for common frameworks (ERROR, WARN, INFO, etc.)
- Also detect Android logcat style (E/, W/, I/, D/, V/)
- Filter prompt lines (PS C:\>, user@host:~$) to avoid noise in log view
- Use useAppStore.getState() inside event listeners to avoid stale closures
- Limit log buffer size (2000 entries) to prevent memory issues in long sessions
- Pause feature: snapshot current logs into a ref, display from ref while paused

## Shell Selector / Dropdown
- Tab bar `overflow-x: auto` clips absolutely-positioned dropdowns — use `createPortal` to render to `document.body`
- `position: fixed` + `getBoundingClientRect()` ensures dropdown appears at correct screen coordinates
- Always close portal menus on click-outside and Escape key

## Updater / Signing
- Minisign `.sig` files are two lines (untrusted comment + base64 signature)
- Embedding multiline strings in heredoc JSON breaks JSON syntax — use `jq` to properly escape
- `jq -n --arg` handles newlines and special chars automatically

## Ghost Window / Process Spawning
- Spawning `git` process on Windows can flash a console window even with CREATE_NO_WINDOW
- Read `.git/HEAD` file directly instead of spawning `git rev-parse` — zero process creation
- Walk parent directories to find `.git/HEAD` for repos where CWD is a subdirectory

## Windows / Antivirus
- Unsigned compiled `.exe` files in project root trigger Windows Defender false positives
- Add `*.exe`, `*.msi`, `*.dmg`, etc. to `.gitignore` to prevent accidental commits
- Advise users to add project directory to Windows Defender exclusions
