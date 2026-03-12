# NovaShell - Modern Terminal Emulator

> A feature-rich, cross-platform terminal emulator built with Tauri v2 + React + TypeScript + xterm.js

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Tauri](https://img.shields.io/badge/Tauri-v2-orange)](https://tauri.app)
[![Platform](https://img.shields.io/badge/Platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey)]()
[![Release](https://img.shields.io/github/v/release/FomoDonkey/NovaShell)](https://github.com/FomoDonkey/NovaShell/releases)

---

## Features

### Terminal
- **Multi-Shell Support** - PowerShell, CMD, Git Bash, WSL (Windows) / Bash, Zsh, Fish (macOS/Linux) — auto-detected
- **Multi-Tab Terminal** - Independent PTY sessions per tab with shell selector
- **Split Panes** - Horizontal and vertical splits
- **Command Autocomplete** - Suggestions from PATH and common commands
- **Focus Mode** - Auto-hide UI chrome for distraction-free work
- **Offline-Ready** - Bundled JetBrains Mono font, no internet required

### SSH Client
- **Full SSH Terminal** - Built-in SSH connections with xterm.js emulation
- **Dual Authentication** - Password or private key-based auth
- **Secure Keychain Storage** - Save passwords in system keychain (Windows Credential Manager, macOS Keychain, Linux Secret Service)
- **Connection Management** - Add, edit, delete, test connections
- **Connection Status** - Live status indicators per connection

### Themes
- **4 Built-in Themes** - Dark, Light, Cyberpunk (neon glow), Retro (CRT scanlines)
- Each theme fully styles terminal, UI panels, and SSH sessions

### Sidebar Panels
- **History** - Command history with timestamps and exit codes
- **Snippets** - Saved command templates with folder organization and batch execution
- **File Preview** - Browse filesystem and preview file contents
- **Plugins** - Live integrations with real system data:
  - **Git** - Branch, changed files, status, recent commits
  - **Docker** - Running containers and images
  - **Node.js** - Version, npm version, package.json scripts
  - **Python** - Version, pip, virtual environment info
  - **System Info** - Hostname, uptime, network info (platform-aware)
- **System Stats** - Real-time CPU, memory, disk usage, process count

### Debug Console
- **Live Log Monitoring** - Real-time log capture with level filters (error, warn, info, debug, trace)
- **Search & Filter** - Filter by level, source, and text search
- **Persistent Logs** - JSONL log files with 7-day retention, session history
- **Export** - Export logs to file

### Auto-Update
- **Background Update Checks** - Automatic detection of new versions
- **Download Progress** - Visual progress tracking
- **One-Click Install** - Install and relaunch with a single click
- **Signed Releases** - Minisign-verified updates

### Other
- **Achievement System** - 10 unlockable achievements
- **Single Instance** - Prevents duplicate app windows
- **Custom NSIS Installer** - Desktop shortcut, Start menu, "Open NovaShell here" context menu (Windows)

---

## Download & Install

### Windows
Download `NovaShell_x.x.x_x64-setup.exe` or `.msi` from [Releases](../../releases).

The NSIS installer includes:
- Custom installation folder
- Desktop shortcut + Start menu entry
- "Open NovaShell here" context menu
- Language selector (English/Spanish)

### macOS
Download `NovaShell_x.x.x_aarch64.dmg` (Apple Silicon) or `NovaShell_x.x.x_x64.dmg` (Intel) from [Releases](../../releases). Open and drag to Applications.

If macOS blocks the app: `xattr -cr /Applications/NovaShell.app`

### Linux
Download from [Releases](../../releases):
- `.AppImage` - Run directly: `chmod +x NovaShell_*.AppImage && ./NovaShell_*.AppImage`
- `.deb` - `sudo dpkg -i NovaShell_*_amd64.deb`
- `.rpm` - `sudo rpm -i NovaShell-*-1.x86_64.rpm`

---

## Tech Stack

| Layer       | Technology                   | Purpose                            |
|-------------|------------------------------|------------------------------------|
| Framework   | **Tauri v2**                 | Lightweight native wrapper         |
| Frontend    | **React 18 + TypeScript**    | UI components                      |
| Terminal    | **xterm.js v5**              | Terminal emulation                 |
| PTY         | **portable-pty (Rust)**      | Native process execution           |
| SSH         | **ssh2 (Rust)**              | SSH connections                    |
| Keychain    | **keyring (Rust)**           | Secure credential storage          |
| State       | **Zustand**                  | Global state management            |
| Animation   | **Framer Motion**            | Smooth UI transitions              |
| Icons       | **Lucide React**             | Modern icon library                |
| Bundler     | **Vite 5**                   | Fast dev server & build            |
| System      | **sysinfo (Rust)**           | CPU, memory, process stats         |

---

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) >= 18
- [Rust](https://rustup.rs/) >= 1.70
- Platform-specific dependencies (see [BUILD.md](BUILD.md))

### Development

```bash
cd nexterm

# Install frontend dependencies
npm install

# Run in development mode (starts both frontend and Tauri backend)
npm run tauri dev
```

### Production Build

```bash
cd nexterm
npm install
npm run tauri:build
```

Installers output to `src-tauri/target/release/bundle/`

---

## Architecture

```
nexterm/
├── src-tauri/                     # Rust backend (Tauri v2)
│   ├── src/
│   │   ├── main.rs                # Commands, shell detection, security whitelist
│   │   ├── pty_manager.rs         # PTY session lifecycle
│   │   ├── ssh_manager.rs         # SSH connections & terminal I/O
│   │   ├── keychain_manager.rs    # System keychain integration
│   │   ├── log_manager.rs         # JSONL log persistence & rotation
│   │   └── system_info.rs         # CPU, memory, disk, process stats
│   ├── capabilities/main.json     # Tauri permission declarations
│   ├── nsis/installer.nsi         # Custom Windows installer script
│   ├── Cargo.toml
│   └── tauri.conf.json
│
├── src/                           # React frontend
│   ├── components/
│   │   ├── TitleBar.tsx           # Window controls, theme selector
│   │   ├── TabBar.tsx             # Multi-tab management, dynamic shell selector
│   │   ├── TerminalPanel.tsx      # xterm.js terminal with PTY bridge
│   │   ├── Sidebar.tsx            # History, snippets, preview, plugins, stats
│   │   ├── SSHPanel.tsx           # SSH connection manager & terminal
│   │   ├── StatusBar.tsx          # Shell, git branch, stats, clock
│   │   ├── DebugPanel.tsx         # Debug console with log persistence
│   │   └── UpdateNotification.tsx # Auto-update UI
│   ├── store/
│   │   └── appStore.ts            # Zustand state (tabs, themes, SSH, debug)
│   ├── styles/
│   │   └── global.css             # 4 theme systems & all styles
│   ├── main.tsx
│   └── App.tsx
│
├── package.json
├── tsconfig.json
├── vite.config.ts
└── index.html
```

---

## Extending

### Add a New Theme

1. Add CSS variables in `global.css`:
```css
[data-theme="mytheme"] {
  --bg-primary: #...;
  /* ... all variables */
}
```
2. Add theme to `ThemeName` type in `appStore.ts`
3. Add theme dot in `TitleBar.tsx`
4. Add terminal colors in `TerminalPanel.tsx`

### Add a New Tauri Command

1. Define `#[tauri::command]` function in Rust
2. Register in `invoke_handler!` in `main.rs`
3. Call from frontend: `await invoke("command_name", { args })`

### Add a New Plugin Integration

1. Add plugin entry in `appStore.ts` plugins array
2. Add the plugin panel UI in `Sidebar.tsx` `PluginsPanel` component
3. Use `run_command_output` to fetch real system data (commands must be in the security whitelist)

---

## Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/my-feature`
3. Commit your changes: `git commit -m "Add my feature"`
4. Push to the branch: `git push origin feature/my-feature`
5. Open a Pull Request

## License

MIT - See [LICENSE](LICENSE) for details.
