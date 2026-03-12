# NovaShell - Build & Packaging Guide

## Prerequisites

### All Platforms
- [Node.js](https://nodejs.org/) >= 18
- [Rust](https://rustup.rs/) >= 1.70
- npm (comes with Node.js)

### Windows
- Visual Studio Build Tools 2022 (C++ workload)
- WebView2 (pre-installed on Windows 10/11)
- NSIS >= 3.08 (auto-downloaded by Tauri if missing)

### macOS
- Xcode Command Line Tools: `xcode-select --install`
- For universal builds: `rustup target add aarch64-apple-darwin x86_64-apple-darwin`

### Linux
```bash
# Ubuntu/Debian
sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget \
  libssl-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev \
  patchelf

# Fedora
sudo dnf install webkit2gtk4.1-devel openssl-devel curl wget \
  libappindicator-gtk3-devel librsvg2-devel patchelf
```

---

## Quick Build

```bash
cd nexterm
npm install
npm run tauri:build
```

Installers output to: `src-tauri/target/release/bundle/`

---

## Platform-Specific Builds

### Windows (.exe + .msi)

```bash
npm run tauri:build:windows
```

**Output:**
- `src-tauri/target/release/bundle/nsis/NovaShell_1.2.0_x64-setup.exe`
- `src-tauri/target/release/bundle/msi/NovaShell_1.2.0_x64_en-US.msi`

The NSIS installer includes:
- Installation folder selection
- Desktop shortcut + Start menu entry
- "Open NovaShell here" context menu entry
- Language selector (English/Spanish)
- Uninstaller with full cleanup

### macOS (.dmg + .app)

```bash
# Apple Silicon (M1/M2/M3/M4)
npm run tauri:build:mac-arm

# Intel Mac
npm run tauri:build:mac

# Universal binary (both architectures)
npx tauri build --target universal-apple-darwin
```

**Output:**
- `src-tauri/target/release/bundle/dmg/NovaShell_1.2.0_aarch64.dmg`
- `src-tauri/target/release/bundle/macos/NovaShell.app`

### Linux (.deb + .rpm + .AppImage)

```bash
npm run tauri:build:linux
```

**Output:**
- `src-tauri/target/release/bundle/deb/NovaShell_1.2.0_amd64.deb`
- `src-tauri/target/release/bundle/rpm/NovaShell-1.2.0-1.x86_64.rpm`
- `src-tauri/target/release/bundle/appimage/NovaShell_1.2.0_amd64.AppImage`

---

## Custom Icons

```bash
# Generate all icon sizes from a 1024x1024 PNG
npx @tauri-apps/cli icon path/to/your-icon.png

# Or use the built-in generator
npm run icons:generate
```

---

## Debug Build

```bash
npm run tauri:build:debug
```

Produces a debug build with dev tools enabled and source maps.

---

## Auto-Update (CI/CD)

NovaShell uses GitHub Actions for automated builds and Tauri's updater for auto-updates.

### How it works

1. Push a version tag (e.g., `v1.2.0`) to trigger the CI workflow
2. GitHub Actions builds for all 4 targets: Windows x64, macOS ARM, macOS Intel, Linux x64
3. A `latest.json` is generated with download URLs and minisign signatures
4. The release is created as a draft, then published
5. Running instances of NovaShell check for updates automatically

### Signing Keys

The updater requires minisign signing keys:

```bash
# Generate keys (one-time setup)
npx @tauri-apps/cli signer generate -w ~/.tauri/novashell.key
```

Store these as GitHub Secrets:
- `TAURI_SIGNING_PRIVATE_KEY` - The private key contents
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` - The key password

The public key is configured in `tauri.conf.json` under `plugins.updater.pubkey`.

### Creating a Release

```bash
# 1. Update version in package.json and tauri.conf.json and Cargo.toml
# 2. Commit and tag
git add -A && git commit -m "Bump version to x.y.z"
git tag vx.y.z
git push origin main vx.y.z

# 3. CI builds automatically — publish the draft release when ready
gh release edit vx.y.z --draft=false
```

---

## Build Optimization

The release profile is configured for minimal binary size:

| Setting            | Value   | Effect                                    |
|--------------------|---------|-------------------------------------------|
| `lto`              | `true`  | Link-Time Optimization for smaller binary |
| `codegen-units`    | `1`     | Better optimization (slower compile)      |
| `opt-level`        | `"s"`   | Optimize for size                         |
| `strip`            | `true`  | Remove debug symbols                      |
| `panic`            | `abort` | No unwind tables                          |

Frontend assets are minified by Vite/esbuild. JetBrains Mono font is bundled locally.

---

## Troubleshooting

### Windows: "WebView2 not found"
The installer includes a WebView2 bootstrapper that downloads it automatically. If offline, install WebView2 from Microsoft first.

### macOS: "App is damaged"
```bash
xattr -cr /Applications/NovaShell.app
```

### Linux: AppImage won't start
```bash
chmod +x NovaShell_*_amd64.AppImage
./NovaShell_*_amd64.AppImage
```

### Build fails with Cargo errors
```bash
cd nexterm/src-tauri && cargo clean && cd ../..
cd nexterm && npm run tauri:build
```

### SSH: "Failed to connect"
- Verify the host is reachable: `ssh user@host -p port`
- For private key auth, ensure the key file is accessible and in PEM format
- System keychain access may require unlocking on Linux (Secret Service)
