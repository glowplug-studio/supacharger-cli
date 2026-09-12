const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const test = require('node:test');

const { SUBMODULE_PATH, installCoreDevelopment, updateCoreDevelopment } = require('../commands/coredev');

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

test('Core contributor submodule is installed only by the explicit command and can be updated', async (t) => {
  const { source, project } = await fixture(t);
  assert.equal(await fs.stat(path.join(project, SUBMODULE_PATH)).catch(() => null), null);
  await installCoreDevelopment({ cwd: project, repository: source, environment: { GIT_ALLOW_PROTOCOL: 'file' } });
  assert.equal(await fs.readFile(path.join(project, SUBMODULE_PATH, 'AGENTS.md'), 'utf8'), 'first\n');
  assert.match(await fs.readFile(path.join(project, '.gitmodules'), 'utf8'), /core-development/);
  git(project, 'add', '.gitmodules', SUBMODULE_PATH);
  git(project, 'commit', '-m', 'add contributor instructions');

  await fs.writeFile(path.join(source, 'AGENTS.md'), 'second\n');
  git(source, 'add', '.');
  git(source, 'commit', '-m', 'second');
  await updateCoreDevelopment({ cwd: project, repository: source, environment: { GIT_ALLOW_PROTOCOL: 'file' } });
  assert.equal(await fs.readFile(path.join(project, SUBMODULE_PATH, 'AGENTS.md'), 'utf8'), 'second\n');
});

test('Core contributor installation refuses an unregistered existing destination', async (t) => {
  const { source, project } = await fixture(t);
  await fs.mkdir(path.join(project, SUBMODULE_PATH), { recursive: true });
  await assert.rejects(installCoreDevelopment({ cwd: project, repository: source, environment: { GIT_ALLOW_PROTOCOL: 'file' } }), /already exists without its expected Git submodule registration/);
});

test('Core contributor update refuses local submodule changes', async (t) => {
  const { source, project } = await fixture(t);
  await installCoreDevelopment({ cwd: project, repository: source, environment: { GIT_ALLOW_PROTOCOL: 'file' } });
  await fs.writeFile(path.join(project, SUBMODULE_PATH, 'AGENTS.md'), 'local\n');
  await assert.rejects(updateCoreDevelopment({ cwd: project, repository: source, environment: { GIT_ALLOW_PROTOCOL: 'file' } }), /has local changes/);
});
