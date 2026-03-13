# NovaTerm - Tasks

## Completed
- [x] SSH Backend (Rust): ssh_manager.rs with ssh2 crate
- [x] SSH Tauri commands: ssh_connect, ssh_write, ssh_resize, ssh_disconnect, ssh_test_connection
- [x] SSH Frontend: SSHPanel.tsx component
- [x] SSH State: Zustand store with SSHConnection type, localStorage persistence
- [x] Sidebar: SSH tab added with Monitor icon
- [x] CSS: SSH connection card styles
- [x] Rust compilation verified
- [x] TypeScript compilation verified
- [x] Performance: Cached sysinfo::System in AppState
- [x] Performance: Cached PATH commands in AppState
- [x] Performance: Cached Tauri dynamic imports
- [x] Performance: Debounced autocomplete suggestions (150ms)
- [x] Performance: Reduced TerminalPanel useEffect deps with refs
- [x] Performance: Merged StatusBar useEffects, increased intervals
- [x] Performance: Reduced scrollback from 10000 to 5000
- [x] SSH UX: Session password memory + "Remember for session" checkbox
- [x] Keychain: keyring crate v2 cross-platform credential storage
- [x] Keychain: keychain_manager.rs + 3 Tauri commands
- [x] Keychain: Password prompt with 3 save modes (keychain/session/none)
- [x] Keychain: Auto-retrieval from keychain on connect
- [x] Keychain: ShieldCheck indicator + cleanup on delete
- [x] Debug: DebugPanel with live log viewer (level/search/source filters)
- [x] Debug: Log level detection (ERROR, WARN, INFO, DEBUG, TRACE, OUTPUT)
- [x] Debug: PTY + SSH output interception → debug store
- [x] Debug: Pause/resume, export, clear, enable/disable
- [x] Debug: Expandable multiline entries, ANSI stripping
- [x] Debug: Persistent log storage to disk (JSONL files)
- [x] Debug: log_manager.rs backend (append, list, load, delete, cleanup)
- [x] Debug: 6 Tauri commands (save, list, load, delete, cleanup, get_dir)
- [x] Debug: Batched writes (2s interval) for performance
- [x] Debug: History view - browse/search/delete past sessions
- [x] Debug: Auto-cleanup logs older than 7 days
- [x] Debug: Persistence toggle (HardDrive icon) saved to localStorage
- [x] Debug: Live/History tab switcher

- [x] Snippets: Secuencias multilinea (textarea, badge N cmds)
- [x] Snippets: Shell-native sequencing (&&/;) en vez de delays
- [x] Snippets: runMode por snippet (stop-on-error / run-all)
- [x] Snippets: Selector de modo en formulario add/edit
- [x] Snippets: Badge visual del modo (&&/;) en tarjeta
- [x] Snippets: Edit inline (nombre + comandos + modo)
- [x] Snippets: Vista expandida con numeros de linea
- [x] Snippets: Ejemplo "Git Quick Push" por defecto

- [x] v1.0.4: Cyberpunk theme fix, ghost window, debug noise, perf, resource leaks
- [x] v1.0.5: Resizable sidebar (260-700px), shell selector dropdown fix
- [x] v1.0.6: Updater signing fix (jq), ghost window elimination (file-based git), notification layout
- [x] v1.0.7: Shell dropdown via portal (createPortal), revert update notification changes
- [x] v1.0.8: Snippet folder organization (drag & drop, collapsible, color-coded, rename/delete)

- [x] v1.3.1: Fix PTY batching (two-thread reader+flusher), remove AllScope alias error, restore cursor/selection, fix tab close crash

## Pending
- [ ] Push v1.3.1, tag, CI, and publish release
- [ ] Test full SSH flow end-to-end
- [ ] Test debug panel with real terminal output
