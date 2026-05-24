# Release Checklist

CodexMaMi ships as a Windows desktop app through Electron Builder. The installer includes the local Node backend and the desktop UI, so users do not need to run `node server.mjs` manually after installing.

## One-Time Windows Setup

1. Install Node.js LTS and confirm `npm --version` works.
2. Install project packaging dependencies after `npm` is ready:

```powershell
npm install
```

## Version Sync

Before preparing a public release, keep the app version aligned across the web app and legacy Tauri metadata:

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
npm run electron:dist:win
```

Expected output will be under:

```text
dist
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

The workflow builds on `windows-latest`, runs tests, builds the Electron NSIS installer, uploads it as an Actions artifact, and creates a draft GitHub Release. Review the draft release before publishing it.

Release notes should include:

- The current `CHANGELOG.md` notes.
- A reminder that CodexMaMi stores user data locally.
- A reminder that secrets are masked in the UI but users should not publish local app data.

Important: build artifacts should remain draft releases until the installed app has been tested on a clean Windows machine.
