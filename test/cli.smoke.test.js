const { test } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const path = require('node:path');

const BIN_PATH = path.join(__dirname, '..', 'bin', 'diffender.js');

function runCli(args) {
  return new Promise((resolve, reject) => {
    const child = spawn('node', [BIN_PATH, ...args], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (data) => { stdout += data; });
    child.stderr.on('data', (data) => { stderr += data; });
    child.on('error', reject);
    child.on('close', (code) => {
      resolve({ exitCode: code, stdout, stderr });
    });
  });
}

test('diffender --help exits 0 and prints usage text', async () => {
  const { exitCode, stdout, stderr } = await runCli(['--help']);

  assert.strictEqual(exitCode, 0, `Expected exit code 0 but got ${exitCode}. stderr: ${stderr}`);
  assert.ok(stdout.includes('Usage:'), `Expected stdout to contain "Usage:" but got:\n${stdout}`);
  assert.ok(stdout.includes('diffender'), `Expected stdout to contain "diffender" but got:\n${stdout}`);
});
