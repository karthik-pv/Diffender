const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');

const {
  initShadowRepo,
  getHistory,
  commitCurrentState,
  getWorkingDiff,
} = require('../src/core/git-engine');
const { createSessionHandler } = require('../src/core/session-handler');
const { loadConfig } = require('../src/core/config');

const BIN_PATH = path.join(__dirname, '..', 'bin', 'diffender.js');

async function makeTempProject(prefix = 'diffender-s9-test-') {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

function runCli(args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn('node', [BIN_PATH, ...args], {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (data) => { stdout += data; });
    child.stderr.on('data', (data) => { stderr += data; });
    child.on('error', reject);
    child.on('close', (code) => {
      resolve({ exitCode: code, stdout, stderr });
    });
  });
}

test('init --opencode runs full sequence: shadow repo + config + gitintegrate + provider install', async (t) => {
  const projectRoot = await makeTempProject();
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  const { exitCode, stdout, stderr } = await runCli(['init', '--opencode'], projectRoot);
  assert.strictEqual(exitCode, 0, `init --opencode failed: ${stderr}`);

  assert.ok(
    await fs.stat(path.join(projectRoot, '.diffender', 'git')).then(() => true).catch(() => false),
    'shadow repo should exist'
  );
  assert.ok(
    await fs.stat(path.join(projectRoot, '.diffender', 'config.json')).then(() => true).catch(() => false),
    'config should exist'
  );
  assert.ok(
    await fs.stat(path.join(projectRoot, '.opencode', 'plugins', 'diffender.js')).then(() => true).catch(() => false),
    'opencode plugin should exist'
  );
  assert.ok(
    stdout.toLowerCase().includes('opencode') || stdout.toLowerCase().includes('provider'),
    'should mention opencode/provider in output'
  );
});

test('init --opencode is idempotent — safe to re-run', async (t) => {
  const projectRoot = await makeTempProject();
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await runCli(['init', '--opencode'], projectRoot);
  const historyAfterFirst = await getHistory(projectRoot);
  assert.strictEqual(historyAfterFirst.length, 1);

  const { exitCode, stderr } = await runCli(['init', '--opencode'], projectRoot);
  assert.strictEqual(exitCode, 0, `second init failed: ${stderr}`);

  const historyAfterSecond = await getHistory(projectRoot);
  assert.strictEqual(historyAfterSecond.length, 1, 'should not add commits on re-run');
});

test('init with unknown provider flag gives clear error', async (t) => {
  const projectRoot = await makeTempProject();
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  const { exitCode, stdout, stderr } = await runCli(['init', '--cursor'], projectRoot);
  assert.notStrictEqual(exitCode, 0, 'should exit non-zero for unknown provider');
  const output = stdout + stderr;
  assert.ok(
    output.includes('cursor') && output.includes('opencode'),
    `should mention the unknown flag and available providers but got:\n${output}`
  );
});

test('path-with-spaces end-to-end: init → snapshot → latest --no-open', async (t) => {
  const projectRoot = await makeTempProject('diffender space test-');
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  assert.ok(path.basename(projectRoot).includes(' '), 'temp dir should contain a space');

  const { exitCode: initCode, stderr: initErr } = await runCli(['init'], projectRoot);
  assert.strictEqual(initCode, 0, `init failed: ${initErr}`);

  await fs.writeFile(path.join(projectRoot, 'file.txt'), 'initial');
  await initShadowRepo(projectRoot);
  await fs.writeFile(path.join(projectRoot, 'file.txt'), 'changed');

  const { exitCode: snapCode, stderr: snapErr } = await runCli(['snapshot', 'test prompt'], projectRoot);
  assert.strictEqual(snapCode, 0, `snapshot failed: ${snapErr}`);

  const { exitCode: latestCode, stdout: latestOut, stderr: latestErr } = await runCli(['latest', '--no-open'], projectRoot);
  assert.strictEqual(latestCode, 0, `latest failed: ${latestErr}`);
  assert.ok(latestOut.includes('changed'), 'latest should show changed content');
});

test('missing code CLI → latest gives graceful message not crash', async (t) => {
  const projectRoot = await makeTempProject();
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await fs.writeFile(path.join(projectRoot, 'file.txt'), 'initial');
  await initShadowRepo(projectRoot);
  await fs.writeFile(path.join(projectRoot, 'file.txt'), 'changed');

  const { exitCode, stdout, stderr } = await runCli(['latest', '--no-open'], projectRoot);
  assert.strictEqual(exitCode, 0, `latest should not crash: ${stderr}`);
  const output = stdout + stderr;
  assert.ok(
    !output.includes('    at '),
    'should not dump a stack trace'
  );
  assert.ok(
    output.includes('changed'),
    'should still print the diff content'
  );
});

test('binary file change → commit and getWorkingDiff do not error', async (t) => {
  const projectRoot = await makeTempProject();
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  const binaryData = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x0a]);
  await fs.writeFile(path.join(projectRoot, 'image.png'), binaryData);
  await initShadowRepo(projectRoot);

  const modifiedBinary = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xff, 0xff]);
  await fs.writeFile(path.join(projectRoot, 'image.png'), modifiedBinary);

  const { diff, files } = await getWorkingDiff(projectRoot);
  assert.ok(files.includes('image.png'), 'binary file should appear in diff files');
  assert.ok(diff.includes('image.png'), 'diff should mention the binary file');

  const committed = await commitCurrentState(projectRoot, 'binary edit');
  assert.strictEqual(committed, true, 'should commit binary file change');
});

test('binary file → diff opener skips it via git numstat detection', async (t) => {
  const projectRoot = await makeTempProject();
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  const binaryData = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x0a]);
  await fs.writeFile(path.join(projectRoot, 'image.png'), binaryData);
  await fs.writeFile(path.join(projectRoot, 'text.txt'), 'hello');
  await initShadowRepo(projectRoot);

  const modifiedBinary = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xff, 0xff]);
  await fs.writeFile(path.join(projectRoot, 'image.png'), modifiedBinary);
  await fs.writeFile(path.join(projectRoot, 'text.txt'), 'world');

  const launchCalls = [];
  const launchDiff = async (before, after) => {
    launchCalls.push({ before, after });
  };

  const { openDiffForWorkingChanges } = require('../src/core/vscode');
  await openDiffForWorkingChanges(projectRoot, { launchDiff });

  assert.strictEqual(launchCalls.length, 1, 'should open diff for text file only, skip binary');
});

test('many-files-changed → diff opener caps at 10 files with warning', async (t) => {
  const projectRoot = await makeTempProject();
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await fs.writeFile(path.join(projectRoot, 'base.txt'), 'base');
  await initShadowRepo(projectRoot);

  for (let i = 0; i < 15; i++) {
    await fs.writeFile(path.join(projectRoot, `file${i}.txt`), `content ${i}`);
  }

  const launchCalls = [];
  const launchDiff = async (before, after) => {
    launchCalls.push({ before, after });
  };

  const { openDiffForWorkingChanges } = require('../src/core/vscode');
  await openDiffForWorkingChanges(projectRoot, { launchDiff });

  assert.ok(launchCalls.length <= 10, `should cap at 10 diff windows but got ${launchCalls.length}`);
});

test('no-op prompt → history does not grow, diff opener not called', async (t) => {
  const projectRoot = await makeTempProject();
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await fs.writeFile(path.join(projectRoot, 'file.txt'), 'initial');
  await initShadowRepo(projectRoot);

  const historyBefore = await getHistory(projectRoot);
  assert.strictEqual(historyBefore.length, 1);

  const diffCalls = [];
  const handler = createSessionHandler({
    getMessages: async () => [{ role: 'user', content: 'just a question' }],
    getWorkingDiff: () => getWorkingDiff(projectRoot),
    loadConfig: () => loadConfig(projectRoot),
    openDiff: async () => { diffCalls.push(true); },
    commitSnapshot: (msg) => commitCurrentState(projectRoot, msg),
    reset: () => { throw new Error('should not reset'); },
  });

  await handler.onIdle({ type: 'session.idle', properties: { session: { id: 's1' } } });

  const historyAfter = await getHistory(projectRoot);
  assert.strictEqual(historyAfter.length, 1, 'history should not grow for no-op prompt');
  assert.strictEqual(diffCalls.length, 0, 'diff opener should not be called');
});
