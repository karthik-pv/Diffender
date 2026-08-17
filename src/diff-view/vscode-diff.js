const { execFile, spawn } = require('node:child_process');
const { promisify } = require('node:util');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');

const execFileAsync = promisify(execFile);

const {
  getFileContent,
  getCommitFileStatuses,
  getWorkingFileStatuses,
} = require('../core/git-engine');

const TEMP_DIR = path.join(os.tmpdir(), 'diffender-diff');

async function isCodeCliAvailable(options = {}) {
  const command = options.command || 'code';
  try {
    await execFileAsync(command, ['--version'], { shell: true });
    return true;
  } catch {
    return false;
  }
}

async function cleanTempDir() {
  await fs.rm(TEMP_DIR, { recursive: true, force: true });
  await fs.mkdir(TEMP_DIR, { recursive: true });
}

function sanitizePath(filePath) {
  return filePath.replace(/[/\\]/g, '_');
}

async function writeTempFile(content, prefix, filePath) {
  const tempPath = path.join(TEMP_DIR, `${prefix}_${sanitizePath(filePath)}`);
  await fs.writeFile(tempPath, content ?? '');
  return tempPath;
}

async function defaultLaunchDiff(beforeFile, afterFile) {
  spawn('code', ['--diff', beforeFile, afterFile], {
    shell: true,
    detached: true,
    stdio: 'ignore',
  }).unref();
}

async function openDiffForCommit(projectRoot, hash, options = {}) {
  const launchDiff = options.launchDiff || defaultLaunchDiff;

  if (!options.launchDiff) {
    if (!(await isCodeCliAvailable())) {
      throw new Error(
        "VS Code CLI ('code') was not found on PATH. Install it by opening VS Code's Command Palette (Ctrl+Shift+P), running 'Shell Command: Install code command in PATH', and retrying."
      );
    }
  }

  await cleanTempDir();

  const statuses = await getCommitFileStatuses(projectRoot, hash);

  for (const { status, path: filePath } of statuses) {
    let beforeContent = null;
    let afterContent = null;

    if (status === 'A') {
      afterContent = await getFileContent(projectRoot, hash, filePath);
    } else if (status === 'D') {
      beforeContent = await getFileContent(projectRoot, `${hash}^`, filePath);
    } else {
      beforeContent = await getFileContent(projectRoot, `${hash}^`, filePath);
      afterContent = await getFileContent(projectRoot, hash, filePath);
    }

    const beforeTemp = await writeTempFile(beforeContent, 'before', filePath);
    const afterTemp = await writeTempFile(afterContent, 'after', filePath);
    await launchDiff(beforeTemp, afterTemp);
  }
}

async function openDiffForWorkingChanges(projectRoot, options = {}) {
  const launchDiff = options.launchDiff || defaultLaunchDiff;

  if (!options.launchDiff) {
    if (!(await isCodeCliAvailable())) {
      throw new Error(
        "VS Code CLI ('code') was not found on PATH. Install it by opening VS Code's Command Palette (Ctrl+Shift+P), running 'Shell Command: Install code command in PATH', and retrying."
      );
    }
  }

  await cleanTempDir();

  const statuses = await getWorkingFileStatuses(projectRoot);

  for (const { status, path: filePath } of statuses) {
    let beforeContent = null;
    let afterFile;

    if (status === 'A') {
      afterFile = path.join(projectRoot, filePath);
    } else if (status === 'D') {
      beforeContent = await getFileContent(projectRoot, 'HEAD', filePath);
      afterFile = await writeTempFile(null, 'after', filePath);
    } else {
      beforeContent = await getFileContent(projectRoot, 'HEAD', filePath);
      afterFile = path.join(projectRoot, filePath);
    }

    const beforeTemp = await writeTempFile(beforeContent, 'before', filePath);
    await launchDiff(beforeTemp, afterFile);
  }
}

module.exports = {
  isCodeCliAvailable,
  openDiffForCommit,
  openDiffForWorkingChanges,
};
