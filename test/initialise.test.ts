import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import initialise = require('../commands/initialise');
const { testHelpers } = initialise;

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
