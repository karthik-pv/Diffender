const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');

const claudeProvider = require('../src/providers/claude');

async function makeTempProject(prefix = 'diffender-claude-test-') {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

test('detect() returns false in a project with no .claude folder', async (t) => {
  const projectRoot = await makeTempProject();
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  const result = await claudeProvider.detect(projectRoot);
  assert.strictEqual(result, false);
});

test('detect() returns true in a project with a .claude folder', async (t) => {
  const projectRoot = await makeTempProject();
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await fs.mkdir(path.join(projectRoot, '.claude'), { recursive: true });

  const result = await claudeProvider.detect(projectRoot);
  assert.strictEqual(result, true);
});

test('install() writes hook scripts and runtime libs, and registers hooks in settings.json', async (t) => {
  const projectRoot = await makeTempProject();
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await fs.mkdir(path.join(projectRoot, '.diffender'), { recursive: true });

  await claudeProvider.install(projectRoot);

  const hookFiles = ['diffender-user-prompt-submit.js', 'diffender-stop.js'];
  for (const file of hookFiles) {
    const hookPath = path.join(projectRoot, '.claude', 'hooks', file);
    const stat = await fs.stat(hookPath);
    assert.ok(stat.isFile(), `${file} should exist under .claude/hooks/`);
  }

  const libFiles = ['session-handler.js', 'git-engine.js', 'config.js', 'vscode.js'];
  for (const file of libFiles) {
    const libPath = path.join(projectRoot, '.diffender', 'lib', file);
    const libStat = await fs.stat(libPath);
    assert.ok(libStat.isFile(), `${file} should be copied to .diffender/lib/${file}`);
  }

  const settings = JSON.parse(
    await fs.readFile(path.join(projectRoot, '.claude', 'settings.json'), 'utf8')
  );

  assert.ok(settings.hooks.UserPromptSubmit, 'UserPromptSubmit hook should be registered');
  assert.ok(settings.hooks.Stop, 'Stop hook should be registered');
  assert.ok(
    settings.hooks.UserPromptSubmit[0].hooks[0].command.includes('diffender-user-prompt-submit.js')
  );
  assert.ok(settings.hooks.Stop[0].hooks[0].command.includes('diffender-stop.js'));
});

test('install() is idempotent and does not duplicate hook entries', async (t) => {
  const projectRoot = await makeTempProject();
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await fs.mkdir(path.join(projectRoot, '.diffender'), { recursive: true });

  await claudeProvider.install(projectRoot);
  await claudeProvider.install(projectRoot);

  const settings = JSON.parse(
    await fs.readFile(path.join(projectRoot, '.claude', 'settings.json'), 'utf8')
  );

  assert.strictEqual(settings.hooks.UserPromptSubmit.length, 1);
  assert.strictEqual(settings.hooks.Stop.length, 1);
});

test('install() preserves existing unrelated settings.json content', async (t) => {
  const projectRoot = await makeTempProject();
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await fs.mkdir(path.join(projectRoot, '.claude'), { recursive: true });
  await fs.mkdir(path.join(projectRoot, '.diffender'), { recursive: true });
  await fs.writeFile(
    path.join(projectRoot, '.claude', 'settings.json'),
    JSON.stringify({
      model: 'claude-sonnet-5',
      hooks: {
        PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo hi' }] }],
      },
    })
  );

  await claudeProvider.install(projectRoot);

  const settings = JSON.parse(
    await fs.readFile(path.join(projectRoot, '.claude', 'settings.json'), 'utf8')
  );

  assert.strictEqual(settings.model, 'claude-sonnet-5', 'unrelated top-level keys should survive');
  assert.strictEqual(
    settings.hooks.PreToolUse[0].hooks[0].command,
    'echo hi',
    'unrelated hook entries should survive'
  );
  assert.ok(settings.hooks.UserPromptSubmit, 'our hook should be added alongside existing ones');
  assert.ok(settings.hooks.Stop, 'our hook should be added alongside existing ones');
});

test('uninstall() removes hook scripts and our hook entries from settings.json, preserving others', async (t) => {
  const projectRoot = await makeTempProject();
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await fs.mkdir(path.join(projectRoot, '.claude'), { recursive: true });
  await fs.mkdir(path.join(projectRoot, '.diffender'), { recursive: true });
  await fs.writeFile(
    path.join(projectRoot, '.claude', 'settings.json'),
    JSON.stringify({
      hooks: {
        PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo hi' }] }],
      },
    })
  );

  await claudeProvider.install(projectRoot);
  await claudeProvider.uninstall(projectRoot);

  await assert.rejects(
    fs.stat(path.join(projectRoot, '.claude', 'hooks', 'diffender-stop.js')),
    /ENOENT/
  );
  await assert.rejects(
    fs.stat(path.join(projectRoot, '.claude', 'hooks', 'diffender-user-prompt-submit.js')),
    /ENOENT/
  );

  const settings = JSON.parse(
    await fs.readFile(path.join(projectRoot, '.claude', 'settings.json'), 'utf8')
  );

  assert.strictEqual(settings.hooks.UserPromptSubmit, undefined);
  assert.strictEqual(settings.hooks.Stop, undefined);
  assert.strictEqual(
    settings.hooks.PreToolUse[0].hooks[0].command,
    'echo hi',
    'unrelated hooks should remain after uninstall'
  );
});

test('uninstall() removes settings.json entirely if diffender was the only content', async (t) => {
  const projectRoot = await makeTempProject();
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await fs.mkdir(path.join(projectRoot, '.diffender'), { recursive: true });

  await claudeProvider.install(projectRoot);
  await claudeProvider.uninstall(projectRoot);

  await assert.rejects(
    fs.stat(path.join(projectRoot, '.claude', 'settings.json')),
    /ENOENT/
  );
});

test('stop hook commits with prompt text captured by the user-prompt-submit hook', async (t) => {
  const { initShadowRepo, getHistory } = require('../src/core/git-engine');
  const { execFileSync } = require('node:child_process');

  const projectRoot = await makeTempProject();
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await fs.writeFile(path.join(projectRoot, 'file.txt'), 'initial');
  await initShadowRepo(projectRoot);
  await claudeProvider.install(projectRoot);
  await fs.writeFile(
    path.join(projectRoot, '.diffender', 'config.json'),
    JSON.stringify({ open_diff_auto: false })
  );

  await fs.writeFile(path.join(projectRoot, 'file.txt'), 'changed');

  const promptHookPath = path.join(projectRoot, '.claude', 'hooks', 'diffender-user-prompt-submit.js');
  const stopHookPath = path.join(projectRoot, '.claude', 'hooks', 'diffender-stop.js');

  const env = { ...process.env, CLAUDE_PROJECT_DIR: projectRoot };

  execFileSync('node', [promptHookPath], {
    input: JSON.stringify({ session_id: 's1', prompt: 'Fix the login bug' }),
    env,
  });

  execFileSync('node', [stopHookPath], {
    input: JSON.stringify({ session_id: 's1' }),
    env,
  });

  const history = await getHistory(projectRoot);
  assert.strictEqual(history.length, 2);
  assert.strictEqual(history[0].message, 'Fix the login bug');
});
