# Feature Matrix

This matrix compares the visible AiMaMi screenshots with the current CodexMaMi implementation.

## Available And Tested

- Dashboard: current Codex config detection, config summary, account/session/provider counts, recent sessions, recent backups.
- Account profiles: capture current local Codex config, list profiles, preview masked diff, apply profile after confirmation and backup, delete local profile.
- Thread/session management: scan local Codex session files, search, favorite, soft archive, export to Markdown.
- Provider management: add, edit, delete, enable/disable, store local API key, test `/models`, preview route config diff, apply managed route block with backup.
- Local proxy: `/proxy/{providerId}/...` forwards to the selected enabled provider with the stored API key.
- MCP management: list MCP servers from `config.toml`, add/edit/remove servers, preview masked diff, apply only after confirmation and backup.
- Skills management: scan local `SKILL.md` files and plugin skill folders, import local skills, create skill backups, restore from backups, and remove locally managed skills.
- Backups: create config backup, list backups, restore with confirmation and pre-restore backup.
- Maintenance tools: diagnose local paths/counts/process hints, create backup shortcut, disable the CodexMaMi managed routing block, and clean CodexMaMi export files only.
- Desktop packaging preparation: Tauri v2 scaffold, Windows window metadata, bundle target config, and release environment checker are present.
- Settings preferences: save start view, auto refresh interval, session grouping preference, archived visibility preference, and copy key local paths.
- Thread grouping: sessions now return project grouping metadata and the UI can expand threads by project.
- Account bundles: export a saved account profile as a CodexMaMi JSON bundle and import it back into another local CodexMaMi instance.
- Release status: store a target public version and release notes locally, compare it with the current app version, and show whether an update is pending.
- Version sync tooling: PowerShell helper to keep `package.json`, `src-tauri/tauri.conf.json`, and `src-tauri/Cargo.toml` aligned before release.
- GitHub release check: optionally query `releases/latest` from a configured GitHub repo and show the fetched version, notes, and release URL.
- Install environment check: show Node/npm/Rust/Cargo/Tauri readiness inside the app through a dedicated release environment check.
- Account status surface: saved account profiles can refresh a local readiness status and show quota placeholders/notes in the UI.
- Safer UI: sensitive values are masked in UI output; risky writes require confirmation.

## Partially Available

- Dashboard health: Codex config and MCP data are checked, but detailed checks for `auth.json`, `registry.json`, subscription state, and API reachability are not implemented yet.
- Account status: saved profiles show config summary, but subscription status, quota, renewal date, OAuth identity, and automatic rotation are not implemented.
- Routing: OpenAI-compatible provider routing is implemented through a local proxy and managed config block. Menu injection inside Codex is not implemented.
- Settings: core local preferences are implemented. Theme, language, color choices, and update checks are not implemented yet.
- Desktop installer: packaging files are ready, but this machine still needs working `npm` plus Rust/Cargo before a real `.msi` or `.exe` can be built and verified.
- Maintenance: safe diagnostics and cleanup are implemented. Force-closing/restarting Codex is intentionally not implemented yet because it is a higher-risk action.
- Update checker: GitHub latest release fetching is implemented when a repo is configured, but it does not create installers or download updates automatically.

## Not Implemented Yet

- Built and verified Windows installer artifact.
- Usage/quota chart and activity heatmap.
- Plugin management page with enable/disable built-in plugins.
- Force-close Codex, reset config, and restart Codex controls.
- Update checker.
- Automatic account rotation.
- Opening `.codex` folder from the UI.
- System notification center.

## First Three Completion Order

1. MCP add/edit/remove with masked diff and backup-first writes.
2. Low-risk maintenance tools for diagnosis, backups, export cleanup, and disabling the managed route block.
3. Desktop packaging preparation with Tauri scaffold and release environment checks.

## Second Three Completion Order

1. Skills import, backup, restore, and local delete.
2. Thread grouping by project with expandable groups.
3. Settings preferences for start view, refresh interval, archived visibility, and path copying.

## Third Three Completion Order

1. Account import/export bundle flow.
2. Local release status and update check surface.
3. Desktop install chain helpers, release checks, and version sync tooling.

## Fourth Three Completion Order

1. GitHub release latest-version fetch from a configured repo.
2. In-app Windows build environment readiness checks.
3. Account status refresh and quota/status placeholders.

## Current Verification

- `node --test`
- `node scripts/smoke-ui.mjs`
- `node --check public/app.js`
- `node --check server.mjs`
- `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\check-release-env.ps1`

The current version is a working local-first baseline, not a complete clone of every visible AiMaMi feature.
