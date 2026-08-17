const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');

const {
  initShadowRepo,
  isShadowRepoInitialized,
  getHistory,
  commitCurrentState,
  getWorkingDiff,
  getCommitDiff,
  resetShadowRepo,
} = require('../src/core/git-engine');

async function makeTempProject(prefix = 'diffender-test-') {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

test('init creates .diffender/git and one baseline commit', async (t) => {
  const projectRoot = await makeTempProject();
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  assert.strictEqual(await isShadowRepoInitialized(projectRoot), false);
  await initShadowRepo(projectRoot);
  assert.strictEqual(await isShadowRepoInitialized(projectRoot), true);

  const gitDir = path.join(projectRoot, '.diffender', 'git');
  const stat = await fs.stat(gitDir);
  assert.ok(stat.isDirectory(), '.diffender/git should be a directory');

  const history = await getHistory(projectRoot);
  assert.strictEqual(history.length, 1);
  assert.strictEqual(history[0].message, 'diffender: baseline');
});

test('init seeds default excludes in .diffender/git/info/exclude', async (t) => {
  const projectRoot = await makeTempProject();
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await initShadowRepo(projectRoot);

  const excludePath = path.join(projectRoot, '.diffender', 'git', 'info', 'exclude');
  const excludeContent = await fs.readFile(excludePath, 'utf8');

  assert.ok(excludeContent.includes('.opencode/'), 'exclude should contain .opencode/');
  assert.ok(excludeContent.includes('.swarm/'), 'exclude should contain .swarm/');
  assert.ok(excludeContent.includes('node_modules/'), 'exclude should contain node_modules/');
  assert.ok(excludeContent.includes('.git/'), 'exclude should contain .git/');
  assert.ok(excludeContent.includes('.diffender/'), 'exclude should contain .diffender/');
});

test('init inherits project .gitignore — ignored file is untracked', async (t) => {
  const projectRoot = await makeTempProject();
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await fs.writeFile(path.join(projectRoot, '.gitignore'), 'secret.txt\n');
  await fs.writeFile(path.join(projectRoot, 'secret.txt'), 'should be ignored');
  await fs.writeFile(path.join(projectRoot, 'tracked.txt'), 'should be tracked');

  await initShadowRepo(projectRoot);

  const { execFile } = require('node:child_process');
  const { promisify } = require('node:util');
  const execFileAsync = promisify(execFile);
  const gitDir = path.join(projectRoot, '.diffender', 'git').replace(/\\/g, '/');
  const workTree = projectRoot.replace(/\\/g, '/');
  const { stdout } = await execFileAsync('git', [
    `--git-dir=${gitDir}`,
    `--work-tree=${workTree}`,
    'ls-files',
  ]);
  const trackedFiles = stdout.split('\n').filter(Boolean);

  assert.ok(trackedFiles.includes('tracked.txt'), 'tracked.txt should be tracked');
  assert.ok(!trackedFiles.includes('secret.txt'), 'secret.txt should be ignored via .gitignore');
});

test('commitCurrentState creates a new commit with given message', async (t) => {
  const projectRoot = await makeTempProject();
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await fs.writeFile(path.join(projectRoot, 'file.txt'), 'initial');
  await initShadowRepo(projectRoot);

  const historyBefore = await getHistory(projectRoot);
  assert.strictEqual(historyBefore.length, 1);

  await fs.writeFile(path.join(projectRoot, 'file.txt'), 'modified');
  const promptMessage = 'Fix the login bug\n\nAlso update the tests';
  await commitCurrentState(projectRoot, promptMessage);

  const historyAfter = await getHistory(projectRoot);
  assert.strictEqual(historyAfter.length, 2);
  assert.strictEqual(historyAfter[0].message, promptMessage);
});

test('commitCurrentState is a no-op when nothing changed', async (t) => {
  const projectRoot = await makeTempProject();
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await fs.writeFile(path.join(projectRoot, 'file.txt'), 'initial');
  await initShadowRepo(projectRoot);

  await fs.writeFile(path.join(projectRoot, 'file.txt'), 'changed');
  await commitCurrentState(projectRoot, 'first prompt');
  const historyAfterFirst = await getHistory(projectRoot);
  assert.strictEqual(historyAfterFirst.length, 2);

  await commitCurrentState(projectRoot, 'second prompt — no changes');
  const historyAfterSecond = await getHistory(projectRoot);
  assert.strictEqual(historyAfterSecond.length, 2, 'history should not grow when nothing changed');
});

test('getWorkingDiff reflects uncommitted changes only', async (t) => {
  const projectRoot = await makeTempProject();
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await fs.writeFile(path.join(projectRoot, 'file.txt'), 'initial content');
  await initShadowRepo(projectRoot);

  await fs.writeFile(path.join(projectRoot, 'file.txt'), 'modified content');

  const { diff, files } = await getWorkingDiff(projectRoot);

  assert.ok(diff.includes('initial content'), 'diff should show old content');
  assert.ok(diff.includes('modified content'), 'diff should show new content');
  assert.ok(files.includes('file.txt'), 'files should include file.txt');

  const history = await getHistory(projectRoot);
  assert.strictEqual(history.length, 1, 'history should still show only baseline commit');
});

test('getCommitDiff matches getWorkingDiff content pre-commit', async (t) => {
  const projectRoot = await makeTempProject();
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await fs.writeFile(path.join(projectRoot, 'file.txt'), 'initial content');
  await initShadowRepo(projectRoot);

  await fs.writeFile(path.join(projectRoot, 'file.txt'), 'modified content');
  const working = await getWorkingDiff(projectRoot);
  await commitCurrentState(projectRoot, 'test prompt');

  const history = await getHistory(projectRoot);
  const headHash = history[0].hash;
  const commit = await getCommitDiff(projectRoot, headHash);

  assert.deepStrictEqual(commit.files.sort(), working.files.sort());
  assert.ok(commit.diff.includes('initial content'), 'commit diff should show old content');
  assert.ok(commit.diff.includes('modified content'), 'commit diff should show new content');
});

test('resetShadowRepo wipes history entirely', async (t) => {
  const projectRoot = await makeTempProject();
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await fs.writeFile(path.join(projectRoot, 'file.txt'), 'v1');
  await initShadowRepo(projectRoot);

  await fs.writeFile(path.join(projectRoot, 'file.txt'), 'v2');
  await commitCurrentState(projectRoot, 'first prompt');

  await fs.writeFile(path.join(projectRoot, 'file.txt'), 'v3');
  await commitCurrentState(projectRoot, 'second prompt');

  const historyBefore = await getHistory(projectRoot);
  assert.strictEqual(historyBefore.length, 3);
  const oldHashes = new Set(historyBefore.map((h) => h.hash));

  await resetShadowRepo(projectRoot);

  const historyAfter = await getHistory(projectRoot);
  assert.strictEqual(historyAfter.length, 1, 'history should be exactly 1 after reset');
  assert.strictEqual(historyAfter[0].message, 'diffender: baseline');
  assert.ok(
    !oldHashes.has(historyAfter[0].hash),
    'new baseline hash should differ from all old hashes'
  );
});

test('full init→commit→diff cycle works with a path containing a space', async (t) => {
  const projectRoot = await makeTempProject('diffender test space-');
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  assert.ok(path.basename(projectRoot).includes(' '), 'temp dir name should contain a space');

  await fs.writeFile(path.join(projectRoot, 'file.txt'), 'initial');
  await initShadowRepo(projectRoot);
  assert.strictEqual(await isShadowRepoInitialized(projectRoot), true);

  const historyAfterInit = await getHistory(projectRoot);
  assert.strictEqual(historyAfterInit.length, 1);

  await fs.writeFile(path.join(projectRoot, 'file.txt'), 'modified');
  const working = await getWorkingDiff(projectRoot);
  assert.ok(working.diff.includes('initial'));
  assert.ok(working.diff.includes('modified'));
  assert.ok(working.files.includes('file.txt'));

  await commitCurrentState(projectRoot, 'prompt with space path');

  const historyAfterCommit = await getHistory(projectRoot);
  assert.strictEqual(historyAfterCommit.length, 2);
  assert.strictEqual(historyAfterCommit[0].message, 'prompt with space path');

  const commit = await getCommitDiff(projectRoot, historyAfterCommit[0].hash);
  assert.deepStrictEqual(commit.files.sort(), working.files.sort());
  assert.ok(commit.diff.includes('modified'));

  await resetShadowRepo(projectRoot);
  const historyAfterReset = await getHistory(projectRoot);
  assert.strictEqual(historyAfterReset.length, 1);
});
