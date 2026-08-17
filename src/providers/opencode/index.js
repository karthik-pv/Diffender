const fs = require('node:fs/promises');
const path = require('node:path');

const name = 'opencode';

const PLUGIN_DIR = path.join('.opencode', 'plugins');
const PLUGIN_STUB_NAME = 'diffender.js';
const RUNTIME_DIR = path.join('.diffender');
const RUNTIME_MODULE = path.join(RUNTIME_DIR, 'opencode-plugin.js');
const RUNTIME_LIB_DIR = path.join(RUNTIME_DIR, 'lib');

const PLUGIN_STUB = `module.exports = require("../../.diffender/opencode-plugin.js");
`;

const SRC_CORE = path.join(__dirname, '..', '..', '..', 'src', 'core');

const DEPENDENCIES = [
  { src: path.join(__dirname, 'plugin.js'), dest: RUNTIME_MODULE },
  { src: path.join(SRC_CORE, 'session-handler.js'), dest: path.join(RUNTIME_LIB_DIR, 'session-handler.js') },
  { src: path.join(SRC_CORE, 'git-engine.js'), dest: path.join(RUNTIME_LIB_DIR, 'git-engine.js') },
  { src: path.join(SRC_CORE, 'config.js'), dest: path.join(RUNTIME_LIB_DIR, 'config.js') },
  { src: path.join(SRC_CORE, 'vscode.js'), dest: path.join(RUNTIME_LIB_DIR, 'vscode.js') },
];

async function detect(projectRoot) {
  try {
    const stat = await fs.stat(path.join(projectRoot, '.opencode'));
    return stat.isDirectory();
  } catch {
    return false;
  }
}

async function install(projectRoot) {
  for (const dep of DEPENDENCIES) {
    const content = await fs.readFile(dep.src, 'utf8');
    const destPath = path.join(projectRoot, dep.dest);
    await fs.mkdir(path.dirname(destPath), { recursive: true });
    await fs.writeFile(destPath, content);
  }

  const stubDir = path.join(projectRoot, PLUGIN_DIR);
  await fs.mkdir(stubDir, { recursive: true });
  await fs.writeFile(path.join(stubDir, PLUGIN_STUB_NAME), PLUGIN_STUB);
}

async function uninstall(projectRoot) {
  const stubPath = path.join(projectRoot, PLUGIN_DIR, PLUGIN_STUB_NAME);
  await fs.rm(stubPath, { force: true });
}

module.exports = {
  name,
  detect,
  install,
  uninstall,
};
