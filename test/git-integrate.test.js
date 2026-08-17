const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);

const { gitintegrate } = require('../src/core/git-integrate');
const { initShadowRepo, isShadowRepoInitialized, getHistory } = require('../src/core/git-engine');

async function makeTempProject(prefix = 'diffender-gi-test-') {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

async function realGitInit(projectRoot) {
  await execFileAsync('git', ['init'], { cwd: projectRoot });
}

function excludePath(projectRoot) {
  return path.join(projectRoot, '.git', 'info', 'exclude');
}

test('gitintegrate adds exclude line when .git exists', async (t) => {
  const projectRoot = await makeTempProject();
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await realGitInit(projectRoot);

  const result = await gitintegrate(projectRoot);

  const content = await fs.readFile(excludePath(projectRoot), 'utf8');
  assert.ok(content.includes('.diffender/'), 'exclude should contain .diffender/');
  assert.strictEqual(result.applied, true);
});

test('gitintegrate is idempotent — line appears exactly once', async (t) => {
  const projectRoot = await makeTempProject();
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await realGitInit(projectRoot);

  await gitintegrate(projectRoot);
  await gitintegrate(projectRoot);

  const content = await fs.readFile(excludePath(projectRoot), 'utf8');
  const matches = content.match(/^\.diffender\/$/gm);
  assert.strictEqual(matches.length, 1, 'exclude line should appear exactly once');
});

test('gitintegrate reports not-a-git-repo cleanly when no .git exists', async (t) => {
  const projectRoot = await makeTempProject();
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  const result = await gitintegrate(projectRoot);

  assert.strictEqual(result.applied, false);
  assert.ok(
    result.message.toLowerCase().includes('no git') || result.message.toLowerCase().includes('not a git'),
    `should mention no git repo but got: ${result.message}`
  );
});

test('init calls gitintegrate best-effort without failing when no .git exists', async (t) => {
  const projectRoot = await makeTempProject();
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await initShadowRepo(projectRoot);

  assert.strictEqual(await isShadowRepoInitialized(projectRoot), true);
  const history = await getHistory(projectRoot);
  assert.strictEqual(history.length, 1);

  const gitDir = path.join(projectRoot, '.git');
  await assert.rejects(
    fs.stat(gitDir),
    /ENOENT/,
    'no real .git should exist (only .diffender/git)'
  );
});
