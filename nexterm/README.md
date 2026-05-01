# NovaShell — Source Directory

This directory contains the NovaShell application source. For features, screenshots, install instructions and full documentation, see the **[main README](../README.md)** at the repo root.

## Quick start (development)

```bash
# From this directory
npm install
npm run tauri:dev      # hot-reload dev mode
npm run tauri:build    # production installer
```

## Layout

```
nexterm/
├── src/              # React + TypeScript frontend
│   ├── components/   # Panels (SSH, SFTP, RDP, Editor, Debug, Collab, Backup, …)
│   ├── store/        # Zustand store (appStore.ts)
│   └── i18n/         # English + Spanish translations
├── src-tauri/        # Rust backend
│   ├── src/          # Tauri commands + managers (ssh, sftp, rdp, collab, infra, …)
│   └── tauri.conf.json
└── package.json
```

## Prerequisites

- Node.js **18+**
- Rust (latest stable, **≥ 1.77**)
- Tauri prerequisites for your OS — see [tauri.app/start/prerequisites](https://tauri.app/start/prerequisites/)
- **Windows only**: [Strawberry Perl](https://strawberryperl.com/) (required by `openssl-src` for the libssh2 OpenSSL backend used for ed25519 SSH keys)

## License

MIT — see [LICENSE](../LICENSE) at the repo root.
