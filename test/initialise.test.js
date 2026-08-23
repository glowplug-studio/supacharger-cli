const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { testHelpers } = require('../commands/initialise');

test('rejects destructive initialisation targets outside a dedicated workspace', () => {
  const cwd = path.join(os.tmpdir(), 'workspace', 'project');
  assert.throws(() => testHelpers.assertSafeTargetDirectory(path.parse(cwd).root, cwd), /unsafe target/);
  assert.throws(() => testHelpers.assertSafeTargetDirectory(os.homedir(), cwd), /unsafe target/);
  assert.throws(
    () => testHelpers.assertSafeTargetDirectory(path.dirname(cwd), cwd),
    /parent of the current working directory/,
  );
});

test('allows the current directory and a dedicated child target', () => {
  const cwd = path.join(os.tmpdir(), 'workspace', 'project');
  assert.doesNotThrow(() => testHelpers.assertSafeTargetDirectory(cwd, cwd));
  assert.doesNotThrow(() => testHelpers.assertSafeTargetDirectory(path.join(cwd, 'starter'), cwd));
});
