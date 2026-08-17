const { execFile, spawn } = require('node:child_process');
const { promisify } = require('node:util');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

const execFileAsync = promisify(execFile);

const {
  getFileContent,
  getCommitFileStatuses,
  getWorkingFileStatuses,
  getWorkingBinaryFiles,
  getCommitBinaryFiles,
} = require('./git-engine');
const { loadConfig } = require('./config');

const TEMP_BASE = path.join(os.tmpdir(), 'diffender-diff');

async function isCodeCliAvailable(options = {}) {
  const command = options.command || 'code';
  try {
    await execFileAsync(command, ['--version'], { shell: true });
    return true;
  } catch {
    return false;
  }
}

function sanitizePath(filePath) {
  return filePath.replace(/[/\\]/g, '_');
}

async function makeTempSessionDir() {
  const dir = path.join(TEMP_BASE, crypto.randomUUID());
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

async function writeTempFile(sessionDir, content, prefix, filePath) {
  const tempPath = path.join(sessionDir, `${prefix}_${sanitizePath(filePath)}`);
  await fs.writeFile(tempPath, content ?? '');
  return tempPath;
}

async function defaultLaunchDiff(beforeFile, afterFile) {
  spawn('code', ['--diff', `"${beforeFile}"`, `"${afterFile}"`], {
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

  const sessionDir = await makeTempSessionDir();

  const statuses = await getCommitFileStatuses(projectRoot, hash);
  const binaryFiles = await getCommitBinaryFiles(projectRoot, hash);
  const config = await loadConfig(projectRoot);
  const maxDiffWindows = config.max_diff_windows || 10;
  let opened = 0;
  let skippedBinary = 0;

  for (const { status, path: filePath } of statuses) {
    if (binaryFiles.has(filePath)) {
      skippedBinary++;
      continue;
    }

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

    if (opened >= maxDiffWindows) {
      console.error(
        `warning: ${statuses.length - opened - skippedBinary} more files changed but only ${maxDiffWindows} diff tabs will be opened. Run 'diffender show <hash>' for specific files.`
      );
      break;
    }

    const beforeTemp = await writeTempFile(sessionDir, beforeContent, 'before', filePath);
    const afterTemp = await writeTempFile(sessionDir, afterContent, 'after', filePath);
    await launchDiff(beforeTemp, afterTemp);
    opened++;
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

  const sessionDir = await makeTempSessionDir();

  const statuses = await getWorkingFileStatuses(projectRoot);
  const binaryFiles = await getWorkingBinaryFiles(projectRoot);
  const config = await loadConfig(projectRoot);
  const maxDiffWindows = config.max_diff_windows || 10;
  let opened = 0;
  let skippedBinary = 0;

  for (const { status, path: filePath } of statuses) {
    if (binaryFiles.has(filePath)) {
      skippedBinary++;
      continue;
    }

    let beforeContent = null;
    let afterFile;

    if (status === 'A') {
      afterFile = path.join(projectRoot, filePath);
    } else if (status === 'D') {
      beforeContent = await getFileContent(projectRoot, 'HEAD', filePath);
      afterFile = await writeTempFile(sessionDir, null, 'after', filePath);
    } else {
      beforeContent = await getFileContent(projectRoot, 'HEAD', filePath);
      afterFile = path.join(projectRoot, filePath);
    }

    if (opened >= maxDiffWindows) {
      console.error(
        `warning: ${statuses.length - opened - skippedBinary} more files changed but only ${maxDiffWindows} diff tabs will be opened. Run 'diffender latest' for specific files.`
      );
      break;
    }

    const beforeTemp = await writeTempFile(sessionDir, beforeContent, 'before', filePath);
    await launchDiff(beforeTemp, afterFile);
    opened++;
  }
}

module.exports = {
  isCodeCliAvailable,
  openDiffForCommit,
  openDiffForWorkingChanges,
};
