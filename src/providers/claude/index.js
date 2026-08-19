const fs = require('node:fs/promises');
const path = require('node:path');

const name = 'claude-code';

const HOOKS_DIR = path.join('.claude', 'hooks');
const SETTINGS_FILE = path.join('.claude', 'settings.json');
const RUNTIME_LIB_DIR = path.join('.diffender', 'lib');

const SRC_CORE = path.join(__dirname, '..', '..', 'core');

const LIB_FILES = [
  { src: path.join(SRC_CORE, 'session-handler.js'), dest: path.join(RUNTIME_LIB_DIR, 'session-handler.js') },
  { src: path.join(SRC_CORE, 'git-engine.js'), dest: path.join(RUNTIME_LIB_DIR, 'git-engine.js') },
  { src: path.join(SRC_CORE, 'config.js'), dest: path.join(RUNTIME_LIB_DIR, 'config.js') },
  { src: path.join(SRC_CORE, 'vscode.js'), dest: path.join(RUNTIME_LIB_DIR, 'vscode.js') },
];

const HOOK_FILES = [
  { src: path.join(__dirname, 'hooks', 'user-prompt-submit.js'), dest: path.join(HOOKS_DIR, 'diffender-user-prompt-submit.js') },
  { src: path.join(__dirname, 'hooks', 'stop.js'), dest: path.join(HOOKS_DIR, 'diffender-stop.js') },
];

const USER_PROMPT_SUBMIT_COMMAND = 'node "$CLAUDE_PROJECT_DIR/.claude/hooks/diffender-user-prompt-submit.js"';
const STOP_COMMAND = 'node "$CLAUDE_PROJECT_DIR/.claude/hooks/diffender-stop.js"';

async function detect(projectRoot) {
  try {
    const stat = await fs.stat(path.join(projectRoot, '.claude'));
    return stat.isDirectory();
  } catch {
    return false;
  }
}

async function readSettings(settingsPath) {
  let raw;
  try {
    raw = await fs.readFile(settingsPath, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return {};
    throw err;
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`Could not parse ${settingsPath}: ${err.message}`);
  }
}

function hasCommand(matcherBlocks, command) {
  return matcherBlocks.some((block) => (block.hooks || []).some((h) => h.command === command));
}

function addHook(settings, eventName, command) {
  settings.hooks = settings.hooks || {};
  settings.hooks[eventName] = settings.hooks[eventName] || [];
  if (hasCommand(settings.hooks[eventName], command)) return;
  settings.hooks[eventName].push({
    matcher: '*',
    hooks: [{ type: 'command', command }],
  });
}

function removeHook(settings, eventName, command) {
  if (!settings.hooks || !settings.hooks[eventName]) return;
  settings.hooks[eventName] = settings.hooks[eventName]
    .map((block) => ({ ...block, hooks: (block.hooks || []).filter((h) => h.command !== command) }))
    .filter((block) => block.hooks.length > 0);
  if (settings.hooks[eventName].length === 0) {
    delete settings.hooks[eventName];
  }
  if (Object.keys(settings.hooks).length === 0) {
    delete settings.hooks;
  }
}

async function install(projectRoot) {
  for (const dep of [...LIB_FILES, ...HOOK_FILES]) {
    const content = await fs.readFile(dep.src, 'utf8');
    const destPath = path.join(projectRoot, dep.dest);
    await fs.mkdir(path.dirname(destPath), { recursive: true });
    await fs.writeFile(destPath, content);
  }

  const settingsPath = path.join(projectRoot, SETTINGS_FILE);
  const settings = await readSettings(settingsPath);
  addHook(settings, 'UserPromptSubmit', USER_PROMPT_SUBMIT_COMMAND);
  addHook(settings, 'Stop', STOP_COMMAND);
  await fs.mkdir(path.dirname(settingsPath), { recursive: true });
  await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2) + '\n');
}

async function uninstall(projectRoot) {
  for (const hook of HOOK_FILES) {
    await fs.rm(path.join(projectRoot, hook.dest), { force: true });
  }

  const settingsPath = path.join(projectRoot, SETTINGS_FILE);
  let settings;
  try {
    settings = await readSettings(settingsPath);
  } catch {
    return;
  }
  if (Object.keys(settings).length === 0) return;

  removeHook(settings, 'UserPromptSubmit', USER_PROMPT_SUBMIT_COMMAND);
  removeHook(settings, 'Stop', STOP_COMMAND);

  if (Object.keys(settings).length === 0) {
    await fs.rm(settingsPath, { force: true });
  } else {
    await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2) + '\n');
  }
}

module.exports = {
  name,
  detect,
  install,
  uninstall,
};
