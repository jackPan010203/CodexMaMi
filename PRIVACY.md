# Privacy

CodexMaMi is local-first.

- No CodexMaMi cloud service is used by this version.
- App data is stored under `%USERPROFILE%\.codexmami`.
- Codex data is read from `%USERPROFILE%\.codex`.
- Provider API keys are stored locally so the local proxy can call your selected provider.
- Secrets are masked before being sent to the browser UI.
- Session exports are written locally under `%USERPROFILE%\.codexmami\exports`.

Network requests happen only when you use provider connectivity tests or route requests through the local proxy. Those requests go to the provider base URL you configured.
