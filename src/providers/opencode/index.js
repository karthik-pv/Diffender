const fs = require('node:fs/promises');
const path = require('node:path');

const name = 'opencode';

async function detect(projectRoot) {
  try {
    const stat = await fs.stat(path.join(projectRoot, '.opencode'));
    return stat.isDirectory();
  } catch {
    return false;
  }
}

async function install(projectRoot) {
  throw new Error('opencode provider install() not yet implemented (Step 8).');
}

async function uninstall(projectRoot) {
  throw new Error('opencode provider uninstall() not yet implemented (Step 8).');
}

module.exports = {
  name,
  detect,
  install,
  uninstall,
};
