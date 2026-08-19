#!/usr/bin/env node
const fs = require('node:fs/promises');
const path = require('node:path');

function readStdinJson() {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (err) {
        reject(err);
      }
    });
    process.stdin.on('error', reject);
  });
}

async function main() {
  const input = await readStdinJson();
  const projectRoot = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const sessionId = input.session_id || 'default';

  const stateDir = path.join(projectRoot, '.diffender', 'state');
  await fs.mkdir(stateDir, { recursive: true });
  await fs.writeFile(path.join(stateDir, `${sessionId}.prompt.txt`), input.prompt || '');
}

main().catch((err) => {
  console.error(err);
  process.exit(0);
});
