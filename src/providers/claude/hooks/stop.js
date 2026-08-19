#!/usr/bin/env node
const fs = require('node:fs/promises');
const path = require('node:path');

const { createSessionHandler } = require('../../.diffender/lib/session-handler');
const { getWorkingDiff, commitCurrentState } = require('../../.diffender/lib/git-engine');
const { loadConfig } = require('../../.diffender/lib/config');
const { openDiffForWorkingChanges } = require('../../.diffender/lib/vscode');

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

  const promptFile = path.join(projectRoot, '.diffender', 'state', `${sessionId}.prompt.txt`);
  let promptText = null;
  try {
    promptText = await fs.readFile(promptFile, 'utf8');
  } catch {}
  await fs.rm(promptFile, { force: true });

  const handler = createSessionHandler({
    getMessages: async () => (promptText ? [{ role: 'user', content: promptText }] : []),
    getWorkingDiff: () => getWorkingDiff(projectRoot),
    loadConfig: () => loadConfig(projectRoot),
    openDiff: () => openDiffForWorkingChanges(projectRoot),
    commitSnapshot: (message) => commitCurrentState(projectRoot, message),
    reset: async () => {},
  });

  await handler.onIdle({ properties: { session: { id: sessionId } } });
}

main().catch((err) => {
  console.error(err);
  process.exit(0);
});
