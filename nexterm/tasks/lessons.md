# NovaShell - Lessons Learned

## Session 1 (2026-03-11)
- Project uses Vite + React + TypeScript + Tauri stack
- App.tsx imports components not yet created (TitleBar, TabBar, TerminalPanel, Sidebar, StatusBar)

## Session 2 - Packaging (2026-03-11)
- Tauri 2 bundle identifier must NOT end with `.app` (conflicts with macOS .app extension)
- `resources` glob in tauri.conf.json fails build if directory is empty — remove or add files
- curl on Windows with schannel needs `--ssl-no-revoke` flag for GitHub downloads
- Tauri auto-downloads NSIS 3.11 and WiX 3.14 when needed for bundling
- Release profile optimizations (LTO, strip, codegen-units=1, opt-level=s) result in ~2.9MB NSIS installer
- JetBrains Mono fonts must be bundled locally in `public/fonts/` for offline operation — Google Fonts won't work in packaged app
- `npx @tauri-apps/cli icon` generates all icon sizes from a single SVG/PNG source
- tauri-plugin-single-instance prevents multiple app windows from opening
- NSIS custom macros go in `src-tauri/nsis/installer.nsi` for context menu entries and desktop shortcuts
- Frontend plugins (@tauri-apps/plugin-updater, plugin-process) must be installed via npm AND registered in Rust main.rs AND added to capabilities/main.json

## Session 3 - Features & Optimization (2026-03-11)
- keyring crate v2 uses `delete_password()` not `delete_credential()` — API changed from v1
- Lucide React icons don't accept `title` prop directly — wrap in `<span title="...">` instead
- Zustand `useAppStore()` with no selector subscribes to entire store, causing cascading re-renders on any state change. Always use `useAppStore((s) => s.prop)` for individual selectors
- Shell-native command chaining (`&&` / `;`) is far more reliable than timed delays between commands — the shell itself manages sequencing
- `requestIdleCallback` is ideal for non-critical async work like debug log parsing — keeps terminal rendering smooth
- `useMemo` for filtered/derived data prevents O(n) recalculation on every render when inputs haven't changed
- Timer intervals (polling) are expensive for re-renders — prefer event-driven updates (e.g., useEffect on value change) over setInterval where possible
- JSONL format for log persistence allows append-only writes and line-by-line parsing without loading entire file into memory
- Tauri v2 updater requires: pubkey in tauri.conf.json, signing env vars (`TAURI_SIGNING_PRIVATE_KEY`) in CI, and a `latest.json` endpoint
- For Tauri updater, Windows uses `.exe` (NSIS), macOS uses `.app.tar.gz`, Linux uses `.AppImage` — each with `.sig` signature files
- The updater `latest.json` must have `version`, `pub_date`, `platforms` with per-platform `url` + `signature` fields
- Private signing keys must NEVER be committed — store as GitHub Secrets and reference via env vars in CI
- Tauri v2 updater config uses `plugins.updater.pubkey` and `plugins.updater.endpoints` (not `active`/`dialog` like v1)

## Session 4 - Cross-platform fixes & cmd.exe bug (2026-03-12)
- On Windows, `cmd /c command args...` breaks complex arguments (e.g., `node -e "try{...}catch{...}"` produces no output). Solution: try direct `Command::new()` first, only fall back to `cmd /c` when `ErrorKind::NotFound` (for .cmd/.bat scripts like npm, npx)
- `navigator.platform` is the simplest way to detect OS in frontend for default shell selection
- Shell detection must be dynamic from backend — hardcoded shell lists break on non-Windows OS
- macOS Homebrew installs shells to `/opt/homebrew/bin/` (ARM) or `/usr/local/bin/` (Intel) — must check both
- Always store event listener references for cleanup — anonymous functions in `addEventListener` leak memory
- When renaming a project, keep Cargo.toml `name` unchanged if Cargo.lock references it (avoids rebuild issues)
