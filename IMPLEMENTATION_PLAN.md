# Diffender — Implementation Plan (0 → 1)

**Goal:** A local, read-only diff layer that captures the exact file delta produced by each AI coding prompt, using a private shadow git repo (`.diffender/git`), and surfaces it in VS Code's diff viewer — without ever touching the project's real `.git`.

**Build order (per your instruction):**
1. Git functionality first, as standalone scripts/modules — no CLI, no provider awareness.
2. Wrap that into the `diffender` CLI (`init`, `latest`, `history`, `show`, `reset`, `gitintegrate`).
3. Add a provider strategy interface, implement it for **opencode only**, leave room for Claude Code / Cursor / Codex later.
4. Harden + end-to-end test.

Finalized behavioral decisions baked into this plan:
- **Diff model:** working tree vs. HEAD is captured *before* committing (VS Code source-control mental model). Commit locks in the new baseline for the next prompt.
- **One commit per completed prompt turn.** No pre-prompt commit needed — history itself provides the "before" state.
- **Revert/undo is not our concern.** On any detected revert/redo transition, we wipe `.diffender/git` and start over with a single fresh baseline commit — no history preserved, no attempt to reconstruct what changed.
- **Two independent ignore mechanisms:** `.diffender/git/info/exclude` (what the shadow repo tracks) vs. the real repo's `.git/info/exclude` (hides the whole `.diffender/` folder from the user's own `git status`).
- **Zero writes to the real `.git`** other than that one exclude-list line, added via `init` (best-effort) or explicitly via `diffender gitintegrate`.
- **No revert/rollback feature of our own** — purely read-only reporting (`latest`, `history`, `show`).

---

## Step 1 — Project scaffolding & repo layout

**Goal:** Get a clean, installable Node.js CLI skeleton before writing any real logic.

**Deliverables**
```
diffender/
  package.json          # bin: { "diffender": "./bin/diffender.js" }
  bin/diffender.js       # shebang entry point, delegates to src/cli
  src/
    cli/                 # Step 5
    core/                # Step 2 - git engine
    config/              # Step 3
    diff-view/           # Step 4
    providers/           # Step 7-8
  test/
  .gitignore
  README.md
```
- `package.json` with `"bin": {"diffender": "./bin/diffender.js"}`, Node engine constraint (e.g. `>=18`), and a test script.
- Confirm `npm link` + `npx diffender --help` works from an arbitrary directory before writing any feature code.

**Automated tests**
- `cli.smoke.test.js`: spawn `diffender --help` as a child process, assert exit code 0 and expected usage text.
- `cli.unknown-command.test.js`: spawn `diffender bogus`, assert non-zero exit and a helpful error (not a stack trace).

**Manual test steps**
1. `git clone <repo> && cd diffender && npm install`
2. `npm link`
3. `cd /tmp/some-other-folder`
4. Run `npx diffender --help` — confirm it resolves to your linked package and prints usage.
5. Run `diffender --help` directly too (linked bin should be on PATH) — confirm identical output.

---

## Step 2 — Core git engine module (no CLI, no provider code)

**Goal:** All shadow-repo git operations as pure, testable functions. This is the module you asked to build first — everything else wraps it.

**Deliverables** (`src/core/git-engine.js` or similar, using `execa`/`child_process` to shell out to system `git` with explicit `--git-dir`/`--work-tree`)
- `initShadowRepo(projectRoot)`
  - Creates `.diffender/git` via `git --git-dir=.diffender/git --work-tree=<root> init`.
  - Seeds `.diffender/git/info/exclude` with default noisy-path ignores (`.opencode/`, `.swarm/`, `node_modules/`, `.git/`) — the real project's `.gitignore` is inherited automatically since ignore rules are work-tree-wide, not repo-specific.
  - Creates the first commit (`git add -A && git commit -m "diffender: baseline"`) representing current on-disk state. No pre-existing history — this **is** commit #1.
- `commitCurrentState(projectRoot, message)`
  - `git add -A` (respects `.diffender/git/info/exclude` + inherited `.gitignore`)
  - `git commit -m "<message>"` (empty-commit-safe: if nothing changed, skip commit rather than erroring)
- `getWorkingDiff(projectRoot)` — `git diff` (working tree vs HEAD, **nothing staged**), returns raw diff text + list of changed file paths.
- `getCommitDiff(projectRoot, hash)` — `git show <hash>` (commit vs its parent).
- `getHistory(projectRoot)` — `git log --oneline` (or `--pretty` with hash + full subject), parsed into structured `{hash, message, date}[]`.
- `resetShadowRepo(projectRoot)` — delete `.diffender/git` entirely, call `initShadowRepo` again. Single fresh baseline commit, no trace of prior history (matches "let it be fresh again").
- `isShadowRepoInitialized(projectRoot)` — existence check, used by every other command to fail gracefully if `init` was never run.

**Design constraints to hold to**
- Every function takes `projectRoot` explicitly — no implicit `process.cwd()` reliance buried in the module (makes testing trivial).
- No file copying anywhere — only `--git-dir`/`--work-tree` flag usage and git's own object database.
- Must work identically when invoked from Windows (paths with backslashes / spaces), macOS, and Linux — use `path.join`, avoid shell string interpolation of paths without quoting, prefer `execa(cmd, argsArray)` over raw shell strings.

**Automated tests** (use a temp directory per test via `os.tmpdir()` + `fs.mkdtemp`, real git binary, no mocking — this module is thin enough that integration tests against real git are more valuable than mocks)
- `init creates .diffender/git and one baseline commit` — assert `.diffender/git` exists, `getHistory()` returns exactly 1 entry.
- `init seeds default excludes` — assert `.diffender/git/info/exclude` contains expected default paths.
- `init inherits project .gitignore` — create a `.gitignore` with a test path, create a file at that path, init, assert that file is untracked in the shadow repo.
- `commitCurrentState creates a new commit with given message` — write a file, commit, assert `getHistory()` length increases and message matches (including a multi-line prompt string).
- `commitCurrentState is a no-op when nothing changed` — call it twice in a row with no file changes between, assert history length doesn't grow.
- `getWorkingDiff reflects uncommitted changes only` — commit once, mutate a file, assert `getWorkingDiff()` shows that mutation and `getHistory()` still shows only the prior commit (not yet committed).
- `getCommitDiff matches getWorkingDiff content pre-commit` — capture working diff, commit with that state, assert `getCommitDiff(HEAD)` shows the same file-level changes.
- `resetShadowRepo wipes history entirely` — build up 3+ commits, reset, assert `getHistory()` length is exactly 1 and old hashes are gone (repo directory was truly recreated, not amended).
- Cross-platform path test — run the full init→commit→diff cycle against a path containing a space (e.g. `my project/`), assert no failures.

**Manual test steps**
1. `mkdir /tmp/diffender-manual-test && cd /tmp/diffender-manual-test`
2. In a throwaway Node REPL or a small script, `require('.../core/git-engine').initShadowRepo(process.cwd())`.
3. `ls -la .diffender/git` — confirm it exists; confirm it does **not** appear if you also `git init` a real repo alongside and run `git status` (should be silent, since real repo has no exclude entry yet — that's Step 6, expected at this stage).
4. Create/edit a file, call `commitCurrentState(cwd, "test prompt")`, then `git --git-dir=.diffender/git --work-tree=. log --oneline` directly in the terminal to eyeball the result independent of your own code.
5. Edit the file again without committing, call `getWorkingDiff(cwd)`, print it, confirm it matches what `git --git-dir=.diffender/git --work-tree=. diff` shows manually.
6. Call `resetShadowRepo(cwd)`, then `git --git-dir=.diffender/git --work-tree=. log --oneline` — confirm exactly one commit, and that it's a *new* hash (not one of the old ones).

---

## Step 3 — Config module (`config.json`)

**Goal:** Single source of truth for per-project settings, created at `init` time.

**Deliverables** (`src/config/config.js`)
- Schema (v1): `{ "open_diff_auto": true }` — extensible object, not a flat file, so future keys don't require a migration story on day one.
- `createDefaultConfig(projectRoot)` — writes `.diffender/config.json` if it doesn't already exist. All diffender state (shadow git repo + config) lives under one `.diffender/` folder.
- `loadConfig(projectRoot)` — reads + validates; on missing/corrupt file, regenerates defaults rather than crashing.
- `updateConfig(projectRoot, partial)` — for future `diffender config set` support (not required now, but keep the function shape ready).

**Automated tests**
- `creates default config with open_diff_auto=true when absent`
- `loadConfig returns existing values without overwriting them`
- `loadConfig recovers gracefully from malformed JSON` — write garbage to the file, assert it doesn't throw and returns sane defaults.

**Manual test steps**
1. Run init flow (once Step 5 exists) or call `createDefaultConfig` directly against a temp dir.
2. `cat .diffender/config.json` — confirm `open_diff_auto: true` by default.
3. Hand-edit it to `false`, reload via `loadConfig`, confirm the value round-trips.
4. Corrupt the file (`echo "{not json" > .diffender/config.json`), call `loadConfig` again, confirm no crash and defaults are restored.

---

## Step 4 — Diff presentation module (VS Code diff opener)

**Goal:** Turn a shadow-repo diff into an actual VS Code diff tab, per-file.

**Deliverables** (`src/diff-view/vscode-diff.js`)
- `openDiffForCommit(projectRoot, hash)` and `openDiffForWorkingChanges(projectRoot)`:
  - For each changed file: extract the "before" blob via `git --git-dir=.diffender/git show <hash>^:<relative-path>` (or `HEAD:<path>` for working-tree diffs) into a temp file under `os.tmpdir()`.
  - Shell out to `code --diff <tempBeforeFile> <realCurrentFile>` per changed file.
  - Handle **added** files (no "before" blob — diff against an empty temp file) and **deleted** files (no "after" file — diff against `/dev/null`-equivalent empty temp file) explicitly; don't just assume every changed file exists on both sides.
  - Clean up temp files after the `code` process is spawned (or on a delay/exit hook — since `code --diff` returns immediately without waiting for the tab to close, be careful not to delete the temp file before VS Code has read it; safest is to leave temp files in a diffender-specific tmp subfolder and clean up at the *start* of the next diff-open call, not immediately after this one).
- `isCodeCliAvailable()` — checks `code --version` succeeds; used to give a clear error/install instructions rather than a cryptic ENOENT if the `code` command isn't on PATH.

**Automated tests**
- `isCodeCliAvailable returns false gracefully when code is not on PATH` (mock `execa`/PATH for this one test).
- `openDiffForCommit builds correct temp-file content for a modified file` — verify temp file content equals the known "before" blob (don't assert on `code` actually launching in CI; that's a manual test).
- `openDiffForCommit handles added files without throwing` — before-blob extraction should yield an empty temp file, not an error.
- `openDiffForCommit handles deleted files without throwing` — after-file should resolve to an empty temp file placeholder.

**Manual test steps**
1. Ensure `code` CLI is installed (`code --version` in terminal).
2. In a real VS Code-opened test project with `.diffender/git` initialized, modify a file, call `openDiffForWorkingChanges`.
3. Confirm a VS Code diff tab opens with the correct before/after content.
4. Add a brand-new file and modify an existing one in the same "prompt," call again — confirm **two** diff tabs open, and the new file's diff shows against an empty left pane.
5. Delete a tracked file, call again — confirm the diff shows the file's old content against an empty right pane.
6. Temporarily rename `code` off your PATH and re-run — confirm you get a clear, actionable error message instead of a raw exception.

---

## Step 5 — CLI skeleton & command wiring

**Goal:** This is "wrap it so we can run `diffender history` / `diffender latest`" — pure plumbing on top of Steps 2–4, still provider-agnostic.

**Deliverables** (`src/cli/*`, using `commander` or similar)
- `diffender init` (generic, non-provider-specific parts only for now — provider flags land in Step 9): initializes `.diffender/git` (Step 2) + `config.json` (Step 3) if not already present; idempotent (running twice doesn't double-init or error).
- `diffender latest`: computes `getWorkingDiff` if there are uncommitted changes (i.e., a prompt just finished but hasn't been committed by the hook yet — shouldn't normally happen if hooks are wired, but the command should handle it), otherwise falls back to `getCommitDiff(HEAD)`; always opens the VS Code diff view regardless of `open_diff_auto` (per your requirement 6).
- `diffender history`: prints `getHistory()` as a readable table (hash, timestamp, first line of prompt/message).
- `diffender show <hash>`: `getCommitDiff(hash)`, printed to terminal **and** opened in VS Code diff view.
- `diffender reset`: calls `resetShadowRepo`, prints confirmation with the new baseline commit hash.
- `diffender gitintegrate`: Step 6.
- Every command checks `isShadowRepoInitialized` first and prints a friendly "run `diffender init` first" message rather than a stack trace if not.

**Automated tests**
- One test per command using a temp project directory, driving the CLI as a child process (true end-to-end for this layer): `init`, `latest` (with a manual file edit + commit to simulate a "prompt"), `history`, `show <hash>` with a real hash, `reset`.
- `history output is stable/parseable` — snapshot test on format, since later steps (or the user) may want to script against it.
- `latest before any commits exists gives a clear message, not a crash` (edge case: init just ran, no prompts yet).
- `show with an invalid/unknown hash fails clearly` rather than dumping a raw git error.

**Manual test steps**
1. `cd` into a fresh throwaway project (no `.diffender/git` yet). Run `diffender history` — confirm a friendly "not initialized" message, not a crash.
2. `diffender init` — confirm `.diffender/git` + `.diffender/config.json` created; run it a second time, confirm it doesn't error or wipe anything.
3. Manually edit a file (simulating what a hook would do), then manually call your `commitCurrentState` via a tiny throwaway script (hooks aren't wired yet) with a fake prompt string as the message.
4. `diffender history` — confirm the fake prompt text appears as the commit message.
5. `diffender latest` — confirm the VS Code diff opens showing that exact change.
6. `diffender show <hash>` using the hash from step 4 — confirm identical diff content to step 5.
7. `diffender reset` — confirm `.diffender/git` is recreated, `diffender history` now shows exactly one fresh baseline commit.

---

## Step 6 — Git integration / isolation (`gitintegrate`)

**Goal:** Keep the whole `.diffender/` folder invisible to the user's real `git status`, without ever touching anything trackable.

**Deliverables**
- `gitintegrate(projectRoot)` function: checks for `<projectRoot>/.git`. If present, appends `.diffender/` to `.git/info/exclude` **only if not already present** (idempotent — don't duplicate the line on repeated runs). If absent, returns a clear "no git repository detected here" status (not an error/exception — a normal, expected outcome).
- Wire this into `diffender init` as a best-effort step (run it, but don't fail `init` if there's no real `.git` yet).
- Expose `diffender gitintegrate` as a standalone command for the case where `.git` is created *after* `diffender init` already ran.

**Automated tests**
- `gitintegrate adds exclude line when .git exists` — create a temp `.git` dir (or run real `git init`), call, assert `.git/info/exclude` contains `.diffender/`.
- `gitintegrate is idempotent` — call twice, assert the line appears exactly once.
- `gitintegrate reports "not a git repo" cleanly when no .git exists` — assert a specific return value/message, not a thrown error.
- `init calls gitintegrate best-effort without failing when no .git exists`.

**Manual test steps**
1. In a project **without** `.git`: run `diffender init`. Confirm no crash, and (if you added a log line) confirm it mentions git integration was skipped.
2. Run `diffender gitintegrate` directly in that same non-git folder — confirm the friendly "not initialized" message.
3. `git init` in that folder now. Run `diffender gitintegrate`. Confirm `.git/info/exclude` now contains `.diffender/`.
4. `git status` — confirm `.diffender/` does **not** show up as untracked.
5. Run `diffender gitintegrate` again — `cat .git/info/exclude` and confirm the line wasn't duplicated.

---

## Step 7 — Provider strategy interface

**Goal:** Define the seam that lets opencode (now) and Claude Code/Cursor/Codex (later) plug in without touching Steps 1–6 again.

**Deliverables** (`src/providers/provider-interface.js` as documentation/contract, e.g. via JSDoc typedefs or a lightweight abstract base)
- Contract every provider module must implement:
  - `name` — string identifier (`"opencode"`, later `"claude-code"`, etc.)
  - `detect(projectRoot)` — does this provider's config/marker exist in this project? (e.g., presence of `.opencode/`)
  - `install(projectRoot)` — writes whatever hook/plugin files this provider needs, wired to call the Step 2 core engine + Step 4 diff viewer.
  - `uninstall(projectRoot)` — removes those files cleanly (useful for `reset`/re-init scenarios and for clean test teardown).
- `src/providers/registry.js`: a simple map/lookup so `diffender init --opencode` resolves to the right provider module by CLI flag, and `diffender init` with no flag can later auto-`detect()` across all registered providers.

**Automated tests**
- `registry resolves --opencode flag to the opencode provider module`
- `registry throws a clear, listable error for an unknown/unimplemented provider flag` (e.g. `--cursor` before it's built — should say "not yet supported" rather than silently doing nothing)
- Contract test: assert the opencode provider module (once built in Step 8) actually implements all four required functions — cheap guardrail against a future provider forgetting one.

**Manual test steps**
1. Run `diffender init --unsupported-provider` — confirm a clear "not supported yet, available: opencode" message rather than silent failure.
2. (Nothing else to manually test yet — this step is pure scaffolding, validated fully once Step 8 lands.)

---

## Step 8 — OpenCode provider implementation

**Goal:** The actual hook wiring — this is where `session.idle` and `session.updated` meet the Step 2 git engine.

**Where the hook code actually lives:** opencode auto-discovers and loads any `.js`/`.ts` file it finds under a project's `.opencode/plugin/` directory at session start — there is no separate "register a hook" step beyond the file existing there. Because of that, `install(projectRoot)` writes **two** things, not one:
1. The real hook logic (reading prompt text, calling the Step 2 git engine, calling the Step 4 diff opener) as a runtime module bundled/copied into `.diffender/opencode-plugin.js` — keeping it consolidated under the one `.diffender/` folder alongside the shadow repo and config.
2. A minimal stub at `<projectRoot>/.opencode/plugin/diffender.js` — just enough for opencode's loader to find, which immediately re-exports the module from step 1 (e.g. `export * from "../../.diffender/opencode-plugin.js"`). This keeps the footprint opencode requires to one tiny file, with everything else centralized.

This also avoids depending on the diffender CLI being globally resolvable from the target project's own `node_modules` — the stub points at a relative path inside the project, not at wherever `npm link`/`npx` happened to install diffender itself.

**Deliverables** (`src/providers/opencode/index.js` + the plugin template above)
- `install(projectRoot)` writes both files described above so that:
  - On `session.idle`:
    1. Pull the user's prompt text for that turn (via the session's message history / `message.updated` events captured during the turn); fallback to an ISO timestamp if unavailable.
    2. Call `getWorkingDiff` (Step 2) — this is the "current state vs last commit" diff.
    3. If `config.open_diff_auto` is `true` (Step 3), call `openDiffForWorkingChanges` (Step 4).
    4. Call `commitCurrentState(projectRoot, promptText)` to lock in the new baseline.
  - On `session.updated`:
    1. Compare the incoming event's `revert` field against the last-seen value for that session (in-memory map, keyed by session ID).
    2. On **any** transition (absent→present *or* present→absent — covers both undo-staged and redo-restored cases), call `resetShadowRepo(projectRoot)`. No history preserved, no attempt to label what happened — matches "let it be fresh again."
- `detect(projectRoot)` — checks for `.opencode/` directory presence.
- `uninstall(projectRoot)` — removes `diffender.js` from `.opencode/plugin/`.

**Automated tests** (mock the opencode plugin context/event objects — you don't need a running opencode instance for these)
- `session.idle handler commits with prompt text as message` — feed a fake event with a known prompt string, assert `getHistory()` shows it as the latest commit message.
- `session.idle handler falls back to timestamp when prompt text is unavailable` — feed an event with no extractable message, assert commit message matches an ISO-timestamp pattern.
- `session.idle handler respects open_diff_auto=false` — set config false, feed the event, assert the diff-opener mock was **not** called (but commit still happened).
- `session.idle handler with open_diff_auto=true calls the diff opener` — inverse of the above.
- `session.updated handler triggers reset on absent→present revert transition`
- `session.updated handler triggers reset on present→absent revert transition (redo)`
- `session.updated handler does NOT reset on unrelated field changes` (e.g. `session.status` changes with no revert field change) — important negative test, this is the one most likely to over-fire if implemented sloppily.
- `install() writes the plugin file to .opencode/plugin/, not a global directory`
- `detect() returns false in a project with no .opencode folder`

**Manual test steps**
1. In a real opencode-enabled test project, run `diffender init --opencode`.
2. `ls .opencode/plugin/` — confirm `diffender.js` is present.
3. Start an opencode session, send a prompt that edits a file, let it finish (reach idle).
4. Confirm the VS Code diff view pops up automatically (config default is `open_diff_auto: true`).
5. `diffender history` — confirm the prompt text you typed appears as the latest commit message.
6. Send a second prompt, let it finish. `diffender latest` — confirm it shows *only* the second prompt's changes, not a cumulative diff since the beginning.
7. Set `open_diff_auto: false` in `.diffender/config.json`. Send a third prompt — confirm no diff auto-opens, but `diffender latest` run manually still opens it and `diffender history` still shows the new commit.
8. Trigger `/undo` in opencode. Confirm `.diffender/git` was wiped and recreated (`diffender history` shows exactly one fresh baseline commit, no trace of the earlier prompts).
9. Trigger `/redo`. Confirm another fresh reset happened (again exactly one baseline commit — a *new* hash from step 8's baseline).

---

## Step 9 — End-to-end `init --opencode` wiring + cross-platform hardening

**Goal:** Make sure everything from Steps 1–8 comes together as one clean command, and stress-test the platform-sensitive edges.

**Deliverables**
- `diffender init --opencode` full sequence: shadow repo init (Step 2) → config creation (Step 3) → git isolation best-effort (Step 6) → opencode provider `install()` (Step 8) — all idempotent, safe to re-run.
- Hardening pass specifically on:
  - Windows path handling (backslashes, drive letters, spaces in paths) throughout Steps 2 and 4.
  - Missing `code` CLI — clear guidance message, not a crash, from both `latest`/`show` and the auto-open path inside the plugin.
  - Binary file changes (images, etc.) in a prompt's diff — git handles this fine natively, but confirm the VS Code diff opener doesn't choke trying to treat binary content as text.
  - Very large diffs (e.g. a prompt that touches 50+ files) — confirm the CLI doesn't try to spawn 50 `code --diff` windows without at least a sane cap/warning.
  - Empty/no-op prompts (AI turn that made no file changes) — confirm no spurious commit, no diff-opener call, no crash.

**Automated tests**
- Path-with-spaces end-to-end test (init → prompt-simulation → latest) on whichever CI platforms you target.
- Missing-`code`-CLI simulation → assert graceful message from `latest`.
- Binary file change → assert `commitCurrentState` and `getWorkingDiff` don't error, and diff-opener test asserts it either skips or opens without crashing.
- Many-files-changed scenario → assert some sane cap/behavior is actually exercised, not just assumed.
- No-op prompt → assert history length doesn't grow and diff-opener mock isn't called.

**Manual test steps**
1. Repeat the full Step 8 manual flow on Windows and macOS (or Linux if that's your second platform) — same checklist, different OS.
2. Use a path with a space in the project name on each OS.
3. Rename `code` off PATH and confirm `diffender init --opencode` still completes (git/config/plugin steps don't depend on `code`), and only the diff-*opening* step degrades gracefully.
4. Have the AI generate/modify a binary file (e.g., ask it to create a small PNG or copy an image) in one prompt — confirm `diffender show <hash>` doesn't crash.
5. Ask the AI to touch a large number of files in one prompt (e.g. a broad rename/refactor) — observe actual behavior against whatever cap you implemented.
6. Send a prompt that results in no file changes (e.g. a pure question) — confirm `diffender history` doesn't grow and nothing pops up.

---

## Step 10 — Full dogfooding pass & packaging validation

**Goal:** Confirm the whole thing works exactly as a real user (you) would install and use it, end to end, with nothing left as a "works on my machine because I ran it from src" assumption.

**Deliverables**
- Fresh clone of the repo into an unrelated directory, `npm install`, `npm link` — no reliance on any leftover local state from development.
- A short `README.md` documenting: install steps (`npx diffender init --opencode`), command reference (`latest`/`history`/`show`/`reset`/`gitintegrate`), the `config.json` schema, and the known limitations you've explicitly accepted (manual edits between prompts get folded into the next prompt's diff; revert/redo wipes diffender history by design).

**Automated tests**
- A single top-level "smoke suite" that runs the entire Step 9 flow end-to-end one more time as a final gate — same assertions, just run as one CI job representing the whole user journey rather than per-step.

**Manual test steps (the real acceptance test)**
1. On a completely fresh checkout in a new terminal/directory, follow only the README — no shortcuts from memory of building it.
2. Pick a real, unrelated existing project of yours with opencode already in use.
3. `npx diffender init --opencode` and confirm setup completes without errors.
4. Do 4–5 real prompts of varying kinds: a single-file edit, a multi-file edit, a no-op question, one that creates a new file, and one you then `/undo`.
5. After each, sanity-check `diffender latest`, and at the end run `diffender history` and spot-check two or three `diffender show <hash>` calls against what you remember actually happening.
6. Confirm `git status` in the real repo never shows `.diffender/git/`, and confirm the real repo's own commit history/log is completely untouched throughout.
7. Run `diffender reset` manually once at the end and confirm you're back to a single clean baseline commit.

---

## Summary checklist

| # | Step | Depends on |
|---|------|-----------|
| 1 | Project scaffolding & CLI skeleton | — |
| 2 | Core git engine (shadow repo lifecycle) | 1 |
| 3 | Config module | 1 |
| 4 | VS Code diff-opener | 2 |
| 5 | CLI commands (latest/history/show/reset) | 2, 3, 4 |
| 6 | Git isolation (`gitintegrate`) | 1 |
| 7 | Provider strategy interface | 1 |
| 8 | OpenCode provider (hooks) | 2, 3, 4, 7 |
| 9 | `init --opencode` wiring + hardening | 5, 6, 8 |
| 10 | Dogfooding & packaging validation | 9 |