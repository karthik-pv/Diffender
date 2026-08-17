const fs = require('node:fs/promises');
const path = require('node:path');

const EXCLUDE_LINE = '.diffender/';

async function gitintegrate(projectRoot) {
  const gitDir = path.join(projectRoot, '.git');
  let stat;
  try {
    stat = await fs.stat(gitDir);
  } catch {
    return {
      applied: false,
      message: 'No git repository detected here. Skipping git integration.',
    };
  }

  if (!stat.isDirectory()) {
    return {
      applied: false,
      message: 'No git repository detected here. Skipping git integration.',
    };
  }

  const excludeFile = path.join(gitDir, 'info', 'exclude');
  let content = '';
  try {
    content = await fs.readFile(excludeFile, 'utf8');
  } catch {
    await fs.mkdir(path.dirname(excludeFile), { recursive: true });
  }

  if (content.split('\n').includes(EXCLUDE_LINE)) {
    return {
      applied: true,
      message: 'Git integration already in place. .diffender/ is already excluded.',
    };
  }

  const newContent = content.endsWith('\n') || content.length === 0
    ? content + EXCLUDE_LINE + '\n'
    : content + '\n' + EXCLUDE_LINE + '\n';
  await fs.writeFile(excludeFile, newContent);

  return {
    applied: true,
    message: 'Added .diffender/ to .git/info/exclude.',
  };
}

module.exports = {
  gitintegrate,
};
