const fs = require('node:fs/promises');
const path = require('node:path');

const name = 'opencode';

const PLUGIN_DIR = path.join('.opencode', 'plugins');
const PLUGIN_FILE_NAME = 'diffender.js';
const RUNTIME_LIB_DIR = path.join('.diffender', 'lib');

const SRC_CORE = path.join(__dirname, '..', '..', '..', 'src', 'core');

const DEPENDENCIES = [
  { src: path.join(__dirname, 'plugin.js'), dest: path.join(PLUGIN_DIR, PLUGIN_FILE_NAME) },
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
}

async function uninstall(projectRoot) {
  const pluginPath = path.join(projectRoot, PLUGIN_DIR, PLUGIN_FILE_NAME);
  await fs.rm(pluginPath, { force: true });
}

module.exports = {
  name,
  detect,
  install,
  uninstall,
};
