# Changelog

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
