const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const test = require('node:test');

const { CHECKOUT_PATH, installCoreDevelopment, updateCoreDevelopment } = require('../commands/coredev');

function git(cwd, ...args) {
  return execFileSync('/usr/bin/git', args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, GIT_ALLOW_PROTOCOL: 'file' },
  }).trim();
}

async function fixture(t) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'supacharger-coredev-'));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const source = path.join(base, 'source');
  const project = path.join(base, 'project');
  for (const root of [source, project]) {
    await fs.mkdir(root);
    git(root, 'init', '-b', 'main');
    git(root, 'config', 'user.name', 'CLI test');
    git(root, 'config', 'user.email', 'cli-test@example.invalid');
    git(root, 'config', 'commit.gpgsign', 'false');
  }
  await fs.writeFile(path.join(source, 'AGENTS.md'), 'first\n');
  git(source, 'add', '.');
  git(source, 'commit', '-m', 'first');
  await fs.mkdir(path.join(project, '.supacharger'));
  await fs.writeFile(path.join(project, '.supacharger/managed-files.json'), '{}\n');
  git(project, 'add', '.');
  git(project, 'commit', '-m', 'project');
  return { source, project };
}

test('Core contributor checkout is installed locally without changing the parent repository and can be updated', async (t) => {
  const { source, project } = await fixture(t);
  assert.equal(await fs.stat(path.join(project, CHECKOUT_PATH)).catch(() => null), null);
  await installCoreDevelopment({ cwd: project, repository: source, environment: { GIT_ALLOW_PROTOCOL: 'file' } });
  assert.equal(await fs.readFile(path.join(project, CHECKOUT_PATH, 'AGENTS.md'), 'utf8'), 'first\n');
  assert.equal(await fs.stat(path.join(project, '.gitmodules')).catch(() => null), null);
  assert.equal(git(project, 'status', '--porcelain'), '');
  assert.match(await fs.readFile(path.join(project, '.git/info/exclude'), 'utf8'), /core-development/);

  await fs.writeFile(path.join(source, 'AGENTS.md'), 'second\n');
  git(source, 'add', '.');
  git(source, 'commit', '-m', 'second');
  await updateCoreDevelopment({ cwd: project, repository: source, environment: { GIT_ALLOW_PROTOCOL: 'file' } });
  assert.equal(await fs.readFile(path.join(project, CHECKOUT_PATH, 'AGENTS.md'), 'utf8'), 'second\n');
});

test('Core contributor installation reuses the expected existing checkout', async (t) => {
  const { source, project } = await fixture(t);
  git(project, 'clone', source, CHECKOUT_PATH);
  const result = await installCoreDevelopment({ cwd: project, repository: source, environment: { GIT_ALLOW_PROTOCOL: 'file' } });
  assert.equal(result.action, 'existing');
  assert.equal(git(project, 'status', '--porcelain'), '');
});

test('Core contributor installation refuses an unrelated existing destination', async (t) => {
  const { source, project } = await fixture(t);
  await fs.mkdir(path.join(project, CHECKOUT_PATH), { recursive: true });
  await assert.rejects(installCoreDevelopment({ cwd: project, repository: source, environment: { GIT_ALLOW_PROTOCOL: 'file' } }), /already exists without being the expected Git checkout/);
});

test('Core contributor update refuses local checkout changes', async (t) => {
  const { source, project } = await fixture(t);
  await installCoreDevelopment({ cwd: project, repository: source, environment: { GIT_ALLOW_PROTOCOL: 'file' } });
  await fs.writeFile(path.join(project, CHECKOUT_PATH, 'AGENTS.md'), 'local\n');
  await assert.rejects(updateCoreDevelopment({ cwd: project, repository: source, environment: { GIT_ALLOW_PROTOCOL: 'file' } }), /has local changes/);
});
