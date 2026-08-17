const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');

const {
  initShadowRepo,
  commitCurrentState,
  getHistory,
} = require('../src/core/git-engine');

const {
  isCodeCliAvailable,
  openDiffForCommit,
  openDiffForWorkingChanges,
} = require('../src/core/vscode');

async function makeTempProject(prefix = 'diffender-diff-test-') {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

function captureLaunchDiff() {
  const calls = [];
  const launchDiff = async (beforeFile, afterFile) => {
    calls.push({ beforeFile, afterFile });
  };
  return { calls, launchDiff };
}

test('isCodeCliAvailable returns false gracefully when code is not on PATH', async () => {
  const result = await isCodeCliAvailable({
    command: 'nonexistent-command-xyz123-diffender',
  });
  assert.strictEqual(result, false);
});

test('openDiffForCommit builds correct temp-file content for a modified file', async (t) => {
  const projectRoot = await makeTempProject();
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await fs.writeFile(path.join(projectRoot, 'file.txt'), 'original content');
  await initShadowRepo(projectRoot);

  await fs.writeFile(path.join(projectRoot, 'file.txt'), 'modified content');
  await commitCurrentState(projectRoot, 'modify file');

  const history = await getHistory(projectRoot);
  const hash = history[0].hash;

  const { calls, launchDiff } = captureLaunchDiff();
  await openDiffForCommit(projectRoot, hash, { launchDiff });

  assert.strictEqual(calls.length, 1, 'should open one diff for one changed file');
  const beforeContent = await fs.readFile(calls[0].beforeFile, 'utf8');
  assert.strictEqual(beforeContent, 'original content');
  const afterContent = await fs.readFile(calls[0].afterFile, 'utf8');
  assert.strictEqual(afterContent, 'modified content');
});

test('openDiffForCommit handles added files without throwing', async (t) => {
  const projectRoot = await makeTempProject();
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await initShadowRepo(projectRoot);

  await fs.writeFile(path.join(projectRoot, 'new.txt'), 'new file content');
  await commitCurrentState(projectRoot, 'add file');

  const history = await getHistory(projectRoot);
  const hash = history[0].hash;

  const { calls, launchDiff } = captureLaunchDiff();
  await openDiffForCommit(projectRoot, hash, { launchDiff });

  assert.strictEqual(calls.length, 1);
  const beforeContent = await fs.readFile(calls[0].beforeFile, 'utf8');
  assert.strictEqual(beforeContent, '', 'before content should be empty for added file');
  const afterContent = await fs.readFile(calls[0].afterFile, 'utf8');
  assert.strictEqual(afterContent, 'new file content');
});

test('openDiffForCommit handles deleted files without throwing', async (t) => {
  const projectRoot = await makeTempProject();
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await fs.writeFile(path.join(projectRoot, 'doomed.txt'), 'doomed content');
  await initShadowRepo(projectRoot);

  await fs.unlink(path.join(projectRoot, 'doomed.txt'));
  await commitCurrentState(projectRoot, 'delete file');

  const history = await getHistory(projectRoot);
  const hash = history[0].hash;

  const { calls, launchDiff } = captureLaunchDiff();
  await openDiffForCommit(projectRoot, hash, { launchDiff });

  assert.strictEqual(calls.length, 1);
  const beforeContent = await fs.readFile(calls[0].beforeFile, 'utf8');
  assert.strictEqual(beforeContent, 'doomed content');
  const afterContent = await fs.readFile(calls[0].afterFile, 'utf8');
  assert.strictEqual(afterContent, '', 'after content should be empty for deleted file');
});

test('openDiffForWorkingChanges builds correct temp-file content for a modified file', async (t) => {
  const projectRoot = await makeTempProject();
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await fs.writeFile(path.join(projectRoot, 'file.txt'), 'original content');
  await initShadowRepo(projectRoot);

  await fs.writeFile(path.join(projectRoot, 'file.txt'), 'modified content');

  const { calls, launchDiff } = captureLaunchDiff();
  await openDiffForWorkingChanges(projectRoot, { launchDiff });

  assert.strictEqual(calls.length, 1);
  const beforeContent = await fs.readFile(calls[0].beforeFile, 'utf8');
  assert.strictEqual(beforeContent, 'original content');
  const afterContent = await fs.readFile(calls[0].afterFile, 'utf8');
  assert.strictEqual(afterContent, 'modified content');
});
