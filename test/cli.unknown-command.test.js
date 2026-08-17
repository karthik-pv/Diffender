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

test('diffender with unknown command exits non-zero with helpful error', async () => {
  const { exitCode, stdout, stderr } = await runCli(['bogus']);

  assert.notStrictEqual(exitCode, 0, 'Expected non-zero exit code for unknown command');

  const output = stdout + stderr;
  assert.ok(
    output.includes('bogus'),
    `Expected error output to mention the unknown command 'bogus' but got:\n${output}`
  );
  assert.ok(
    !output.includes('    at '),
    `Expected no stack trace in output but got:\n${output}`
  );
});
