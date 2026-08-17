const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');

const {
  initShadowRepo,
  getHistory,
  commitCurrentState,
  getWorkingDiff,
  resetShadowRepo,
} = require('../src/core/git-engine');
const { loadConfig } = require('../src/core/config');
const { createSessionHandler } = require('../src/core/session-handler');
const opencodeProvider = require('../src/providers/opencode');

async function makeTempProject(prefix = 'diffender-oc-test-') {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

function mockOpenDiff() {
  const calls = [];
  const openDiff = async () => {
    calls.push(true);
  };
  return { calls, openDiff };
}

function makeHandler(projectRoot, opts = {}) {
  const { calls, openDiff } = mockOpenDiff();
  const handler = createSessionHandler({
    getMessages: opts.getMessages || (async () => []),
    getWorkingDiff: () => getWorkingDiff(projectRoot),
    loadConfig: () => loadConfig(projectRoot),
    openDiff,
    commitSnapshot: (message) => commitCurrentState(projectRoot, message),
    reset: () => resetShadowRepo(projectRoot),
  });
  return { handler, calls };
}

test('session.idle handler commits with prompt text as message', async (t) => {
  const projectRoot = await makeTempProject();
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await fs.writeFile(path.join(projectRoot, 'file.txt'), 'initial');
  await initShadowRepo(projectRoot);
  await fs.writeFile(path.join(projectRoot, 'file.txt'), 'changed');

  const { handler } = makeHandler(projectRoot, {
    getMessages: async () => [{ role: 'user', content: 'Fix the login bug' }],
  });

  await handler.onIdle(
    { type: 'session.idle', properties: { session: { id: 's1' } } }
  );

  const history = await getHistory(projectRoot);
  assert.strictEqual(history.length, 2);
  assert.strictEqual(history[0].message, 'Fix the login bug');
});

test('session.idle handler falls back to timestamp when prompt text is unavailable', async (t) => {
  const projectRoot = await makeTempProject();
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await fs.writeFile(path.join(projectRoot, 'file.txt'), 'initial');
  await initShadowRepo(projectRoot);
  await fs.writeFile(path.join(projectRoot, 'file.txt'), 'changed');

  const { handler } = makeHandler(projectRoot, {
    getMessages: async () => [],
  });

  await handler.onIdle(
    { type: 'session.idle', properties: { session: { id: 's1' } } }
  );

  const history = await getHistory(projectRoot);
  assert.strictEqual(history.length, 2);
  assert.match(
    history[0].message,
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/,
    'fallback message should be an ISO timestamp'
  );
});

test('session.idle handler respects open_diff_auto=false', async (t) => {
  const projectRoot = await makeTempProject();
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await fs.writeFile(path.join(projectRoot, 'file.txt'), 'initial');
  await initShadowRepo(projectRoot);
  await fs.writeFile(path.join(projectRoot, 'file.txt'), 'changed');

  await fs.writeFile(
    path.join(projectRoot, '.diffender', 'config.json'),
    JSON.stringify({ open_diff_auto: false })
  );

  const { handler, calls } = makeHandler(projectRoot, {
    getMessages: async () => [{ role: 'user', content: 'test prompt' }],
  });

  await handler.onIdle(
    { type: 'session.idle', properties: { session: { id: 's1' } } }
  );

  assert.strictEqual(calls.length, 0, 'openDiff should NOT be called when open_diff_auto=false');

  const history = await getHistory(projectRoot);
  assert.strictEqual(history.length, 2, 'commit should still happen');
});

test('session.idle handler with open_diff_auto=true calls the diff opener', async (t) => {
  const projectRoot = await makeTempProject();
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await fs.writeFile(path.join(projectRoot, 'file.txt'), 'initial');
  await initShadowRepo(projectRoot);
  await fs.writeFile(path.join(projectRoot, 'file.txt'), 'changed');

  const { handler, calls } = makeHandler(projectRoot, {
    getMessages: async () => [{ role: 'user', content: 'test prompt' }],
  });

  await handler.onIdle(
    { type: 'session.idle', properties: { session: { id: 's1' } } }
  );

  assert.strictEqual(calls.length, 1, 'openDiff should be called when open_diff_auto=true');

  const history = await getHistory(projectRoot);
  assert.strictEqual(history.length, 2, 'commit should also happen');
});

test('session.updated handler triggers reset on absent→present revert transition', async (t) => {
  const projectRoot = await makeTempProject();
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await fs.writeFile(path.join(projectRoot, 'file.txt'), 'v1');
  await initShadowRepo(projectRoot);
  await fs.writeFile(path.join(projectRoot, 'file.txt'), 'v2');
  await commitCurrentState(projectRoot, 'first prompt');

  const historyBefore = await getHistory(projectRoot);
  assert.strictEqual(historyBefore.length, 2);

  const { handler } = makeHandler(projectRoot);

  await handler.onSessionUpdated(
    { type: 'session.updated', properties: { session: { id: 's1' } } }
  );

  await handler.onSessionUpdated(
    { type: 'session.updated', properties: { session: { id: 's1', revert: true } } }
  );

  const historyAfter = await getHistory(projectRoot);
  assert.strictEqual(historyAfter.length, 1, 'should be reset to single baseline commit');
  assert.strictEqual(historyAfter[0].message, 'diffender: baseline');
});

test('session.updated handler triggers reset on present→absent revert transition (redo)', async (t) => {
  const projectRoot = await makeTempProject();
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await fs.writeFile(path.join(projectRoot, 'file.txt'), 'v1');
  await initShadowRepo(projectRoot);
  await fs.writeFile(path.join(projectRoot, 'file.txt'), 'v2');
  await commitCurrentState(projectRoot, 'first prompt');

  const { handler } = makeHandler(projectRoot);

  await handler.onSessionUpdated(
    { type: 'session.updated', properties: { session: { id: 's1', revert: true } } }
  );

  const historyAfterUndo = await getHistory(projectRoot);
  assert.strictEqual(historyAfterUndo.length, 1, 'should reset after undo');

  await handler.onSessionUpdated(
    { type: 'session.updated', properties: { session: { id: 's1' } } }
  );

  const historyAfterRedo = await getHistory(projectRoot);
  assert.strictEqual(historyAfterRedo.length, 1, 'should reset again after redo');
});

test('session.updated handler does NOT reset on unrelated field changes', async (t) => {
  const projectRoot = await makeTempProject();
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await fs.writeFile(path.join(projectRoot, 'file.txt'), 'v1');
  await initShadowRepo(projectRoot);
  await fs.writeFile(path.join(projectRoot, 'file.txt'), 'v2');
  await commitCurrentState(projectRoot, 'first prompt');

  const historyBefore = await getHistory(projectRoot);
  assert.strictEqual(historyBefore.length, 2);

  const { handler } = makeHandler(projectRoot);

  await handler.onSessionUpdated(
    { type: 'session.updated', properties: { session: { id: 's1', status: 'active' } } }
  );

  await handler.onSessionUpdated(
    { type: 'session.updated', properties: { session: { id: 's1', status: 'idle' } } }
  );

  const historyAfter = await getHistory(projectRoot);
  assert.strictEqual(historyAfter.length, 2, 'should NOT reset on unrelated field changes');
});

test('install() writes the plugin file to .opencode/plugins/, not a global directory', async (t) => {
  const projectRoot = await makeTempProject();
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await fs.mkdir(path.join(projectRoot, '.diffender'), { recursive: true });

  await opencodeProvider.install(projectRoot);

  const pluginFile = path.join(projectRoot, '.opencode', 'plugins', 'diffender.js');
  const stat = await fs.stat(pluginFile);
  assert.ok(stat.isFile(), 'plugin stub should exist at .opencode/plugins/diffender.js');

  const runtimeFile = path.join(projectRoot, '.diffender', 'opencode-plugin.js');
  const runtimeStat = await fs.stat(runtimeFile);
  assert.ok(runtimeStat.isFile(), 'runtime module should exist at .diffender/opencode-plugin.js');

  const libFiles = ['session-handler.js', 'git-engine.js', 'config.js', 'vscode.js'];
  for (const file of libFiles) {
    const libPath = path.join(projectRoot, '.diffender', 'lib', file);
    const libStat = await fs.stat(libPath);
    assert.ok(libStat.isFile(), `${file} should be copied to .diffender/lib/${file}`);
  }
});

test('detect() returns false in a project with no .opencode folder', async (t) => {
  const projectRoot = await makeTempProject();
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  const result = await opencodeProvider.detect(projectRoot);
  assert.strictEqual(result, false);
});

test('detect() returns true in a project with .opencode folder', async (t) => {
  const projectRoot = await makeTempProject();
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await fs.mkdir(path.join(projectRoot, '.opencode'), { recursive: true });

  const result = await opencodeProvider.detect(projectRoot);
  assert.strictEqual(result, true);
});

test('uninstall() removes the plugin file from .opencode/plugins/', async (t) => {
  const projectRoot = await makeTempProject();
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await fs.mkdir(path.join(projectRoot, '.diffender'), { recursive: true });
  await opencodeProvider.install(projectRoot);

  const pluginFile = path.join(projectRoot, '.opencode', 'plugins', 'diffender.js');
  await fs.stat(pluginFile);

  await opencodeProvider.uninstall(projectRoot);

  await assert.rejects(
    fs.stat(pluginFile),
    /ENOENT/,
    'plugin file should be removed after uninstall'
  );
});
