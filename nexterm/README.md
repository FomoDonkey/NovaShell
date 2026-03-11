# NovaTerm - Professional Terminal Emulator

> A modern, cross-platform terminal emulator built with Tauri + React + TypeScript + xterm.js

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Tauri](https://img.shields.io/badge/Tauri-v2-orange)](https://tauri.app)
[![Platform](https://img.shields.io/badge/Platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey)]()

---

## Screenshots

<p align="center">
  <em>Dark Theme</em> &bull; <em>Cyberpunk Theme</em> &bull; <em>Retro CRT Theme</em> &bull; <em>Light Theme</em>
</p>

---

## Features

- **Multi-Shell Support** - PowerShell, CMD, Git Bash, WSL, Zsh, Fish
- **4 Built-in Themes** - Dark, Light, Cyberpunk (neon glow), Retro (CRT scanlines)
- **Multi-Tab Terminal** - Independent PTY sessions per tab
- **Split Panes** - Horizontal and vertical splits
- **Sidebar Panels** - Command history, snippets, file preview, plugins, system stats
- **Command Autocomplete** - Suggestions from PATH and common commands
- **Focus Mode** - Auto-hide UI chrome for distraction-free work
- **Achievement System** - 10 unlockable achievements
- **Cross-Platform** - Windows, macOS, and Linux installers
- **Offline-Ready** - Bundled fonts, no internet required

## Visual Layout

```
+===================================================================================+
|  [NovaTerm]  [Dark][Light][Cyber][Retro]    Professional Terminal   [F][S][-][M][X] |
+===================================================================================+
|  [PS Terminal 1] [>_ CMD] [$ Bash] [+ New Tab v]                                  |
+===================================================================================+
|                                                |  [History][Snippets][Preview]     |
|  novaterm ~ $                                  |  [Plugins][Stats]                 |
|  > git status                                  | -------------------------------- |
|  On branch main                                |  QUICK COMMANDS                   |
|  Changes not staged for commit:                |  +----------------------------+   |
|    modified: src/App.tsx                        |  | [>] Git Status             |   |
|                                                |  |     git status             |   |
|  novaterm ~ $ _                                |  +----------------------------+   |
|                                                |                                   |
+===================================================================================+
|  [*] Ready  [>_] PowerShell  [Branch] main  [Theme] Dark  [Enc] UTF-8  [14:32]   |
+===================================================================================+
```

## Tech Stack

| Layer       | Technology                   | Purpose                      |
|-------------|------------------------------|------------------------------|
| Framework   | **Tauri v2**                 | Lightweight native wrapper   |
| Frontend    | **React 18 + TypeScript**    | UI components                |
| Terminal    | **xterm.js v5**              | Terminal emulation           |
| PTY         | **portable-pty (Rust)**      | Native process execution     |
| State       | **Zustand**                  | Global state management      |
| Animation   | **Framer Motion**            | Smooth UI transitions        |
| Icons       | **Lucide React**             | Modern icon library          |
| Bundler     | **Vite 5**                   | Fast dev server & build      |
| System      | **sysinfo (Rust)**           | CPU, memory, process stats   |

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) >= 18
- [Rust](https://rustup.rs/) >= 1.70
- Platform-specific dependencies (see [BUILD.md](BUILD.md))

### Install & Run

```bash
cd nexterm

# Install frontend dependencies
npm install

# Run in development mode
npx @tauri-apps/cli dev

# Build for production (creates installers)
npx @tauri-apps/cli build
```

### Run Frontend Only (Demo Mode)

```bash
cd nexterm
npm install
npm run dev
# Open http://localhost:5173
```

The terminal runs in demo mode without the Tauri backend, with interactive commands: `help`, `neofetch`, `colors`, `matrix`, `theme`, `date`, `clear`.

## Download & Install

### Windows
Download `NovaTerm_x.x.x_x64-setup.exe` from [Releases](../../releases) and run the installer. Options include:
- Custom installation folder
- Desktop shortcut
- Start menu entry
- "Open NovaTerm here" context menu

### macOS
Download `NovaTerm_x.x.x_x64.dmg` from [Releases](../../releases), open it, and drag NovaTerm to Applications.

### Linux
Download your preferred format from [Releases](../../releases):
- `.AppImage` - Run directly (no install needed)
- `.deb` - `sudo dpkg -i novaterm_x.x.x_amd64.deb`
- `.rpm` - `sudo rpm -i novaterm-x.x.x-1.x86_64.rpm`

## Building from Source

See [BUILD.md](BUILD.md) for detailed build instructions for all platforms.

## Architecture

```
nexterm/
+-- src-tauri/                  # Rust backend (Tauri v2)
|   +-- src/
|   |   +-- main.rs             # Tauri commands & app setup
|   |   +-- pty_manager.rs      # PTY session management (portable-pty)
|   |   +-- system_info.rs      # System stats (sysinfo crate)
|   +-- Cargo.toml
|   +-- tauri.conf.json
|
+-- src/                        # React frontend
|   +-- components/
|   |   +-- TitleBar.tsx        # Window controls, theme selector, logo
|   |   +-- TabBar.tsx          # Multi-tab management, shell selector
|   |   +-- TerminalPanel.tsx   # xterm.js terminal instances
|   |   +-- Sidebar.tsx         # History, snippets, preview, plugins, stats
|   |   +-- StatusBar.tsx       # Shell info, git branch, system stats, clock
|   +-- store/
|   |   +-- appStore.ts         # Zustand global state management
|   +-- styles/
|   |   +-- global.css          # Complete theme system (4 themes) & styles
|   +-- main.tsx                # React entry point
|   +-- App.tsx                 # Main layout with animated sidebar
|
+-- package.json
+-- tsconfig.json
+-- vite.config.ts
+-- index.html
```

## Extending

### Add a New Theme

1. Add CSS variables block in `global.css`:
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

## Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/my-feature`
3. Commit your changes: `git commit -m "Add my feature"`
4. Push to the branch: `git push origin feature/my-feature`
5. Open a Pull Request

## License

MIT - See [LICENSE](LICENSE) for details.
