const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { execFileSync } = require('node:child_process');

const doctor = require('../commands/doctor');
const { compareManagedFiles, configProperties, inspect, missingConfigProperties } = doctor.testHelpers;

async function temporaryDirectory(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'supacharger-doctor-test-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}

async function writeManagedFixture(root, files) {
  await fs.mkdir(path.join(root, '.supacharger'), { recursive: true });
  await fs.writeFile(path.join(root, '.supacharger', 'managed-files.json'), JSON.stringify({
    version: 2,
    managedPaths: ['.supacharger/managed-files.json', 'src/supacharger'],
    mergeManagedPaths: [],
    forwardOnlyMigrationPaths: ['supabase/migrations'],
    developerOwnedPaths: ['src/supacharger.config.ts'],
  }));
  for (const [relativePath, contents] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(root, relativePath)), { recursive: true });
    await fs.writeFile(path.join(root, relativePath), contents);
  }
}

test('reports local drift separately from incoming Core changes using file contents', async (t) => {
  const project = await temporaryDirectory(t);
  const baseline = await temporaryDirectory(t);
  const latest = await temporaryDirectory(t);
  await writeManagedFixture(baseline, {
    'src/supacharger/changed.ts': 'baseline\n',
    'src/supacharger/removed.ts': 'remove me\n',
  });
  await writeManagedFixture(latest, {
    'src/supacharger/changed.ts': 'latest\n',
    'src/supacharger/added.ts': 'new\n',
  });
  await writeManagedFixture(project, {
    'src/supacharger/changed.ts': 'project edit\n',
    'src/supacharger/removed.ts': 'remove me\n',
  });

  const result = await compareManagedFiles(project, baseline, latest);
  assert.deepEqual(result.localDrift, [{ path: 'src/supacharger/changed.ts', status: 'MODIFIED' }]);
  assert.deepEqual(result.incomingChanges, [
    { path: 'src/supacharger/added.ts', status: 'ADD' },
    { path: 'src/supacharger/changed.ts', status: 'UPDATE' },
    { path: 'src/supacharger/removed.ts', status: 'REMOVE' },
  ]);
});

test('finds configuration properties without requiring stored hashes', async (t) => {
  const project = await temporaryDirectory(t);
  const latest = await temporaryDirectory(t);
  await fs.mkdir(path.join(project, 'src'), { recursive: true });
  await fs.mkdir(path.join(latest, 'src'), { recursive: true });
  await fs.writeFile(path.join(project, 'src', 'supacharger.config.ts'), 'export const SC_CONFIG = { AUTH: { ENABLED: true } };\n');
  await fs.writeFile(path.join(latest, 'src', 'supacharger.config.ts'), 'export const SC_CONFIG = { AUTH: { ENABLED: true, MODE: \'otp\' }, BILLING: false };\n');

  assert.deepEqual([...configProperties('const value = { FIRST: true, nested: false };')], ['FIRST', 'nested']);
  assert.deepEqual(await missingConfigProperties(project, latest), ['BILLING', 'MODE']);
});

test('doctor compares a project with installed and incoming Git revisions', async (t) => {
  const root = await temporaryDirectory(t);
  const source = path.join(root, 'source');
  const project = path.join(root, 'project');
  await fs.mkdir(source);
  const git = (...args) => execFileSync('git', args, { cwd: source, encoding: 'utf8' }).trim();
  git('init', '-b', 'main');
  git('config', 'user.name', 'CLI test');
  git('config', 'user.email', 'cli-test@example.invalid');
  git('config', 'commit.gpgsign', 'false');
  await writeManagedFixture(source, {
    'src/supacharger/core.ts': 'baseline\n',
    'src/supacharger.config.ts': 'export const SC_CONFIG = { AUTH: true };\n',
  });
  git('add', '.');
  git('commit', '-m', 'baseline');
  const baselineCommit = git('rev-parse', 'HEAD');
  await fs.cp(source, project, { recursive: true, filter: (entry) => !entry.split(path.sep).includes('.git') });
  await fs.writeFile(path.join(project, '.supacharger', 'core-lock.json'), JSON.stringify({
    repository: 'glowplug-studio/supacharger',
    commit: baselineCommit,
  }));
  await fs.writeFile(path.join(project, 'src/supacharger/core.ts'), 'local edit\n');
  await fs.writeFile(path.join(source, 'src/supacharger/core.ts'), 'incoming\n');
  await fs.writeFile(path.join(source, 'src/supacharger.config.ts'), 'export const SC_CONFIG = { AUTH: true, BILLING: true };\n');
  git('add', '.');
  git('commit', '-m', 'incoming');

  const result = await inspect(project, { source });
  assert.deepEqual(result.localDrift, [{ path: 'src/supacharger/core.ts', status: 'MODIFIED' }]);
  assert.ok(result.incomingChanges.some((entry) => entry.path === 'src/supacharger/core.ts' && entry.status === 'UPDATE'));
  assert.deepEqual(result.missingConfig, ['BILLING']);
  assert.equal(result.targetCommit, git('rev-parse', 'HEAD'));
});
