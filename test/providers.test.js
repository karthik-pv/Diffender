const { test } = require('node:test');
const assert = require('node:assert');

const { getProvider, listProviders, validateProvider } = require('../src/providers/registry');

test('registry resolves --opencode flag to the opencode provider module', () => {
  const provider = getProvider('opencode');
  assert.ok(provider, 'should return a provider module');
  assert.strictEqual(provider.name, 'opencode');
});

test('registry throws a clear, listable error for an unknown provider flag', () => {
  assert.throws(
    () => getProvider('cursor'),
    (err) => {
      assert.ok(err.message.includes('cursor'), 'error should mention the unknown flag');
      assert.ok(
        err.message.includes('opencode'),
        'error should list available providers'
      );
      return true;
    }
  );
});

test('contract test: opencode provider implements all 4 required functions', () => {
  const provider = getProvider('opencode');
  const required = ['name', 'detect', 'install', 'uninstall'];

  for (const member of required) {
    assert.ok(
      provider[member] !== undefined && provider[member] !== null,
      `provider should implement '${member}'`
    );
  }

  assert.strictEqual(typeof provider.name, 'string');
  assert.strictEqual(typeof provider.detect, 'function');
  assert.strictEqual(typeof provider.install, 'function');
  assert.strictEqual(typeof provider.uninstall, 'function');
});

test('listProviders returns available provider names', () => {
  const names = listProviders();
  assert.ok(Array.isArray(names));
  assert.ok(names.includes('opencode'));
});

test('validateProvider returns true for a valid provider', () => {
  assert.strictEqual(validateProvider('opencode'), true);
});

test('validateProvider returns false for an unknown provider', () => {
  assert.strictEqual(validateProvider('cursor'), false);
});
