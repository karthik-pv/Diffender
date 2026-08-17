# Diffender

Captures the exact file delta produced by each AI coding prompt using a private shadow git repo, and surfaces it in VS Code's diff viewer — without touching the project's real `.git`.

## Requirements

- Node.js >= 18
- Git on PATH
- VS Code `code` CLI on PATH (for diff viewing)

## Setup

```bash
git clone <repo>
cd diffender
npm install
npm link
```

## Initialize in a project

```bash
cd your-project
diffender init --opencode
```

## Commands

| Command | Description |
|---------|-------------|
| `diffender init --opencode` | Initialize shadow repo, config, git isolation, and opencode plugin |
| `diffender latest` | Show the latest diff and open VS Code diff view |
| `diffender history` | List all captured prompt diffs |
| `diffender show <hash>` | Show diff for a specific commit |
| `diffender snapshot <msg>` | Manually commit current state with a message |
| `diffender reset` | Wipe history and create a fresh baseline |
| `diffender gitintegrate` | Add `.diffender/` to real repo's `.git/info/exclude` |

## Config

`.diffender/config.json`:

```json
{
  "open_diff_auto": true,
  "max_diff_windows": 10,
  "print_diff_to_terminal": true
}
```

## Note

Currently only OpenCode is supported. The provider interface is designed for extension — Claude Code, Cursor, Codex, and others can be added without changing core logic.
