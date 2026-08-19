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

Choose your AI agent provider:

```bash
cd your-project
diffender init --opencode    # For OpenCode
# OR
diffender init --claude      # For Claude Code
```

## Commands

| Command | Description |
|---------|-------------|
| `diffender init --opencode` | Initialize shadow repo + config + git isolation + opencode plugin |
| `diffender init --claude` | Initialize shadow repo + config + git isolation + Claude Code hooks |
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

## Providers

**Supported:**
- **OpenCode** (`--opencode`) — Uses OpenCode's plugin system to hook into `session.idle` and `session.updated` events
- **Claude Code** (`--claude`) — Uses Claude Code's `.claude/settings.json` hooks (`UserPromptSubmit` to capture prompts, `Stop` to snapshot diffs)

**Future:** Cursor, Codex, and others can be added via the provider interface without changing core logic.

### How it works

1. On each prompt completion, the provider's hook captures your input text
2. The diff is computed (current state vs. the last commit in `.diffender/git`)
3. If configured, VS Code opens side-by-side diffs per changed file
4. A commit is made to the shadow repo with your prompt as the message
5. You can browse history with `diffender history` and review any past diff with `diffender show <hash>`

Undo/revert in your AI agent resets the shadow repo to a clean state (no loss — all diffs are safe under `.diffender/` which is excluded from your real `.git`).
