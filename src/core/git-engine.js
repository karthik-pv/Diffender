const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const fs = require('node:fs/promises');
const path = require('node:path');

const execFileAsync = promisify(execFile);

const SHADOW_GIT_DIR = path.join('.diffender', 'git');
const DEFAULT_EXCLUDES = ['.diffender/', '.opencode/', '.claude/', '.swarm/', 'node_modules/', '.git/'];
const BASELINE_MESSAGE = 'diffender: baseline';

function gitDirPath(projectRoot) {
  return path.join(projectRoot, SHADOW_GIT_DIR);
}

function toGitPath(p) {
  return p.replace(/\\/g, '/');
}

async function git(projectRoot, args) {
  const gitDir = toGitPath(gitDirPath(projectRoot));
  const workTree = toGitPath(projectRoot);
  const fullArgs = [
    `--git-dir=${gitDir}`,
    `--work-tree=${workTree}`,
    ...args,
  ];
  const { stdout } = await execFileAsync('git', fullArgs, {
    maxBuffer: 50 * 1024 * 1024,
  });
  return stdout;
}

async function isShadowRepoInitialized(projectRoot) {
  try {
    const stat = await fs.stat(gitDirPath(projectRoot));
    return stat.isDirectory();
  } catch {
    return false;
  }
}

async function initShadowRepo(projectRoot) {
  await fs.mkdir(path.dirname(gitDirPath(projectRoot)), { recursive: true });
  await git(projectRoot, ['init']);

  const excludePath = path.join(gitDirPath(projectRoot), 'info', 'exclude');
  await fs.writeFile(excludePath, DEFAULT_EXCLUDES.join('\n') + '\n');

  await git(projectRoot, ['add', '-A']);
  await git(projectRoot, ['commit', '--allow-empty', '-m', BASELINE_MESSAGE]);
}

async function getHistory(projectRoot) {
  let stdout;
  try {
    stdout = await git(projectRoot, [
      'log',
      '-z',
      '--pretty=format:%H%x1f%B%x1f%ci',
    ]);
  } catch {
    return [];
  }
  if (!stdout) {
    return [];
  }
  return stdout
    .split('\x00')
    .filter((entry) => entry.length > 0)
    .map((entry) => {
      const [hash, message, date] = entry.split('\x1f');
      return { hash, message: message.replace(/\n$/, ''), date };
    });
}

async function hasStagedChanges(projectRoot) {
  const stdout = await git(projectRoot, ['diff', '--cached', '--name-only']);
  return stdout.trim().length > 0;
}

async function commitCurrentState(projectRoot, message) {
  await git(projectRoot, ['add', '-A']);
  if (!(await hasStagedChanges(projectRoot))) {
    return false;
  }
  await git(projectRoot, ['commit', '-m', message]);
  return true;
}

async function getWorkingDiff(projectRoot) {
  await git(projectRoot, ['add', '-A']);
  const diff = await git(projectRoot, ['diff', '--cached', 'HEAD']);
  const filesRaw = await git(projectRoot, ['diff', '--cached', 'HEAD', '--name-only']);
  const files = filesRaw.split('\n').filter(Boolean);
  return { diff, files };
}

async function getCommitDiff(projectRoot, hash) {
  const diff = await git(projectRoot, ['show', hash]);
  const filesRaw = await git(projectRoot, [
    'diff-tree', '--no-commit-id', '--name-only', '-r', '--root', hash,
  ]);
  const files = filesRaw.split('\n').filter(Boolean);
  return { diff, files };
}

async function resetShadowRepo(projectRoot) {
  await fs.rm(gitDirPath(projectRoot), { recursive: true, force: true });
  await initShadowRepo(projectRoot);
}

async function getFileContent(projectRoot, ref, filePath) {
  try {
    return await git(projectRoot, ['show', `${ref}:${filePath}`]);
  } catch {
    return null;
  }
}

function parseNameStatus(stdout) {
  return stdout
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [status, file] = line.split('\t');
      return { status, path: file };
    });
}

async function getCommitFileStatuses(projectRoot, hash) {
  const stdout = await git(projectRoot, [
    'diff-tree', '--no-commit-id', '--name-status', '-r', '--root', hash,
  ]);
  return parseNameStatus(stdout);
}

async function getWorkingFileStatuses(projectRoot) {
  await git(projectRoot, ['add', '-A']);
  const stdout = await git(projectRoot, ['diff', '--cached', 'HEAD', '--name-status']);
  return parseNameStatus(stdout);
}

function parseBinaryFilesFromNumstat(stdout) {
  const binary = new Set();
  for (const line of stdout.split('\n')) {
    if (!line.trim()) continue;
    const parts = line.split('\t');
    if (parts.length >= 3 && parts[0] === '-' && parts[1] === '-') {
      binary.add(parts.slice(2).join('\t'));
    }
  }
  return binary;
}

async function getWorkingBinaryFiles(projectRoot) {
  await git(projectRoot, ['add', '-A']);
  const stdout = await git(projectRoot, ['diff', '--cached', '--numstat', 'HEAD']);
  return parseBinaryFilesFromNumstat(stdout);
}

async function getCommitBinaryFiles(projectRoot, hash) {
  const stdout = await git(projectRoot, [
    'diff-tree', '--numstat', '--no-commit-id', '-r', '--root', hash,
  ]);
  return parseBinaryFilesFromNumstat(stdout);
}

module.exports = {
  initShadowRepo,
  isShadowRepoInitialized,
  getHistory,
  commitCurrentState,
  getWorkingDiff,
  getCommitDiff,
  resetShadowRepo,
  getFileContent,
  getCommitFileStatuses,
  getWorkingFileStatuses,
  getWorkingBinaryFiles,
  getCommitBinaryFiles,
};
