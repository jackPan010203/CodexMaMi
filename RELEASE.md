# Release Checklist

CodexMaMi currently runs as a local Web UI. The repository now includes a Tauri packaging skeleton, but this machine still needs working Node/npm plus Rust/Cargo before Windows installers can be produced.

## One-Time Windows Setup

1. Install Node.js LTS and confirm `npm --version` works.
2. Install Rust from `https://rustup.rs`.
3. Install Tauri prerequisites for Windows.
4. Install project packaging dependencies after `npm` is repaired:

```powershell
npm install
```

## Version Sync

Before preparing a public release, keep the app version aligned across the web app and Tauri files:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\sync-version.ps1 -Version 0.2.0
```

## Local Verification

```powershell
node --test
node scripts\smoke-ui.mjs
node --check public\app.js
node --check server.mjs
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\check-release-env.ps1
```

If `npm` reports that its CLI files are broken, repair or reinstall Node.js before trying to build installers.

## Desktop Build

After the environment is ready:

```powershell
npm run tauri:build
```

Expected output will be under:

```text
src-tauri\target\release\bundle
```

## GitHub Release

- Upload the generated `.msi` and/or `.exe` installer.
- Include the current `CHANGELOG.md` notes.
- Mention that CodexMaMi stores user data locally and masks secrets in the UI.
- If you are publishing source only for now, say clearly that Windows installer artifacts are not included in that release yet.
