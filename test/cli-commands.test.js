const { test } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');

const {
  initShadowRepo,
  commitCurrentState,
  getHistory,
} = require('../src/core/git-engine');

const BIN_PATH = path.join(__dirname, '..', 'bin', 'diffender.js');

async function makeTempProject(prefix = 'diffender-cli-test-') {
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

test('diffender init creates .diffender/git + config.json, idempotent', async (t) => {
  const projectRoot = await makeTempProject();
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  const { exitCode, stderr } = await runCli(['init'], projectRoot);
  assert.strictEqual(exitCode, 0, `init failed: ${stderr}`);

  const gitDir = path.join(projectRoot, '.diffender', 'git');
  const stat = await fs.stat(gitDir);
  assert.ok(stat.isDirectory(), '.diffender/git should exist');

  const configRaw = await fs.readFile(
    path.join(projectRoot, '.diffender', 'config.json'),
    'utf8'
  );
  assert.strictEqual(JSON.parse(configRaw).open_diff_auto, true);

  const history = await getHistory(projectRoot);
  assert.strictEqual(history.length, 1, 'should have one baseline commit');

  const { exitCode: exit2, stderr: stderr2 } = await runCli(['init'], projectRoot);
  assert.strictEqual(exit2, 0, `second init failed: ${stderr2}`);

  const history2 = await getHistory(projectRoot);
  assert.strictEqual(history2.length, 1, 'second init should not add commits');
});

test('diffender history prints a readable table with hash and message', async (t) => {
  const projectRoot = await makeTempProject();
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await fs.writeFile(path.join(projectRoot, 'file.txt'), 'initial');
  await initShadowRepo(projectRoot);
  await fs.writeFile(path.join(projectRoot, 'file.txt'), 'changed');
  await commitCurrentState(projectRoot, 'Fix the login bug');

  const { exitCode, stdout, stderr } = await runCli(['history'], projectRoot);
  assert.strictEqual(exitCode, 0, `history failed: ${stderr}`);

  assert.ok(stdout.includes('Fix the login bug'), 'history should show commit message');
  assert.ok(stdout.includes('diffender: baseline'), 'history should show baseline commit');
  const history = await getHistory(projectRoot);
  assert.ok(stdout.includes(history[0].hash), 'history should show the hash');
});

test('diffender history output is stable/parseable', async (t) => {
  const projectRoot = await makeTempProject();
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await fs.writeFile(path.join(projectRoot, 'file.txt'), 'initial');
  await initShadowRepo(projectRoot);
  await fs.writeFile(path.join(projectRoot, 'file.txt'), 'changed');
  await commitCurrentState(projectRoot, 'Fix the login bug');

  const { exitCode, stdout } = await runCli(['history'], projectRoot);
  assert.strictEqual(exitCode, 0);

  const lines = stdout.split('\n').filter(Boolean);
  assert.ok(lines.length >= 2, 'should have at least 2 lines (header + commits)');

  const header = lines[0];
  assert.ok(header.includes('HASH'), 'header should have HASH column');
  assert.ok(header.includes('DATE'), 'header should have DATE column');
  assert.ok(header.includes('MESSAGE'), 'header should have MESSAGE column');

  const dataLines = lines.slice(1);
  for (const line of dataLines) {
    assert.ok(line.trim().length > 0, 'data lines should not be empty');
  }
});

test('diffender show <hash> prints diff to terminal', async (t) => {
  const projectRoot = await makeTempProject();
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await fs.writeFile(path.join(projectRoot, 'file.txt'), 'initial');
  await initShadowRepo(projectRoot);
  await fs.writeFile(path.join(projectRoot, 'file.txt'), 'changed content');
  await commitCurrentState(projectRoot, 'modify file');

  const history = await getHistory(projectRoot);
  const hash = history[0].hash;

  const { exitCode, stdout, stderr } = await runCli(['show', hash, '--no-open'], projectRoot);
  assert.strictEqual(exitCode, 0, `show failed: ${stderr}`);

  assert.ok(stdout.includes('changed content'), 'show should print diff with new content');
  assert.ok(stdout.includes('initial'), 'show should print diff with old content');
});

test('diffender reset recreates repo with one fresh baseline commit', async (t) => {
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

  const { exitCode, stdout, stderr } = await runCli(['reset'], projectRoot);
  assert.strictEqual(exitCode, 0, `reset failed: ${stderr}`);

  assert.ok(stdout.includes('reset') || stdout.includes('baseline'), 'reset should confirm');

  const historyAfter = await getHistory(projectRoot);
  assert.strictEqual(historyAfter.length, 1, 'should have exactly one commit after reset');
  assert.strictEqual(historyAfter[0].message, 'diffender: baseline');
});

test('diffender snapshot <msg> creates a commit with the given message', async (t) => {
  const projectRoot = await makeTempProject();
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await fs.writeFile(path.join(projectRoot, 'file.txt'), 'initial');
  await initShadowRepo(projectRoot);

  await fs.writeFile(path.join(projectRoot, 'file.txt'), 'changed');

  const { exitCode, stdout, stderr } = await runCli(['snapshot', 'manual checkpoint'], projectRoot);
  assert.strictEqual(exitCode, 0, `snapshot failed: ${stderr}`);

  const history = await getHistory(projectRoot);
  assert.strictEqual(history.length, 2, 'should have baseline + snapshot commit');
  assert.strictEqual(history[0].message, 'manual checkpoint');
  assert.ok(stdout.includes('manual checkpoint'), 'should print confirmation with message');
});

test('diffender snapshot with no changes gives a clear message, not a crash', async (t) => {
  const projectRoot = await makeTempProject();
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await fs.writeFile(path.join(projectRoot, 'file.txt'), 'initial');
  await initShadowRepo(projectRoot);

  const { exitCode, stdout, stderr } = await runCli(['snapshot', 'nothing to commit'], projectRoot);
  assert.strictEqual(exitCode, 0, `snapshot should not crash: ${stderr}`);
  assert.ok(
    stdout.toLowerCase().includes('no changes') || stdout.toLowerCase().includes('nothing'),
    `should give a clear message but got:\n${stdout}`
  );

  const history = await getHistory(projectRoot);
  assert.strictEqual(history.length, 1, 'should not add a commit when nothing changed');
});

test('diffender snapshot without init gives friendly message, not a crash', async (t) => {
  const projectRoot = await makeTempProject();
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  const { exitCode, stdout, stderr } = await runCli(['snapshot', 'test'], projectRoot);
  assert.strictEqual(exitCode, 0, `should not crash: ${stderr}`);
  assert.ok(
    stdout.toLowerCase().includes('init') || stdout.toLowerCase().includes('not initialized'),
    `should suggest running init but got:\n${stdout}`
  );
  assert.ok(!stderr.includes('    at '), 'should not dump a stack trace');
});

test('diffender latest with no prompts gives a clear message, not a crash', async (t) => {
  const projectRoot = await makeTempProject();
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await fs.writeFile(path.join(projectRoot, 'file.txt'), 'initial');
  await initShadowRepo(projectRoot);

  const { exitCode, stdout, stderr } = await runCli(['latest'], projectRoot);
  assert.strictEqual(exitCode, 0, `latest should not crash: ${stderr}`);
  assert.ok(
    stdout.toLowerCase().includes('no changes') || stdout.toLowerCase().includes('nothing'),
    `latest with no changes should give a clear message but got:\n${stdout}`
  );
  assert.ok(!stderr.includes('at '), 'should not dump a stack trace');
});

test('diffender show with invalid hash fails clearly', async (t) => {
  const projectRoot = await makeTempProject();
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await fs.writeFile(path.join(projectRoot, 'file.txt'), 'initial');
  await initShadowRepo(projectRoot);

  const { exitCode, stdout, stderr } = await runCli(['show', 'invalidhash123'], projectRoot);
  assert.notStrictEqual(exitCode, 0, 'should exit non-zero for invalid hash');
  const output = stdout + stderr;
  assert.ok(!output.includes('    at '), 'should not dump a stack trace');
  assert.ok(
    output.toLowerCase().includes('not found') ||
    output.toLowerCase().includes('invalid') ||
    output.toLowerCase().includes('unknown'),
    `should give a clear error message but got:\n${output}`
  );
});

test('diffender history without init gives friendly message, not a crash', async (t) => {
  const projectRoot = await makeTempProject();
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  const { exitCode, stdout, stderr } = await runCli(['history'], projectRoot);
  assert.strictEqual(exitCode, 0, `should not crash: ${stderr}`);
  assert.ok(
    stdout.toLowerCase().includes('init') || stdout.toLowerCase().includes('not initialized'),
    `should suggest running init but got:\n${stdout}`
  );
  assert.ok(!stderr.includes('    at '), 'should not dump a stack trace');
});

test('diffender latest without init gives friendly message, not a crash', async (t) => {
  const projectRoot = await makeTempProject();
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  const { exitCode, stdout, stderr } = await runCli(['latest'], projectRoot);
  assert.strictEqual(exitCode, 0, `should not crash: ${stderr}`);
  assert.ok(
    stdout.toLowerCase().includes('init') || stdout.toLowerCase().includes('not initialized'),
    `should suggest running init but got:\n${stdout}`
  );
  assert.ok(!stderr.includes('    at '), 'should not dump a stack trace');
});

test('diffender reset without init gives friendly message, not a crash', async (t) => {
  const projectRoot = await makeTempProject();
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  const { exitCode, stdout, stderr } = await runCli(['reset'], projectRoot);
  assert.strictEqual(exitCode, 0, `should not crash: ${stderr}`);
  assert.ok(
    stdout.toLowerCase().includes('init') || stdout.toLowerCase().includes('not initialized'),
    `should suggest running init but got:\n${stdout}`
  );
  assert.ok(!stderr.includes('    at '), 'should not dump a stack trace');
});

test('diffender gitintegrate adds .diffender/ to real .git/info/exclude', async (t) => {
  const projectRoot = await makeTempProject();
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await fs.writeFile(path.join(projectRoot, 'file.txt'), 'initial');
  await initShadowRepo(projectRoot);

  const { execFile } = require('node:child_process');
  const { promisify } = require('node:util');
  const execFileAsync = promisify(execFile);
  await execFileAsync('git', ['init'], { cwd: projectRoot });

  const { exitCode, stdout, stderr } = await runCli(['gitintegrate'], projectRoot);
  assert.strictEqual(exitCode, 0, `gitintegrate failed: ${stderr}`);

  const excludeContent = await fs.readFile(
    path.join(projectRoot, '.git', 'info', 'exclude'),
    'utf8'
  );
  assert.ok(excludeContent.includes('.diffender/'), 'exclude should contain .diffender/');
});

test('diffender gitintegrate without real .git gives clear message', async (t) => {
  const projectRoot = await makeTempProject();
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await fs.writeFile(path.join(projectRoot, 'file.txt'), 'initial');
  await initShadowRepo(projectRoot);

  const { exitCode, stdout, stderr } = await runCli(['gitintegrate'], projectRoot);
  assert.strictEqual(exitCode, 0, `should not crash: ${stderr}`);
  assert.ok(
    stdout.toLowerCase().includes('no git') || stdout.toLowerCase().includes('not a git'),
    `should mention no git repo but got:\n${stdout}`
  );
  assert.ok(!stderr.includes('    at '), 'should not dump a stack trace');
});
