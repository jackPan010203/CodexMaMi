# CodexMaMi

CodexMaMi is a Windows-first, local-first companion app for Codex. It helps manage local Codex configuration, account profiles, session history, model providers, MCP servers, skills, and recoverable backups.

This repository is currently an independent implementation prepared for the AiMaMi completion plan. The original upstream import from `borawong/AiMaMi` could not be completed in this environment because GitHub access through the sandbox approval path was unavailable. The project remains designed to preserve Apache-2.0-compatible attribution and can merge upstream code later when access is available.

## What Works Now

- Reads the local Codex config at `%USERPROFILE%\.codex\config.toml`.
- Masks secrets before showing config content in the UI.
- Saves account profiles from the current Codex config.
- Exports saved account profiles as CodexMaMi JSON bundles.
- Imports account bundles back into local account profiles.
- Previews account switches with a masked diff.
- Applies account switches only after explicit confirmation and automatic backup.
- Lists backups and restores them only after explicit confirmation.
- Scans local Codex session files and supports search, favorites, soft archive, and Markdown export.
- Manages OpenAI-compatible model providers locally.
- Tests provider `/models` connectivity.
- Runs a local provider proxy endpoint at `/proxy/{providerId}/...`.
- Previews and applies Codex routing config with backup-first safety.
- Lists, adds, edits, and removes MCP servers from the current Codex config with backup-first safety.
- Lists local Codex skills and plugin skill folders when present.
- Imports local skills into `%USERPROFILE%\.codex\skills`.
- Creates and restores local skill backups under `%USERPROFILE%\.codexmami\skill-backups`.
- Provides low-risk maintenance tools for diagnostics, backup shortcuts, managed route removal, and cleanup of CodexMaMi export files.
- Saves local UI preferences such as the preferred start page and auto refresh interval.
- Shows a local release status card so you can track whether the next public version number is ahead of the current build.
- Can query GitHub `releases/latest` for a configured repository and show the fetched version/notes in the settings page.
- Shows in-app Windows build environment readiness for Node, npm, Electron packaging config, icon generation, and installer artifacts.
- Lets saved account profiles refresh a local status summary and show quota placeholders in the account list.

See [FEATURE_MATRIX.md](FEATURE_MATRIX.md) for a screenshot-based comparison with the visible AiMaMi feature set.

## Packaging Status

The repository includes an Electron desktop wrapper under `desktop/`, a Windows installer workflow in `.github/workflows/windows-release.yml`, and a release checklist in [RELEASE.md](RELEASE.md). A real Windows installer requires working `npm` on the build machine. Run `npm run release:check` or the PowerShell command in [RELEASE.md](RELEASE.md) to see what is missing on the current computer.

Before tagging a public version, run `scripts\sync-version.ps1` so the version stays aligned across `package.json`, `src-tauri/tauri.conf.json`, and `src-tauri/Cargo.toml`.

To build the Windows installer locally after `npm install`:

```powershell
npm run electron:dist:win
```

The installer will be written to:

```text
dist
```

## Run Locally

This version has no package dependencies. Use Node.js directly:

```powershell
node server.mjs
```

Then open:

```text
http://127.0.0.1:4173
```

If port `4173` is busy, `scripts\start-dev.ps1` will automatically try the next free port and print the URL. You can also set a port manually:

```powershell
$env:PORT = "4174"
node server.mjs
```

For sandboxed development in this repository, use a workspace-local data folder:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\start-dev.ps1
```

That command stores CodexMaMi development data in:

```text
<project-folder>\.codexmami-dev
```

The normal `node server.mjs` command stores data in `%USERPROFILE%\.codexmami`.

## Current Environment Notes

- `npm` is present on this machine but currently fails because its global CLI path is broken.
- GitHub import of `borawong/AiMaMi` was attempted but blocked by the sandbox approval service returning `503 Service Unavailable`.
- The current implementation is therefore a working local-first CodexMaMi baseline, ready for later AiMaMi upstream import and deeper native integration.

## Data Locations

CodexMaMi stores its own data under:

```text
%USERPROFILE%\.codexmami
```

Codex source data remains under:

```text
%USERPROFILE%\.codex
```

Before CodexMaMi writes to `config.toml`, it creates a timestamped backup in:

```text
%USERPROFILE%\.codexmami\backups
```

## Safety Model

- CodexMaMi never deletes original Codex session files.
- "Archive" for threads is a CodexMaMi UI state only.
- Secrets are masked in UI responses by default.
- Account switching, route application, and backup restore require explicit confirmation.
- MCP edits and removals require diff preview, explicit confirmation, and an automatic backup.
- Provider API keys are stored locally for the proxy feature and are never sent to a CodexMaMi server.

## Upstream Attribution

The product direction was inspired by the public AiMaMi project:

- Repository: `https://github.com/borawong/AiMaMi`
- License intent: Apache-2.0-compatible attribution and notices are preserved for future upstream import.

CodexMaMi is branded independently to avoid confusion with the original project.
