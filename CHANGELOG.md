# Changelog

## 0.3.1

- Launch Codex directly, preserving native session titles, renames and activity animation.
- Remove the fixed `Codex:` prefix, title override and Python PTY title proxy.
- Preserve terminal ordering, environment readiness checks and configurable backend lifetime.
- Document native titles and the need to recreate old terminals after upgrading.

## 0.3.0

- Configure terminal creation order in Settings: workspace, natural name ascending/descending, custom list, or previous successful launch order.
- Add an interactive command to save a custom terminal order to the current workspace.
- Reserve tab positions in order without waiting for previous environment activation to complete.
- Preserve existing live tabs; document that manual drag order is not available through the stable API.
- Default new Codex processes to `--no-daemon`, with a setting to opt back into the shared backend, to tie writer-lock lifetime to the CLI process.
- Document the distinction between closing Bash and releasing sessions held by a shared daemon.

## 0.2.0

- Show live Codex session names between the Codex prefix and project name in terminal tabs.
- Keep a placeholder before selection and until a new session has a name; follow CLI title changes and user renames without reading chat history.
- Relay terminal input and resizing through a Python 3 standard-library PTY, formatting only title sequences.
- Enable program-controlled labels by default with `${sequence}`; explicit user settings still take precedence.
- Animate each Git sync/publish button for its own command, prevent duplicate operations, show ahead/behind counts and preserve failure notifications.
- Document behavior, dependencies, privacy and operation-state limitations.

## 0.1.9

- Introduce the Workspace Dock name and public project documentation.
- Preserve the existing extension ID and launcher URI for compatibility.
- Include per-project Git branches, dirty markers, sync buttons and separators.
- Launch independent Codex terminals after each project's Python environment is ready.
