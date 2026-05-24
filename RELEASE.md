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

The repository includes `.github/workflows/windows-release.yml`.

The workflow can be started in two ways:

1. Push a version tag:

```powershell
git tag v0.1.0
git push origin v0.1.0
```

2. Or open GitHub, go to `Actions` -> `Windows Release` -> `Run workflow`.

The workflow builds on `windows-latest`, runs tests, builds the Tauri installer, and creates a draft GitHub Release. Review the draft release before publishing it.

Release notes should include:

- The current `CHANGELOG.md` notes.
- A reminder that CodexMaMi stores user data locally.
- A reminder that secrets are masked in the UI but users should not publish local app data.

Important: the current Tauri package skeleton still needs a full end-to-end installer verification. Build artifacts should remain draft releases until the installed app has been tested on a clean Windows machine.
