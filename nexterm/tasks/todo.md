# NovaShell - Tasks

## Completed
- [x] Create package.json with dependencies
- [x] Create tsconfig.json and tsconfig.node.json
- [x] Create vite.config.ts
- [x] Create index.html entry point
- [x] Create src/main.tsx React entry
- [x] Create src/App.tsx main layout component
- [x] Create src/store/appStore.ts Zustand global state
- [x] Create component stubs: TitleBar, TabBar, TerminalPanel, Sidebar, StatusBar
- [x] Create src/styles/global.css with theme styles
- [x] Implement xterm.js terminal integration
- [x] Set up Tauri backend
- [x] Add get_git_branch Tauri command
- [x] Add list_directory Tauri command
- [x] Add read_file_preview Tauri command
- [x] Add get_command_suggestions Tauri command
- [x] Register all new commands in invoke_handler
- [x] Configure Tauri bundling for Windows (NSIS + MSI)
- [x] Configure Tauri bundling for macOS (DMG + .app)
- [x] Configure Tauri bundling for Linux (deb + rpm + AppImage)
- [x] Generate proper app icons (all sizes + ICO + ICNS)
- [x] Bundle JetBrains Mono font locally (offline-ready)
- [x] Add CSP security policy
- [x] Add release profile optimization (LTO, strip, codegen-units=1)
- [x] Add tauri-plugin-single-instance (prevent duplicate windows)
- [x] Add tauri-plugin-updater (auto-update framework)
- [x] Add tauri-plugin-process
- [x] Create NSIS custom installer script (desktop shortcut + context menu)
- [x] Create BUILD.md with full packaging instructions
- [x] Create icon generator script
- [x] Rename product to NovaTerm
- [x] Build Windows NSIS installer (NovaTerm_1.0.0_x64-setup.exe - 2.9MB)
- [x] Build Windows MSI installer (NovaTerm_1.0.0_x64_en-US.msi - 3.6MB)

- [x] Add system keychain credential storage (keyring crate, cross-platform)
- [x] Add debug console with log monitoring, level filters, search, export
- [x] Add debug log persistence to disk (JSONL, session files, 7-day rotation)
- [x] Add snippet command sequences (multi-line, shell-native && / ; operators)
- [x] Deep performance optimization: individual Zustand selectors across all components
- [x] React.memo for App children (TerminalPanel, TabBar, StatusBar)
- [x] useMemo for filtered debug logs and level counts
- [x] Async debug log parsing via requestIdleCallback (non-blocking)
- [x] Reduce timer intervals (clock, stats, git branch, session time)
- [x] Move achievement checks from timer to commandCount-driven useEffect

- [x] Auto-update system: signing keys, UpdateNotification component, CI/CD with latest.json

- [x] Rename NovaTerm → NovaShell across entire codebase (~20 files)
- [x] Make extensions panel fully functional (Git, Docker, Node.js, Python, System Info)
- [x] Fix git branch "--" display in StatusBar
- [x] Cross-platform shell detection (dynamic from backend, Homebrew paths)
- [x] Fix contextmenu event listener memory leaks (TerminalPanel + SSHPanel)
- [x] Cap debug parse queue at 500 entries
- [x] Security whitelist for run_command_output
- [x] Fix cmd.exe argument handling (direct exec first, cmd /c fallback for .cmd scripts)
- [x] CI/CD pipeline for automated cross-platform builds (GitHub Actions)

## Pending
- [ ] Code signing for Windows (requires certificate)
- [ ] Code signing for macOS (requires Apple Developer account)
- [ ] Publish v1.2.0 release
