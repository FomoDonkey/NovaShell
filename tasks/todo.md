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

- [x] SSH Terminal quality: match normal terminal (CanvasAddon, WebLinksAddon, theme, cursor)
- [x] v1.4.4 release: push, tag, CI/CD, publish
- [x] Debug Copilot: 3-tab system (Logs | Analysis | Performance)
- [x] Debug Copilot: errorPatterns.ts — 67 patterns across 7 categories
- [x] Debug Copilot: AnalysisView.tsx — pattern matching + expandable issue cards
- [x] Debug Copilot: PerformanceView.tsx — sparklines, session stats, process monitor
- [x] Debug Copilot: AI Layer 2 — Ollama integration for unmatched errors
- [x] Debug Copilot: TypeScript compilation verified

## Completed (recent)
- [x] Editor: Open File / Open Folder buttons in empty state and header
- [x] Editor: File browser overlay for navigating and selecting files/folders
- [x] Editor: Folder tree sidebar panel when a folder is opened
- [x] Editor: Active file highlighting in folder tree
- [x] Editor: Toggle folder panel visibility button in header
- [x] Editor: Search/filter in both file browser and folder tree

## Completed (recent)
- [x] Cross-Server Navigation: ServerContext type, navigation stacks in store
- [x] Cross-Server Navigation: serverNavigation.ts utility (resolve, parse, navigate)
- [x] Cross-Server Navigation: TerminalPanel.tsx intercept cd server:/path commands
- [x] Cross-Server Navigation: StatusBar server indicator + navigation stack display
- [x] Infrastructure Monitor: Rust backend (infra_monitor.rs) with polling thread per server
- [x] Infrastructure Monitor: 3 Tauri commands (start, stop, stop_all) + AppState field
- [x] Infrastructure Monitor: Store types (ServerMetrics, InfraAlert, InfraThresholds)
- [x] Infrastructure Monitor: Store actions (addInfraMetrics with threshold+anomaly detection)
- [x] Infrastructure Monitor: InfraMonitorPanel.tsx with Overview/Alerts/Settings views
- [x] Infrastructure Monitor: SparklineSVG (zero-dependency SVG charts)
- [x] Infrastructure Monitor: ServerCard with health score, metric bars, remediation buttons
- [x] Infrastructure Monitor: Anomaly detection (mean + 2σ spike detection)
- [x] Infrastructure Monitor: Cross-server correlation detection (30s window)
- [x] Infrastructure Monitor: Compact mode toggle
- [x] Infrastructure Monitor: One-click remediation (top, disk, memory, restart service)
- [x] Infrastructure Monitor: Sidebar tab with Gauge icon
- [x] TypeScript compilation verified
- [x] Rust compilation verified
- [x] Cross-Server Nav: filesystem-style /servers/webserver/var/www syntax
- [x] Cross-Server Nav: ls /servers command to list all available servers with status
- [x] Cross-Server Nav: improved "server not found" message with tip
- [x] StatusBar: breadcrumb navigation display (local → webserver → dbserver)
- [x] StatusBar: styled breadcrumb pill with color-coded current server
- [x] Infra Monitor: Timeline global view with date grouping + color-coded events
- [x] Infra Monitor: InfraTimelineEvent type + store (timeline state, addEvent, clearTimeline)
- [x] Infra Monitor: Auto-log alerts to timeline from addInfraMetrics
- [x] Infra Monitor: Log actions/connections/errors to timeline
- [x] Infra Monitor: Kill PID action (input + kill button per server card)
- [x] Infra Monitor: Open Terminal action (cross-server nav to server)
- [x] Infra Monitor: Clean Logs action (removes .gz, .old, .1 from /var/log)
- [x] Infra Monitor: Clean Journals action (journalctl --vacuum-size=100M)
- [x] Infra Monitor: Cache/Buffers info action
- [x] Infra Monitor: Show All Failed Services action
- [x] Infra Monitor: Context-aware action groups (CPU/MEM/DISK/Services sections)
- [x] Infra Monitor: Always-available actions even when metrics are healthy
- [x] TypeScript + Rust compilation verified (post-improvements)
- [x] Kill PID: Two-step confirm (SIGTERM/SIGKILL/Cancel) with process info before kill
- [x] Clean Logs: Scan-first approach (scan large files, scan old logs, vacuum journals 7d)
- [x] Disk Analyzer: CCleaner-style "Disk" tab in InfraMonitorPanel
- [x] Disk Analyzer: DiskPartition, DiskCategory, DiskAnalysis types in store
- [x] Disk Analyzer: SSH-based full disk scan script (partitions + 9 cleanup categories)
- [x] Disk Analyzer: Donut chart SVG per partition (zero dependencies)
- [x] Disk Analyzer: Partition cards with gradient bars + used/free/total
- [x] Disk Analyzer: Cleanup categories (logs, journals, cache, pkgcache, tmp, docker, coredumps, snaps)
- [x] Disk Analyzer: Total reclaimable calculation
- [x] Disk Analyzer: Confirm-before-clean for every cleanup action
- [x] Disk Analyzer: Auto-rescan after cleanup
- [x] Disk Analyzer: Timeline integration (scan/clean events logged)
- [x] Disk Analyzer: Multi-server support (server selector buttons)
- [x] TypeScript + Rust compilation verified (post-disk-analyzer)
- [x] Disk: Inspect/Preview flow — each category has "Inspect" button showing files before cleaning
- [x] Disk: Per-category actions (View files, Tail syslog, Show errors, Images, Volumes, Prune, Show all)
- [x] Disk: Largest Directories treemap-style bars with proportional width (du -xmd1 /)
- [x] Disk: Click directory → opens terminal at that path via cross-server nav
- [x] Disk: Disk growth tracking — compares current vs previous scan, shows +deltaMB per directory
- [x] Disk: Growth alerts panel (red) when any directory grows >500MB between scans
- [x] Disk: Multi-select cleanup with checkboxes + "Clean Selected" batch action with total summary
- [x] Disk: "Analyze Disk" button in ServerCard when disk >90% — switches to Disk tab
- [x] Disk: Safe scan script with timeout 10s/5s + -xdev (no filesystem crossing)
- [x] Disk: Cross-server terminal integration — "Terminal" button per category opens terminal at relevant path
- [x] Disk: Previous scan timestamp shown for context
- [x] Disk: Category expand/collapse with action drawer
- [x] Store: DiskLargestDir, DiskCategoryAction, DiskGrowthEntry types
- [x] Store: diskPreviousScans for growth tracking (auto-saved on rescan)
- [x] TypeScript + Rust compilation verified (post-all-improvements)

- [x] Shared Snippet Folders: 3 Rust backend commands (load_shared_snippets, save_shared_snippets, get_file_mtime)
- [x] Shared Snippet Folders: SnippetFolder.sharedPath + sharedSnippets state in appStore
- [x] Shared Snippet Folders: 5 store actions (loadSharedFolder, addSharedSnippet, removeSharedSnippet, updateSharedSnippet, addSharedSnippetFolder)
- [x] Shared Snippet Folders: UI - FolderSync button, path picker form, dashed border style, "Shared" badge
- [x] Shared Snippet Folders: Polling mtime every 3s for auto-reload on external changes
- [x] Shared Snippet Folders: i18n keys for en.ts and es.ts
- [x] Shared Snippet Folders: TypeScript + Rust compilation verified

## Completed (v2.4.5 Performance Optimization)
- [x] SSH Batching: Dual-thread reader+flusher pattern (mirrors PTY) — eliminates per-read IPC events
- [x] SSH Batching: Condvar-based flusher (50ms) — zero CPU when idle, batches rapid output
- [x] SSH Batching: AtomicBool for running flag — faster than Mutex for simple flag
- [x] SSH Write: Reduced retries 10→5, sleep 50ms→20ms — less blocking on Tauri thread
- [x] SSH Resize: Reduced sleep 100ms→50ms per retry
- [x] StatusBar: Replaced reactive alert selectors with 3s polling — eliminates re-renders on every alert
- [x] Config Save: Increased debounce 500ms→2000ms — reduces file I/O contention
- [x] Shell Init: Reduced delay PowerShell 2000ms→800ms, bash 800ms→300ms
- [x] SSHPanel ResizeObserver: Added 100ms debounce (was unbounded)
- [x] SSHPanel Keychain Check: Parallel Promise.allSettled (was sequential)
- [x] CommandPalette: Length-based selectors for history/snippets/connections
- [x] Config History: Reduced persisted entries 200→100 — smaller save payload
- [x] TypeScript compilation verified

## Completed (v2.5.0 Zero-Wait SSH Input)
- [x] SSH write fire-and-forget: invoke() no longer awaited — zero IPC wait between keystrokes
- [x] Microtask batching: all keystrokes from same JS frame sent in one IPC call
- [x] Paste via writeQueue: Ctrl+V/right-click routes through same optimized path
- [x] Session timeout 20ms→10ms: reader thread processes writes 2x faster
- [x] Shared invokeRef: paste handlers use cached invoke instead of re-importing
- [x] TypeScript + Rust compilation verified

## Completed (v2.4.9 Bug Fixes — Audit Results)
- [x] Fix: UTF-8 split across read boundaries — incomplete sequences preserved for next read (SSH + PTY)
- [x] Fix: Navigation stack unbounded growth — capped at 50 entries per tab
- [x] Fix: History mismatch (500 memory / 100 persisted) — aligned to 200 both sides
- [x] Fix: Config save/load race — scheduleSave blocked until configLoaded is true
- [x] Fix: SFTP partial file cleanup — incomplete downloads deleted on failure
- [x] Fix: Orphaned SSH sessions on navigation failure — disconnect + cleanup on error
- [x] TypeScript + Rust compilation verified

## Completed (v2.4.8 Final Polish — Re-render Elimination)
- [x] StatusBar: reduced from 15 to 8 reactive selectors (functions via getState, navStack memoized)
- [x] Write flush: queueMicrotask prevents recursive microtask buildup (SSHPanel + TerminalPanel x2)
- [x] Resize debounce: 80ms→50ms for snappier terminal resize (SSHPanel + TerminalPanel)
- [x] TypeScript + Rust compilation verified

## Completed (v2.4.7 Lock Elimination & Throughput)
- [x] SSH Reader: merged double lock into single lock scope (writes + EOF check + read in one acquire)
- [x] SSH Session timeout 50ms→20ms: aligned with flusher for faster write processing
- [x] SSH + PTY: UTF-8 fast path (str::from_utf8 → zero-alloc for 99% of data)
- [x] ssh_sessions: Mutex→RwLock: concurrent read access for ssh_write/ssh_resize (no serialization)
- [x] LogStream: 4KB→16KB buffer, batched output, no sleep polling
- [x] PTY buffer: 8KB→16KB: consistent with SSH, better throughput on large output
- [x] TypeScript + Rust compilation verified

## Completed (v2.4.6 Deep Performance Optimization)
- [x] SSH Write Queue: mpsc channel eliminates lock contention — IPC write is now instant (zero blocking)
- [x] SSH Reader Thread processes writes: all channel I/O in single thread, no Mutex contention with IPC
- [x] SSH Session timeout 100ms→50ms: reader loop iterates faster, writes processed sooner
- [x] SSH Error backoff 100-200ms→10-50ms: faster recovery from transient errors
- [x] SSH Max consecutive errors 50→15: faster dead connection detection
- [x] SSH Resize retry sleep 50ms→20ms, retries 5→3
- [x] SSH Flusher timeout 50ms→16ms (~60fps rendering)
- [x] PTY Flusher timeout 50ms→16ms (~60fps rendering)
- [x] SSHPanel: buffered async write queue (batches rapid keystrokes)
- [x] SSHPanel: debounced onResize (80ms) prevents IPC flooding during window drag
- [x] TerminalPanel: buffered async write queue for both PTY and SSH paths
- [x] TerminalPanel: debounced onResize (80ms) for PTY/SSH
- [x] TerminalPanel: fix fetchSuggestions debounce timer not cleared on early return
- [x] TypeScript + Rust compilation verified

## Completed (Collaborative Terminal Sessions)
- [x] Rust: collab_manager.rs — WebSocket server, auth, broadcast, session management, guest client
- [x] Rust: pty_manager.rs — broadcast::Sender hook + 64KB scrollback ring buffer
- [x] Rust: main.rs — 9 new Tauri commands (start/stop hosting, join/leave, chat, permissions, kick, users)
- [x] Rust: Cargo.toml — tokio-tungstenite, futures-util, rand dependencies
- [x] Store: CollabSessionInfo, CollabUser, CollabChatMessage types
- [x] Store: 12 collab actions (host/join/leave/chat/permissions/kick/users)
- [x] Store: SidebarTab "collab" added
- [x] CollabPanel.tsx — Lobby/Host/Guest/Chat views, event listeners for all collab events
- [x] CollabOverlay.tsx — Sharing/connected indicator strip on terminal tabs
- [x] TerminalPanel.tsx — Guest mode data flow (collab events instead of PTY), cleanup handling
- [x] Sidebar.tsx — Collab tab with Users icon, lazy-loaded CollabPanel
- [x] StatusBar.tsx — Collab indicator (host: guest count, guest: host name)
- [x] TabBar.tsx — Users icon for guest tabs, Share2 icon for hosted tabs
- [x] i18n: 20+ collab keys in en.ts and es.ts
- [x] CSS: terminal-instance flex layout for overlay support
- [x] TypeScript compilation verified

## Completed (v2.6.1 Bug Fixes)
- [x] Fix auto-update: separate download() from install(), use exit(0) so NSIS can replace files
- [x] Fix SSH handshake: configure_ssh_algorithms() with broad kex/hostkey/cipher/mac preferences before handshake
- [x] Fix SSH terminal black screen on reopen: double-resize trick to trigger SIGWINCH shell redraw
- [x] TypeScript + Rust compilation verified

## Completed (Paste fix nano/vim)
- [x] Fix paste into nano/vim adding extra spaces — replace manual `\x1b[200~...\x1b[201~` wrapping with `terminal.paste(text)` in SSHPanel.tsx and TerminalPanel.tsx (xterm.js handles BPM detection + CRLF→CR normalization)
- [x] Verified xterm.js 5.5.0 typings expose `paste(data)` and `bracketedPasteMode` mode tracking — fix is correct

## Completed (SSH old-connections dead-end fix)
- [x] Add `pendingSSHConnectId` + `requestSSHConnect()` + `clearPendingSSHConnect()` to appStore
- [x] SSHPanel: useEffect consumes `pendingSSHConnectId` and auto-triggers `startConnect` (opens password prompt for old saved connections without stored credentials)
- [x] TerminalPanel: when SSH-tab credentials are missing, route through `requestSSHConnect` instead of dead-ending with "Connect via SSH panel first"
- [x] TabBar: SSH-server quick-add menu now routes disconnected connections through `requestSSHConnect` instead of creating a broken tab
- [x] TypeScript compilation verified

## Completed (Deep audit pass 2 — verified bugs only)
- [x] HIGH (security): SFTP temp key file used `std::fs::remove_file` (recoverable from disk slack); replaced with `ssh_manager::secure_delete` (zero-overwrite) — `sftp_manager.rs:80`
- [x] HIGH (UX): SFTPPanel had the same encrypted-private-key silent-failure bug as SSHPanel; ported `isPassphraseError` + `isPassphrase` prompt mode + keychain pre-load to SFTPPanel
- [x] LOW (defense in depth): `log_manager::load_session`/`delete_session` only filtered `..`, `/`, `\` but didn't canonicalize. Added `safe_resolve()` helper that canonicalizes log_dir + canonicalizes the resolved path and verifies `starts_with(log_dir)` to defeat symlink-based escape
- [x] Made `secure_delete` `pub` in ssh_manager so sftp_manager can reuse it
- [x] TypeScript + Rust compilation verified clean

### False positives ruled out during the audit (do NOT re-flag in future)
- 10× "Zustand array mutation via `.length =`/`.splice()`" in appStore — all are on FRESH local arrays created with spread `[...]`, not on state. Safe.
- 4× "camelCase vs snake_case mismatch" in collab commands — Tauri 2 default behavior auto-converts `camelCase` JS args → `snake_case` Rust args. Safe.
- "saveWorkspace stale closure" — `get()` is synchronous, immediately followed by `set()`. No async gap. Safe.
- "SSHPanel:374 microtask stale activeSessionId" — closure correctly captures the activeSessionId from the effect that was active when the keystroke was queued; if user switches sessions, the IPC still goes to the correct session A in Rust. Safe.
- "PTY reader thread no join → zombie" — intentional. ConPTY blocks `read()` until master is dropped, which happens after `Drop::drop` returns. Documented and correct.
- "infra_monitor.rs:136 unwrap on systemctl parse" — actually `unwrap_or(trimmed)`, not `unwrap()`. Cannot panic.
- "collab failed_attempts TOCTOU" — cleanup and check are inside the SAME lock acquisition. Safe.
- "Sidebar interval stale closure" — effect deps `[sharedFolderIds]` recompute on folder add/remove, re-running effect with fresh closure.

## Completed (Bug-fix sweep — all HIGH/MED/LOW resolved)
- [x] HIGH: Encrypted private keys — added `isPassphrase` mode to passwordPrompt; `handleConnect` now detects libssh2 passphrase errors (passphrase/decrypt/extract/init/callback) and opens prompt; `startConnect` pre-loads stored passphrase from keychain for keyed connections
- [x] HIGH: `beforeunload` flush — pre-cache `cachedInvoke` during `loadConfig` (was only set after first save); reduced debounce 3000ms→800ms; new `flushAllPendingSync` flushes config + debug logs on `pagehide`/`beforeunload`/`visibilitychange`
- [x] MED: SSH session limit TOCTOU — added `ssh_in_flight: AtomicUsize` to AppState; `ssh_connect` reserves a slot via `fetch_add` BEFORE the handshake (RAII drop guard guarantees decrement on panic/error); final authoritative re-check inside the write-lock insert
- [x] LOW: Hard-coded session limits — extracted to `MAX_PTY_SESSIONS=50`, `MAX_SSH_SESSIONS=30`, `MAX_SFTP_SESSIONS=30` constants; PTY/SFTP now check limit BEFORE the slow spawn/handshake; error messages now tell users what to do ("Disconnect an existing session and try again")
- [x] TypeScript + Rust compilation verified clean

## Completed (SSH Lag Fix + Session Persistence)
- [x] SSH Lag: Treat libssh2 ErrorKind::Other timeout-like errors as idle (not transient with backoff)
- [x] SSH Lag: Reduced backoff for real transient errors from 20ms+ to 5ms+
- [x] SSH Scrollback: Added 64KB rolling scrollback buffer to SshSession (mirrors PTY pattern)
- [x] SSH Scrollback: Flusher thread + reader direct-emit paths all save to scrollback
- [x] SSH Scrollback: Added ssh_get_scrollback Tauri command
- [x] SSH Scrollback: SSHPanel restores scrollback when re-opening terminal for active session
- [x] Rust compilation verified (cargo check passed)

## Completed (SSH ed25519 auth on Windows — v3.3.4 through v3.3.7)
- [x] v3.3.4: `prepare_private_key()` — CRLF→LF, PPK detection, PEM header validation
- [x] v3.3.5: `vendored-openssl` on Windows + `userauth_pubkey_memory` — hung (WinCNG still active, memory API broken on WinCNG)
- [x] v3.3.6: Revert to `userauth_pubkey_file` — still errored (WinCNG still active)
- [x] v3.3.7: Add `openssl-on-win32` feature — libssh2 now defines LIBSSH2_OPENSSL → ed25519 works
- [x] CI: Strawberry Perl via PERL env var for vendored OpenSSL build on windows-latest
- [x] FileReader onerror handler in SSHPanel key upload
- [x] Installed Strawberry Perl locally via winget for local builds
- [x] Windows Defender exclusion for NovaShell folder

## Completed (RDP one-click launcher — Option A)
- [x] Store: `RDPConnection` type (id, name, host, port=3389, username, domain, fullscreen, width, height, multimon, admin, sessionPassword)
- [x] Store: `rdpConnections` state + add/update/remove actions, persistence (excludes sessionPassword)
- [x] Store: `rdp` added to `PanelTabType` + title map
- [x] Rust: `rdp_manager.rs` — Windows path uses `cmdkey /generic:TERMSRV/<host>` + temp `.rdp` file + `mstsc`; cleanup thread deletes both after 8s
- [x] Rust: input validation (no NUL/CR/LF in host/user/domain/password)
- [x] Rust: macOS path opens `rdp://...` URL (Microsoft Remote Desktop), Linux path runs `xfreerdp`
- [x] Rust: `rdp_connect` Tauri command registered in main.rs
- [x] Frontend: `RDPPanel.tsx` mirrors SSHPanel UX (list + form + per-connection Connect/Edit/Delete)
- [x] Frontend: keychain integration (save password on first connect, ShieldCheck badge, prompt with save mode)
- [x] Frontend: resolution presets (1280×800 → 2560×1440 + Fullscreen) + multimon + admin checkboxes
- [x] PanelContainer.tsx + TabBar.tsx — RDP entry in Connections menu (LayoutGrid icon)
- [x] i18n: en + es keys for rdp.*
- [x] TypeScript + Rust compilation verified

## Completed (Code panel — AI agent launcher, like Claude Desktop's Code tab)
- [x] Catalog: src/data/codeAgents.ts — 6 agents (Claude Code, Codex, Gemini CLI, OpenCode, Aider, Qwen) with cost tier (free/free-tier/byok), launch/check/install commands per OS, docs URL
- [x] Store: CodeSession type (target Local|SSH, agentId, workingDir, lastUsed), codeSessions[] state + add/update/remove actions
- [x] Store: launchCodeSession(id, agentLaunchCmd) — builds `cd <dir> && <agent>` (POSIX) or `Set-Location ...; <agent>` (Windows), routes to Local PTY or SSH tab; fallback via requestSSHConnect when SSH disconnected
- [x] Store: persisted in PersistedConfig (codeSessions in build/hydrate/config)
- [x] Store: 'code' added to PanelTabType + openPanelTab title
- [x] Store: Tab interface gets initialCommand?: string for one-shot agent launch
- [x] Store: addTab(shell, initialCommand?) and addSSHTab(connId, initialCommand?) accept optional command
- [x] TerminalPanel: PTY path sends initialCommand after spawn (1200ms PowerShell / 400ms bash); re-fetches tab+invoke since try-block scope
- [x] TerminalPanel: SSH path sends initialCommand after handshake (500ms delay)
- [x] CodePanel.tsx: agent reference strip with badges, form (target, agent, working dir), session cards with detect/launch/install/edit/delete
- [x] CodePanel: install detection (POSIX `command -v` for SSH, PowerShell Get-Command for local Windows)
- [x] CodePanel: one-click install with confirmation dialog showing the exact command before run
- [x] CodePanel: install result toast (success/failure with output excerpt)
- [x] Rust: code_panel_local_exec(command, shell) — runs PowerShell/cmd/sh one-shot with stdout+stderr capture; CREATE_NO_WINDOW on Windows; explicit confirm in UI before any install
- [x] Rust: registered in invoke_handler
- [x] PanelContainer: lazy-load CodePanel on panelType === "code"
- [x] TabBar: Code2 icon in panelIconMap + panelTabIconMap; "Code Agents" entry in Tools menu
- [x] i18n: code.* keys in en.ts + es.ts (~30 keys)
- [x] TypeScript compile clean
- [x] Rust compile clean (cargo check exit 0)

## Completed (Code panel — edit acceptance mode like Claude Desktop)
- [x] CodeAgent: flagsByMode map per agent (Claude --dangerously-skip-permissions / --permission-mode plan, Codex --full-auto, Gemini/Qwen --yolo, Aider --yes-always, OpenCode TUI-only)
- [x] CodeSession: editMode field ("manual" | "auto-accept" | "plan"), default "manual", persisted
- [x] Hydration: legacy sessions without editMode get default "manual" on load
- [x] Form: 3-button selector with icons (Hand/Zap/Eye) + color coding + per-agent support disabled state
- [x] Card: clickable mode pill with chevron → dropdown overlay shows all modes with descriptions and current marker
- [x] Launch: buildLaunchCmd appends per-mode flag → `claude --dangerously-skip-permissions` for auto on Claude
- [x] Unsupported modes per agent are visually disabled with tooltip
- [x] Outside-click + Escape close the dropdown
- [x] i18n: 8 new keys (editMode + 3 mode labels + 3 mode descriptions + notSupported) in en.ts and es.ts
- [x] TypeScript compile clean, Vite build clean

## Pending
- [ ] Test Code panel end-to-end: install Claude Code locally + run it, install Gemini CLI on a remote SSH server
- [ ] Test Collaborative Terminal with two NovaShell instances on LAN
- [ ] Test Cross-Server Navigation with real SSH servers
- [ ] Test Infrastructure Monitor with real SSH servers
- [ ] Test Debug Copilot AI analysis with live Ollama
- [ ] Test full SSH flow end-to-end
- [ ] Test debug panel with real terminal output
- [ ] Test SSH batching with large output (e.g., find /, cat large file)
- [ ] Verify Rust compilation after build cache fix
