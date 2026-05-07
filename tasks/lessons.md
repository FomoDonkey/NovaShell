# NovaTerm - Lessons Learned

## Code Panel — Initial Command Injection into Fresh Terminal
- To launch an AI agent (Claude Code, Gemini CLI, etc.) inside a freshly spawned PTY/SSH tab, the cleanest pattern is: store an `initialCommand?: string` field on the Tab record, have `addTab`/`addSSHTab` accept it as an optional 2nd arg, and have `TerminalPanel` send it via the existing write queue *after* the shell prompt has appeared. Then clear it from the tab so it doesn't re-fire on remount.
- Delay timing matters: PowerShell needs ~1200ms after `create_pty_session` (matches the existing 800ms PowerShell init delay + a buffer for the prompt to render). Bash/zsh need ~400ms. SSH needs ~500ms after handshake completes (login banner + prompt).
- The `try { ... } catch {}` block inside `setupTerminal` is wide — it spans from `getTauriCore()` through the SSH/PTY init paths. `tab` and `invoke` are declared inside the try. The `terminalsRef.current.set(tabId, ...)` call at the bottom of the function is OUTSIDE the try. So initial-command code added near the bottom must re-fetch `tab` from the store and re-import `invoke` via `getTauriCore()`. The `sessionId` variable IS in outer scope (declared at the top of setupTerminal as `let sessionId: string | null = null`).
- Build the command per shell type: POSIX `cd '<dir>' && <agent>` for SSH and Linux/macOS local, `Set-Location -LiteralPath '...'; <agent>` for Windows PowerShell local. Quote with single-quotes and escape embedded single-quotes with the POSIX `'\''` sequence.
- For SSH targets where the connection isn't established, use `addSSHTab(connId, initialCommand)` + `requestSSHConnect(connId)` — the existing dead-end-recovery path opens the SSH password prompt, and if the user authenticates, the new tab will pick up the credentials and connect (and then send the initialCommand).

## Code Panel — Local Shell Exec for Install Probes
- The existing `run_command_output` in main.rs has an ALLOWED_COMMANDS allow-list and runs an exe + args (not a shell). It cannot run install one-liners like `curl ... | sh` or `npm install -g ...`.
- Pattern: a dedicated `code_panel_local_exec(command, shell)` Tauri command that runs through `powershell.exe -NoProfile -NonInteractive -Command <cmd>` on Windows, `cmd.exe /C <cmd>` for batch, or `sh -c <cmd>`/`bash -c <cmd>` on Unix. Combine stdout+stderr in the result so install diagnostics are visible.
- Always wrap in `tokio::task::spawn_blocking` since std::process::Command::output() blocks.
- Use `CREATE_NO_WINDOW=0x08000000` on Windows to prevent console flash (same pattern as the ghost-window git fix).
- Validate input: reject empty command, reject NUL byte. Don't try to allowlist — the user is going through an in-UI confirmation dialog before any install runs, and the probe commands come from the in-app catalog (not user input).
- Reject silently if confused — return Err with the exit code + both stderr and stdout snippets so the toast can show real diagnostics.

## RDP One-Click Launcher — System Client, Not Embedded
- Embedding an RDP client (FreeRDP, web RDP) is weeks of work. The right MVP is a launcher that opens the platform's native client (`mstsc.exe` on Windows, Microsoft Remote Desktop on macOS via `.rdp` file + `open -a`, `xfreerdp` on Linux).
- On Windows, `mstsc.exe` only autoreads credentials it finds under the `TERMSRV/<host>` Generic credential. Inject them with `cmdkey /generic:TERMSRV/<host> /user:<user> /pass:<pass>` BEFORE launching mstsc, then DELETE them after a delay (10s safely covers slow handshakes).
- **Probe before injecting**: a user may already have a manual credential under `TERMSRV/<host>` from prior Windows usage. Always run `cmdkey /list:TERMSRV/<host>` first; if an entry exists, skip injection AND skip the cleanup-delete (otherwise we destroy the user's pre-existing cred). Locale-safe heuristic: count occurrences of literal `TERMSRV/<host>` in stdout — appears once in header, twice when an entry's detail block is present (`s.matches(&needle).count() > 1`). Avoid parsing localized field labels like `Target:`/`Type:`.
- Track `we_injected: bool` per launch so cleanup only deletes credentials WE created. Concurrent connects to the same host fall through the probe naturally: second click sees the cred we just inserted, skips inject, skips cleanup. First click's 10s timer eventually deletes.
- For resolution / fullscreen / multimon, write a temp `.rdp` file (`screen mode id:i:2` for fullscreen, `desktopwidth:i:N`). **Use CRLF line endings** in `.rdp` files — modern mstsc tolerates LF but older Windows / macOS Microsoft Remote Desktop are stricter.
- Use `CommandExt::creation_flags(CREATE_NO_WINDOW=0x08000000)` on the `cmdkey` calls to avoid the console window flash on Windows (same pattern as ghost-window git fix).
- macOS: don't use `rdp://<key>=<val>&<key>=<val>` URLs — the host/user fields can inject extra params (e.g. `&full address=s:attacker.com` reroutes the session). Write a `.rdp` file and run `open -a "Microsoft Remote Desktop" path.rdp` instead.
- Linux xfreerdp: never pass `/p:<password>` on argv — visible to any local user via `/proc/<pid>/cmdline`. Use `/from-stdin` and pipe the password via `child.stdin`.
- Input validation: reject NUL/CR/LF/`"` everywhere; reject `\` and `/` in host; reject `\` in username when `domain` is non-empty (otherwise `format!("{}\\{}", domain, username)` produces `dom1\dom2\user` which mstsc misparses).

## Audit Discipline — Verify Every Agent Finding Before Acting
- Sub-agent audits produce a high false-positive rate (~70% in this codebase). Common false positives:
  - **"Zustand array mutation"** — flagged on `.length =` / `.splice()` calls that operate on a FRESH local array created via `[...s.foo, ...]`, not on state. These are safe.
  - **"Tauri camelCase mismatch"** — Tauri 2 default behavior auto-converts `camelCase` JS args → `snake_case` Rust args. Manually using either side is fine.
  - **"unwrap panic"** — agents misread `unwrap_or` as `unwrap`. Always read the line.
  - **"stale closure"** — when the closed-over variable is captured at effect-time and the effect re-runs on dependency change, it's not stale.
  - **"PTY reader zombie"** — intentional pattern: ConPTY blocks `read()` until master is dropped (which happens after `Drop::drop` returns).
- Rule: every agent finding must be verified by reading the cited file:line. Do NOT fix on faith. Track confirmed-vs-rejected so future audits don't re-litigate the same false positives.

## libssh2 on Windows — Two Features Required for OpenSSL Backend
- `vendored-openssl` alone only COMPILES OpenSSL from source. It does NOT tell libssh2 to use it.
- `openssl-on-win32` is also required — it sets `LIBSSH2_OPENSSL` in libssh2-sys's build.rs. Without it, build.rs defines `LIBSSH2_WINCNG` even when OpenSSL is compiled.
- WinCNG does NOT support ed25519. All v3.3.4–v3.3.6 had OpenSSL compiled but unused because `openssl-on-win32` was missing. v3.3.7 fixed this.
- `userauth_pubkey_memory` hangs on Windows when libssh2 is compiled with WinCNG (v3.3.5 regression). Stick with `userauth_pubkey_file` which errors cleanly instead of hanging.
- CI on windows-latest needs `PERL` env var pointing to `C:\Strawberry\perl\bin\perl.exe` because Git Bash's Perl lacks `Locale::Maketext::Simple`. `GITHUB_PATH` alone doesn't survive Git Bash's PATH reshuffling.

## libssh2 Private Keys — Normalize Before Writing to Temp File
- Error `public key auth:[session(-1)] unknown error` from libssh2 is a generic parse failure. On Windows the usual cause is the textarea/file-upload adding CRLF line endings, or leading/trailing whitespace, or a missing trailing newline. libssh2 is strict: it needs LF-only + trailing `\n` + no leading whitespace.
- Always funnel private-key writes through a single helper (`prepare_private_key` in ssh_manager.rs) that: rejects empty input, detects PPK (`PuTTY-User-Key-File-`) with a clear "convert in PuTTYgen" message, validates the `-----BEGIN` header, replaces `\r\n` and `\r` with `\n`, trims, and appends one trailing `\n`.
- Five call sites that MUST use it: ssh_manager (ssh_connect, log_stream, test_ssh_connection, exec_command) + sftp_manager. Missing any one reproduces the bug intermittently depending on which flow the user triggers first.
- When adding new error messages from the backend, double-check the frontend's `isPassphraseError` heuristic doesn't accidentally match them (would trigger a wrong passphrase prompt). "PPK", "Invalid private key format", "Private key is empty" are all safe.

## libssh2 Encrypted Private Keys — Reuse `password` Argument as Passphrase
- `userauth_pubkey_file(username, None, &key_path, password)` from the ssh2 crate uses the `password` arg as the **passphrase** when the key is encrypted. So you don't need a separate "passphrase" field on the wire — pipe the existing password channel through.
- libssh2 surfaces passphrase failures via several phrasings depending on key format: `"passphrase"`, `"decrypt"`, `"unable to extract public key"`, `"unable to initialize private key"`, and (for OpenSSH new-format) `"callback returned error"`. Match all of these.
- Detection-by-content of key text is unreliable (PEM has `Proc-Type: 4,ENCRYPTED` but new-format OpenSSH stores cipher metadata in a binary blob). Better pattern: try unencrypted first, catch the error, then prompt and retry.

## Tauri Beforeunload Persistence — Pre-Cache invoke
- Tauri's `@tauri-apps/api/core` `invoke` is async-imported. If the only place you cache it is inside a save handler that hasn't fired yet, then `beforeunload` will hit `cachedInvoke=null` and fall back to a dynamic import that **never resolves before unload**.
- Fix pattern: pre-cache `invoke` during `loadConfig` (which always runs at startup), so the cached reference is available from the very first frame.
- Use BOTH `pagehide` and `beforeunload` listeners. Tauri webviews fire `pagehide` more reliably than `beforeunload` on window close. Also flush opportunistically on `visibilitychange === "hidden"`.
- Async work cannot be awaited during unload — fire-and-forget the IPC call after pre-caching, the kernel sends it to Rust before the window dies.

## TOCTOU on Session Limits — Reserve Before Slow Work
- Pattern: lock → check limit → release lock → DO SLOW THING (handshake) → lock → insert. The window between check and insert is wide enough that 11+ concurrent connects can all do the slow handshake before 1 gets rejected at insert.
- Fix: an `AtomicUsize` counter for in-flight operations. `fetch_add` BEFORE the handshake, RAII guard with Drop impl to `fetch_sub` on success/failure/panic. Total = `sessions.len() + in_flight`.
- Always keep a final authoritative re-check at insert time inside the write lock — defends against extreme races where the established count itself grew since the reserve.

## SSH Quick-Tab Path Must Handle Missing Credentials
- The SSH-tab feature added in v3.3.1 (`TabBar.tsx`/`TerminalPanel.tsx::sshConnectionId` branch) calls `getConnectionCredentials(conn)` which only checks privateKey/sessionPassword/keychain. For old saved connections with no keychain entry it returns `null` and the tab dead-ends with "Connect via SSH panel first" — leaving users with no way to recover.
- Fix pattern: route to SSH panel and signal it via `requestSSHConnect(connectionId)` (store action), which sets `pendingSSHConnectId`. SSHPanel watches that field and auto-runs `startConnect` so the existing password prompt UI opens.
- Lesson: any new "shortcut" entry point to SSH (palette, sidebar, tab+menu) MUST go through the same prompt-capable path, not bypass it. Never write a code path that produces an actionable error the user can't act on.

## Bracketed Paste — NEVER wrap manually
- Sending `\x1b[200~...\x1b[201~` unconditionally is WRONG. Those markers must only be emitted when the remote app has enabled BPM via DECSET 2004 (`\x1b[?2004h`). Otherwise the leading ESC is read as Meta+`[`, the literal `200~` reaches the shell as keystrokes, and the body of the paste is still subject to vim/nano auto-indent → "extra spaces" symptom the user reported.
- Also, manual wrapping skips CRLF→CR normalization, so Windows clipboard `\r\n` produces double newlines.
- CORRECT: call `terminal.paste(text)` from xterm.js. It tracks BPM state internally, normalizes line endings, and emits via `onData` so existing write queues still apply.
- Files: `SSHPanel.tsx::pasteToSession`, `TerminalPanel.tsx::pasteToLiveSession`.

## UTF-8 Boundary Handling — CRITICAL (v2.4.9)
- A 16KB read buffer can split a multi-byte UTF-8 character (e.g., emoji, CJK) between two reads
- `str::from_utf8()` fails with `Utf8Error` which has `valid_up_to()` and `error_len()`
- `error_len() == None` means incomplete sequence at end → save leftover bytes for next read
- `error_len() == Some(n)` means invalid byte mid-stream → use lossy conversion
- Must prepend leftover bytes to next read's buffer before UTF-8 validation
- This affects both SSH and PTY readers — identical pattern in both

## SSH Integration
- ssh2 Rust crate v0.9 works well for native SSH without Node.js dependency
- Channel needs mut for request_pty_size call
- Non-blocking mode needed for reader thread, blocking for writes
- Temp key files must be cleaned up immediately after use
- Passwords must never be persisted to disk (only in-memory during session)
- localStorage stores connection configs without sensitive data
- sessionPassword field excluded from localStorage serialization alongside status/sessionId/errorMessage
- libssh2 key exchange can fail with "Unable to exchange encryption keys" if server only supports algorithms not in default offer list
- Fix: call session.method_pref() for Kex, HostKey, CryptCs, CryptSc, MacCs, MacSc BEFORE session.handshake()
- Must include both modern (ecdh-sha2-nistp*, curve25519) and legacy (diffie-hellman-group14-sha1) algorithms for maximum compatibility
- The configure_ssh_algorithms() helper must be called in ALL 4 handshake sites (SshSession::new, LogStream::new, test_ssh_connection, exec_command)

## Auto-Update (Tauri v2 NSIS)
- On Windows, downloadAndInstall() runs the NSIS installer while the exe is locked — the installer can fail silently
- Fix: use update.download() (download only), then update.install() + exit(0) on "Restart Now"
- install() spawns the NSIS installer and exit(0) releases the exe lock so the installer can replace files
- relaunch() starts the OLD binary before the installer finishes — do NOT use relaunch() for NSIS updates
- Fallback: if install+exit fails, try relaunch() as last resort

## SSH Terminal Reconnection
- When SSHPanel unmounts (user navigates away), the xterm Terminal is disposed but the SSH session keeps running
- When user comes back and clicks "Open Terminal", a new Terminal is created but has no previous output — shows black screen
- Fix: force shell redraw via double-resize — change cols by 1, wait 80ms, restore correct cols — triggers SIGWINCH
- SIGWINCH causes the remote shell to redraw its prompt, so the terminal shows content immediately

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

## Debug Copilot / AI Analysis
- Two-layer error analysis: hardcoded regex patterns (fast) + AI via Ollama (deep) for unmatched errors
- collectUnmatchedErrors() groups similar errors by first 150 chars, returns top 20 with stable hash for AI caching
- Ollama AI responses may be wrapped in markdown code fences — always extract JSON from inside ```json...``` blocks
- Cache AI results by error hash to avoid re-analyzing the same error
- Check Ollama health (localhost:11434/api/tags) before offering AI features — graceful degradation if offline
- ai_chat Tauri command already existed — no Rust changes needed for AI integration
- sysinfo 0.30: Process::name() returns &str, so .to_string() works directly

## SFTP Transfer — Critical
- `transferring` state flag used as both UI indicator AND guard in useCallback creates a fatal bug
- If ANY error occurs before `setTransferring(false)` (e.g., `getInvoke()` throws), the flag stays `true` forever
- Once stuck, Download button is `disabled`, Upload button is `disabled`, drag & drop is rejected — NOTHING works
- Fix: use `useRef` for the guard (avoids stale closures) + `try-finally` to ALWAYS reset the flag
- Remove `transferring` from `useCallback` dependency arrays — the ref doesn't cause re-creation
- Also: Tauri sync commands block the main thread — make file transfer commands `async`

## Cross-Server Navigation
- Intercepting `cd server:/path` requires buffering terminal input (ptyInputBuffer) and checking pattern on Enter
- Must send Ctrl+U (\x15) to clear the shell's line buffer BEFORE intercepting, otherwise shell tries to execute the raw cd command
- Use a mutable ref object (`currentTermRef`) to track which session (PTY vs SSH) the terminal is currently bound to
- When switching servers: save current context to a stack, rebind event listeners, update sessionType
- Credentials resolution: sessionPassword → keychain → null (prompt needed)
- Tab title update with server name provides visual feedback of current context

## Infrastructure Monitor — Safety
- Never run `find -delete` or `rm` on production servers from a one-click button — always scan first, show results, then let the user decide in a terminal
- Kill PID must be two-step: enter PID → confirm with SIGTERM (graceful) vs SIGKILL (force) choice. Show process info (`ps -p PID`) before killing so the user can verify they have the right process
- `journalctl --vacuum-time=7d` is safer than `--vacuum-size=100M` — time-based retention is predictable and won't delete recent logs
- Log scan should show sizes + file counts so the user understands the impact before cleanup
- Always verify PID exists before sending signal (`ps -p PID && kill`) to give a clear error instead of silent failure

## Disk Analyzer (CCleaner-style)
- No new Rust commands needed — the existing `ssh_exec` command handles all disk scanning and cleanup
- A single combined shell script collects all disk categories in one SSH call (partitions + 9 categories + largest dirs) to avoid multiple connections
- `df -hT` gives filesystem type which is useful context (ext4, xfs, btrfs)
- Parse `journalctl --disk-usage` output carefully — it returns human-readable strings like "4.0G"
- Package cache location varies by distro: apt=/var/cache/apt/archives, yum=/var/cache/yum, dnf=/var/cache/dnf
- Every cleanup action needs a confirm step — even "safe" ones like vacuum-time can surprise users
- Auto-rescan after cleanup gives immediate visual feedback of reclaimed space
- Donut chart with SVG: strokeDasharray/strokeDashoffset is the trick, rotate -90deg to start from top
- `timeout 10s du -xmd1 /` prevents hangs on huge filesystems — -xdev prevents crossing mount boundaries
- `find /tmp -xdev -mtime +7` is critical — without -xdev, find can traverse NFS/bind mounts and hang
- Disk growth tracking: save previous scan's directory sizes in store, diff on rescan — catches runaway logs/docker
- Preview-before-clean flow: Inspect (read-only) → Review files → Confirm → Clean — builds user trust
- Multi-select batch cleanup: combine commands with && for atomicity, show total reclaimable in green summary bar
- Click-to-navigate: largest dirs are clickable, opens terminal at that exact path via cross-server nav

## Infrastructure Monitor
- SSH exec_command() creates a NEW connection each poll — no session reuse (simpler, no mutex contention with interactive sessions)
- Polling thread sleeps in small increments (100ms) to allow quick shutdown when `running` flag is set to false
- Anomaly detection: mean + 2σ over last 30 samples catches sudden spikes below fixed thresholds
- Cross-server correlation: if 2+ servers alert within 30 seconds, it suggests a systemic issue
- MetricsSnapshot fields use snake_case in Rust, camelCase in TypeScript — transform in the event listener
- Network I/O rate: calculate delta between consecutive snapshots divided by time interval

## SSH Performance — CRITICAL
- SSHPanel was calling `parseTerminalOutput()` SYNCHRONOUSLY on every SSH data event — this blocks the event handler and causes massive lag during rapid output
- TerminalPanel correctly uses `queueDebugParse()` with 200ms debounce — SSHPanel must do the same (separate buffer to avoid cross-contamination)
- The ssh2 `session.set_timeout(100)` already provides a 100ms wait on WouldBlock — adding `thread::sleep(10ms)` on top was redundant double-waiting
- Increasing SSH read buffer from 4KB to 16KB reduces the number of events emitted per second for bulk output (e.g., `cat` large files), directly reducing frontend re-renders
- String-based error matching (`e.to_string().contains("transport read")`) is fragile — prefer `e.kind()` for OS-level errors (ConnectionReset, BrokenPipe, ConnectionAborted) and only use string matching as fallback for ssh2-specific messages
- OS-level connection errors (ConnectionReset, BrokenPipe) should be immediately fatal — no point retrying, the TCP socket is dead

## SSH Batching — CRITICAL (v2.4.5)
- SSH reader thread was emitting one IPC event per `channel.read()` call — up to hundreds per second during fast output
- PTY already had a dual-thread (reader + flusher) pattern that batches data and emits on 50ms intervals
- Ported the same pattern to SSH: reader appends to shared `Arc<Mutex<String>>`, flusher emits on Condvar signal or 50ms timeout
- This reduces IPC events from ~100/sec to ~20/sec during bulk output, dramatically reducing frontend overhead
- `AtomicBool` is faster than `Mutex<bool>` for a simple running flag — no lock contention
- SSH write retry: 10 retries × 50ms sleep = 500ms worst case blocking on Tauri async thread. Reduced to 5 × 20ms = 100ms max
- StatusBar reactive selectors for `hackingAlerts.length` and filtered `infraAlerts` caused re-renders on EVERY alert change — replaced with 3s polling interval
- Config save at 500ms debounce fires too often when many state changes happen in sequence (e.g., terminal resize + history add + command count) — 2000ms is much safer
- Shell init delay of 2000ms for PowerShell was unnecessarily conservative — 800ms is sufficient, and bash 300ms is fine

## SSH Lock Elimination — CRITICAL (v2.4.7)
- Double lock per reader iteration (lock for writes, release, lock for reads) was the remaining bottleneck
- Fix: single lock scope — process writes, check EOF, read — all without releasing the Mutex
- This halves lock acquire/release overhead and eliminates the window where resize could interleave
- RwLock for ssh_sessions HashMap: ssh_write and ssh_resize only need read access (lookup), so they run concurrently
- Only ssh_connect and ssh_disconnect need write access (insert/remove) — very infrequent
- Session timeout must match flusher frequency: 20ms timeout + 16ms flusher = max ~36ms latency (was 50+50=100ms)
- UTF-8 fast path: std::str::from_utf8 is a simple validation pass (no allocation), only fallback to lossy on invalid bytes
- 99%+ of terminal output is valid UTF-8, so this eliminates almost all heap allocations in the read path

## SSH Write Queue Architecture — CRITICAL (v2.4.6)
- The #1 cause of SSH lag was lock contention: reader thread holds channel Mutex during blocking ch.read() (up to 100ms), and every keystroke IPC call also needed that same Mutex
- Fix: mpsc write queue — IPC just pushes Vec<u8> to queue (instant), reader thread drains queue before each read
- This means ALL channel I/O happens in a single thread — zero Mutex contention between IPC and reader
- The write() method went from "lock session + lock channel + retry + sleep + flush" to "mpsc send" — literally instant
- Resize still needs the Mutex (infrequent), but with session timeout reduced from 100ms to 50ms, contention window is halved
- Frontend buffered write queue further helps: batches rapid keystrokes into fewer IPC calls
- Combined with flusher at 16ms (60fps) instead of 50ms, SSH now feels as responsive as local PTY

## SSH ErrorKind::Other on Windows — CRITICAL
- libssh2 on Windows frequently maps EAGAIN/timeout errors as `ErrorKind::Other` instead of `WouldBlock`/`TimedOut`
- The previous code treated ALL `ErrorKind::Other` as transient with progressive backoff (20ms + errors*5ms, up to 100ms sleep)
- If every idle timeout hit this path, the read loop would sleep 20ms+ per iteration instead of immediately continuing — causing visible input lag
- Fix: check the error message for timeout indicators ("timeout", "would block", "eagain", "-37", "-43") and treat those as idle, not transient
- The error codes -37 (LIBSSH2_ERROR_EAGAIN) and -43 (LIBSSH2_ERROR_TIMEOUT) are the libssh2 internal codes that ssh2-rs may include in error messages

## SSH Scrollback — Mirror PTY Pattern
- PTY has a 64KB scrollback buffer in its flusher thread; SSH had none
- When SSHPanel navigates away and back, the xterm Terminal is DESTROYED and re-created — without scrollback, the user sees a blank terminal
- Fix: add scrollback buffer to SshSession, save data in flusher AND in reader's direct-emit paths (large batch >8KB, idle flush, EOF flush, error flush)
- The `ssh_get_scrollback` command returns the buffer, and SSHPanel writes it to the new Terminal on init
- This does NOT replay the live session — it's a raw dump of the last 64KB of output, which is enough to restore visual context

## Windows / Antivirus
- Unsigned compiled `.exe` files in project root trigger Windows Defender false positives
- Add `*.exe`, `*.msi`, `*.dmg`, etc. to `.gitignore` to prevent accidental commits
- Advise users to add project directory to Windows Defender exclusions

## Collaborative Terminal Architecture
- WebSocket server embedded in Tauri Rust backend (tokio-tungstenite) — no external server needed
- PTY data broadcast uses tokio::sync::broadcast channel with 256-message buffer
- Flusher thread (not reader) feeds the broadcast channel — same thread that emits Tauri events
- Scrollback ring buffer (64KB) in PtySession for late-joining guests
- Session codes are 6-char alphanumeric (ABCDEFGHJKLMNPQRSTUVWXYZ23456789 — no ambiguous chars)
- Guest input forwarded via Tauri event listener (collab-guest-input-{sid}) to PtySession.write()
- Rate limiting: 5 failed auth attempts per IP → 60s cooldown
- Permission enforcement is server-side in Rust — read-only guests' PtyInput messages are silently dropped
- Guest tabs use shellType "collab-guest" to distinguish from normal PTY/SSH tabs
- Cleanup: collab guest tabs call leaveCollabSession instead of close_pty_session
- futures-util "stream" feature doesn't exist — use only "sink" for SplitSink
- Scrollback ring buffer trim MUST use is_char_boundary() to avoid panicking on multi-byte UTF-8
- When enabling collab on PTY, must rollback (disable_collab) if WebSocket server fails to start
- Manual JSON unescaping (\r, \n, etc.) misses \uXXXX and \b/\f — use serde_json::from_str::<String>() instead
- Async event listener setup in React useEffect needs a `cancelled` flag to prevent registering listeners after cleanup
- Guest chat messages must be added to local state immediately (not just host) for instant feedback
- Rate limiting HashMap entries must be periodically cleaned up to prevent memory leak
- Component unmount cleanup must distinguish collab-guest tabs from normal PTY tabs
- std::sync::MutexGuard across .await is a compile error in Tauri commands — use Arc + clone pattern
