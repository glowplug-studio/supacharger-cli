const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { install, doctor } = require('../commands/extensions/installer.cjs');

const hash = data => createHash('sha256').update(data).digest('hex');
async function fixture(t) {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'sc-extension-test-'));
  t.after(() => fs.rm(temp, { recursive: true, force: true }));
  const root = path.join(temp, 'app');
  const source = path.join(temp, 'bundle');
  await fs.mkdir(path.join(root, '.supacharger'), { recursive: true });
  await fs.mkdir(source);
  await fs.writeFile(path.join(root, '.supacharger/managed-files.json'), JSON.stringify({
    version: 2, managedPaths: ['src/supacharger'], mergeManagedPaths: ['package.json'], forwardOnlyMigrationPaths: ['supabase/migrations'],
  }));
  await fs.writeFile(path.join(root, '.supacharger/core-lock.json'), '{"commit":"unchanged"}');
  const manifest = { schemaVersion: 1, id: 'example', version: '1.0.0', coreOwnershipVersion: 2, files: [
    { source: 'module.ts', target: 'src/supacharger.extensions/example/module.ts', sha256: hash('export const value = 1;') },
    { source: 'INSTALL.md', target: 'docs/extensions/example/INSTALL.md', sha256: hash('Guide') },
  ] };
  await fs.writeFile(path.join(source, 'module.ts'), 'export const value = 1;');
  await fs.writeFile(path.join(source, 'INSTALL.md'), 'Guide');
  const save = () => fs.writeFile(path.join(source, 'extension.json'), JSON.stringify(manifest));
  await save();
  return { root, source, manifest, save };
}
test('plan is read-only, install is repeatable, doctor checks hashes, Core lock is untouched', async t => {
  const f = await fixture(t);
  assert.equal((await install('example', { ...f, plan: true })).writes.length, 2);
  await assert.rejects(fs.access(path.join(f.root, 'src')));
  await install('example', f);
  assert.equal((await install('example', f)).writes.length, 0);
  assert.equal((await doctor('example', f)).healthy, true);
  assert.equal(await fs.readFile(path.join(f.root, '.supacharger/core-lock.json'), 'utf8'), '{"commit":"unchanged"}');
  await fs.writeFile(path.join(f.root, f.manifest.files[0].target), 'product edit');
  assert.equal((await doctor('example', f)).healthy, false);
  await assert.rejects(install('example', f), /Locally modified/);
});
test('rejects tampering before writes', async t => {
  const f = await fixture(t);
  await fs.writeFile(path.join(f.source, 'INSTALL.md'), 'tampered');
  await assert.rejects(install('example', f), /checksum/);
  await assert.rejects(fs.access(path.join(f.root, 'src')));
});
test('rejects traversal, managed destinations, case collisions and symlinks', async t => {
  const f = await fixture(t);
  const original = f.manifest.files[0].target;
  for (const target of ['../escape', '/tmp/escape', 'src/supacharger/file.ts', 'supabase/migrations/123.sql', 'src/supacharger.extensions/example/../escape']) {
    f.manifest.files[0].target = target; await f.save();
    await assert.rejects(install('example', f));
  }
  f.manifest.files[0].target = original;
  f.manifest.files.push({ ...f.manifest.files[0], target: original.toUpperCase() }); await f.save();
  await assert.rejects(install('example', f));
  f.manifest.files.pop(); await f.save();
  await fs.symlink(f.source, path.join(f.root, 'src'));
  await assert.rejects(install('example', f), /Unsafe path/);
});
test('upgrades verified files, preserves recovery, refuses same-version changes and removals', async t => {
  const f = await fixture(t);
  await install('example', f);
  await fs.writeFile(path.join(f.source, 'module.ts'), 'export const value = 2;');
  f.manifest.files[0].sha256 = hash('export const value = 2;'); await f.save();
  await assert.rejects(install('example', f), /immutable/);
  f.manifest.version = '1.1.0'; await f.save();
  const result = await install('example', f);
  assert.equal(result.writes.length, 1);
  assert.equal(await fs.readFile(path.join(f.root, result.recovery, '0.before'), 'utf8'), 'export const value = 1;');
  f.manifest.version = '1.2.0'; f.manifest.files.shift(); await f.save();
  await assert.rejects(install('example', f), /Removed destinations/);
});
test('does not run bundle install scripts or overwrite existing project files', async t => {
  const f = await fixture(t);
  await fs.writeFile(path.join(f.source, 'install.js'), 'throw new Error("must not run")');
  const target = path.join(f.root, f.manifest.files[0].target);
  await fs.mkdir(path.dirname(target), { recursive: true }); await fs.writeFile(target, 'mine');
  await assert.rejects(install('example', f), /Existing project file/);
  assert.equal(await fs.readFile(target, 'utf8'), 'mine');
});
test('v2 installs namespaced worker and immutable forward migrations', async t => {
  const f = await fixture(t);
  f.manifest.schemaVersion = 2;
  f.manifest.files[0].target = 'supabase/functions/ext-example/index.ts';
  await fs.writeFile(path.join(f.source, 'migration.sql'), 'select 1;');
  f.manifest.files.push({ source: 'migration.sql', target: 'supabase/migrations/20260910120000_ext_example_delivery.sql', kind: 'migration', sha256: hash('select 1;') });
  await f.save();
  await install('example', f);
  assert.equal((await doctor('example', f)).healthy, true);
  f.manifest.version = '2.0.0';
  await fs.writeFile(path.join(f.source, 'migration.sql'), 'select 2;');
  f.manifest.files[2].sha256 = hash('select 2;'); await f.save();
  await assert.rejects(install('example', f), /Migration history is immutable/);
});
test('v2 rejects migration version collisions and other extension namespaces', async t => {
  const f = await fixture(t);
  f.manifest.schemaVersion = 2;
  f.manifest.files[0].target = 'supabase/functions/ext-other/index.ts'; await f.save();
  await assert.rejects(install('example', f), /Invalid extension destination/);
  f.manifest.files[0].target = 'supabase/migrations/20260910120000_ext_example_delivery.sql';
  f.manifest.files[0].kind = 'migration'; await f.save();
  await fs.mkdir(path.join(f.root, 'supabase/migrations'), { recursive: true });
  await fs.writeFile(path.join(f.root, 'supabase/migrations/20260910120000_product.sql'), 'select 1;');
  await assert.rejects(install('example', f), /Migration version collision/);
  f.manifest.files.push({ ...f.manifest.files[0], target: 'supabase/migrations/20260910120000_ext_example_another.sql' });
  await f.save();
  await assert.rejects(install('example', f), /Migration version collision/);
});
