const fs = require('node:fs/promises');
const path = require('node:path');

const CONFIG_DIR = path.join('.diffender');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

function configPath(projectRoot) {
  return path.join(projectRoot, CONFIG_FILE);
}

function defaultConfig() {
  return { open_diff_auto: true, max_diff_windows: 10, print_diff_to_terminal: true };
}

async function createDefaultConfig(projectRoot) {
  const filePath = configPath(projectRoot);
  try {
    await fs.readFile(filePath, 'utf8');
    return;
  } catch {
    await fs.mkdir(path.join(projectRoot, CONFIG_DIR), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(defaultConfig(), null, 2) + '\n');
  }
}

async function loadConfig(projectRoot) {
  const filePath = configPath(projectRoot);
  let raw;
  try {
    raw = await fs.readFile(filePath, 'utf8');
  } catch {
    await createDefaultConfig(projectRoot);
    return defaultConfig();
  }
  try {
    const parsed = JSON.parse(raw);
    return { ...defaultConfig(), ...parsed };
  } catch {
    await fs.writeFile(filePath, JSON.stringify(defaultConfig(), null, 2) + '\n');
    return defaultConfig();
  }
}

async function updateConfig(projectRoot, partial) {
  const current = await loadConfig(projectRoot);
  const updated = { ...current, ...partial };
  await fs.writeFile(configPath(projectRoot), JSON.stringify(updated, null, 2) + '\n');
  return updated;
}

module.exports = {
  createDefaultConfig,
  loadConfig,
  updateConfig,
};
