const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');

const {
  createDefaultConfig,
  loadConfig,
  updateConfig,
} = require('../src/config/config');

async function makeTempProject(prefix = 'diffender-config-test-') {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

function configPath(projectRoot) {
  return path.join(projectRoot, '.diffender', 'config.json');
}

test('createDefaultConfig writes open_diff_auto=true when absent', async (t) => {
  const projectRoot = await makeTempProject();
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await createDefaultConfig(projectRoot);

  const raw = await fs.readFile(configPath(projectRoot), 'utf8');
  const parsed = JSON.parse(raw);
  assert.strictEqual(parsed.open_diff_auto, true);
});

test('createDefaultConfig does not overwrite an existing config', async (t) => {
  const projectRoot = await makeTempProject();
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await fs.mkdir(path.join(projectRoot, '.diffender'), { recursive: true });
  await fs.writeFile(
    configPath(projectRoot),
    JSON.stringify({ open_diff_auto: false })
  );

  await createDefaultConfig(projectRoot);

  const parsed = await loadConfig(projectRoot);
  assert.strictEqual(parsed.open_diff_auto, false, 'existing value should be preserved');
});

test('loadConfig returns existing values without overwriting them', async (t) => {
  const projectRoot = await makeTempProject();
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await fs.mkdir(path.join(projectRoot, '.diffender'), { recursive: true });
  await fs.writeFile(
    configPath(projectRoot),
    JSON.stringify({ open_diff_auto: false })
  );

  const config = await loadConfig(projectRoot);
  assert.strictEqual(config.open_diff_auto, false);

  const raw = await fs.readFile(configPath(projectRoot), 'utf8');
  assert.strictEqual(JSON.parse(raw).open_diff_auto, false, 'file should be unchanged on disk');
});

test('loadConfig recovers gracefully from malformed JSON', async (t) => {
  const projectRoot = await makeTempProject();
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await fs.mkdir(path.join(projectRoot, '.diffender'), { recursive: true });
  await fs.writeFile(configPath(projectRoot), '{not json');

  const config = await loadConfig(projectRoot);
  assert.strictEqual(config.open_diff_auto, true, 'should return sane defaults');

  const raw = await fs.readFile(configPath(projectRoot), 'utf8');
  assert.strictEqual(
    JSON.parse(raw).open_diff_auto,
    true,
    'malformed file should be regenerated with defaults'
  );
});

test('loadConfig returns defaults when config file is absent', async (t) => {
  const projectRoot = await makeTempProject();
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  const config = await loadConfig(projectRoot);
  assert.strictEqual(config.open_diff_auto, true);
});

test('updateConfig merges partial values into existing config', async (t) => {
  const projectRoot = await makeTempProject();
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await createDefaultConfig(projectRoot);
  await updateConfig(projectRoot, { open_diff_auto: false });

  const parsed = await loadConfig(projectRoot);
  assert.strictEqual(parsed.open_diff_auto, false);
});
