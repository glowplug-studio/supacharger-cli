const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { openSource, installSelection, parseCatalogue } = require('../commands/skills/installer.cjs');
const git = (root, ...args) => execFileSync('git', args, { cwd: root, stdio: 'pipe' }).toString().trim();
async function fixture(t) {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'public-skills-test-'));
  t.after(() => fs.rm(temp, { recursive: true, force: true }));
  const source = path.join(temp, 'source'); const root = path.join(temp, 'app');
  await fs.mkdir(source); await fs.mkdir(root);
  git(source, 'init', '-b', 'main'); git(source, 'config', 'user.email', 'test@example.invalid'); git(source, 'config', 'user.name', 'Test');
  await fs.mkdir(path.join(source, 'general/changelog/references'), { recursive: true });
  await fs.writeFile(path.join(source, 'catalogue.json'), JSON.stringify({ version: 1, skills: [{ id: 'general/changelog', name: 'changelog', description: 'Curate useful release notes.' }] }));
  await fs.writeFile(path.join(source, 'general/changelog/SKILL.md'), '---\nname: changelog\ndescription: Curate useful release notes.\n---\n# Changelog\n');
  await fs.writeFile(path.join(source, 'general/changelog/references/example.md'), 'Original reference\n');
  const commit = () => { git(source, 'add', '-A'); git(source, 'commit', '-m', 'Fixture'); return git(source, 'rev-parse', 'HEAD'); };
  commit();
  return { source, root, commit, skill: path.join(root, '.agents/skills/changelog') };
}
async function install(f, options) {
  const source = await openSource({ source: f.source });
  try { return await installSelection(source, ['general/changelog'], { root: f.root, ...options }); } finally { await source.close(); }
}
test('installs committed files with provenance, leaves uncommitted edits behind, and repeats harmlessly', async t => {
  const f = await fixture(t);
  await fs.appendFile(path.join(f.source, 'general/changelog/SKILL.md'), 'Uncommitted\n');
  assert.deepEqual(await install(f), ['general/changelog']);
  assert.doesNotMatch(await fs.readFile(path.join(f.skill, 'SKILL.md'), 'utf8'), /Uncommitted/);
  const lock = JSON.parse(await fs.readFile(path.join(f.root, '.supacharger/skills-lock.json')));
  assert.equal(lock.skills.changelog.commit, git(f.source, 'rev-parse', 'HEAD'));
  assert.match(lock.skills.changelog.files['SKILL.md'], /^[a-f0-9]{64}$/);
  assert.equal(await fs.readFile(path.join(f.skill, 'references/example.md'), 'utf8'), 'Original reference\n');
  assert.deepEqual(await install(f), []);
});
test('updates require an explicit operation and remove obsolete upstream files', async t => {
  const f = await fixture(t); await install(f);
  await fs.rm(path.join(f.source, 'general/changelog/references/example.md'));
  await fs.appendFile(path.join(f.source, 'general/changelog/SKILL.md'), 'New guidance\n'); f.commit();
  await assert.rejects(install(f), /Use skills update/);
  await install(f, { update: true });
  await assert.rejects(fs.access(path.join(f.skill, 'references/example.md')));
  assert.match(await fs.readFile(path.join(f.skill, 'SKILL.md'), 'utf8'), /New guidance/);
});
test('refuses tracked local edits without changing the lock or skill', async t => {
  const f = await fixture(t); await install(f);
  const lock = await fs.readFile(path.join(f.root, '.supacharger/skills-lock.json'), 'utf8');
  await fs.appendFile(path.join(f.skill, 'SKILL.md'), 'Local instruction\n');
  await assert.rejects(install(f, { update: true }), /Local changes/);
  assert.equal(await fs.readFile(path.join(f.root, '.supacharger/skills-lock.json'), 'utf8'), lock);
  assert.match(await fs.readFile(path.join(f.skill, 'SKILL.md'), 'utf8'), /Local instruction/);
});
test('refuses untracked destination collisions', async t => {
  const f = await fixture(t); await fs.mkdir(f.skill, { recursive: true });
  await fs.writeFile(path.join(f.skill, 'mine.md'), 'Preserve');
  await assert.rejects(install(f), /not tracked/);
  assert.equal(await fs.readFile(path.join(f.skill, 'mine.md'), 'utf8'), 'Preserve');
});
test('refuses symlinks in downloaded skills before writing destinations', async t => {
  const f = await fixture(t);
  await fs.symlink('/etc/passwd', path.join(f.source, 'general/changelog/linked')); f.commit();
  await assert.rejects(install(f), /Links and submodules/);
  await assert.rejects(fs.access(f.skill));
});
test('refuses symlinked destination parents', async t => {
  const f = await fixture(t);
  await fs.symlink(f.source, path.join(f.root, '.agents'));
  await assert.rejects(install(f), /symbolic link/);
});
test('refuses unsafe catalogue identifiers and duplicate destination names', () => {
  assert.throws(() => parseCatalogue(Buffer.from(JSON.stringify({ version: 1, skills: [{ id: 'general/../../outside', name: 'outside', description: 'Bad' }] }))), /Invalid/);
  assert.throws(() => parseCatalogue(Buffer.from(JSON.stringify({ version: 1, skills: ['general', 'supacharger'].map(category => ({ id: `${category}/same`, name: 'same', description: 'Duplicate' })) }))), /duplicate/);
});
test('invalid metadata and unknown selections cannot partially install a batch', async t => {
  const f = await fixture(t);
  const source = await openSource({ source: f.source });
  await assert.rejects(installSelection(source, ['general/changelog', 'general/unknown'], { root: f.root }), /Unknown/);
  await source.close(); await assert.rejects(fs.access(f.skill));
  await fs.writeFile(path.join(f.source, 'general/changelog/SKILL.md'), '---\nname: wrong\ndescription: Bad\n---\n'); f.commit();
  await assert.rejects(install(f), /metadata/);
  await assert.rejects(fs.access(f.skill));
});
test('installer lock prevents concurrent installation', async t => {
  const f = await fixture(t);
  await fs.mkdir(path.join(f.root, '.supacharger'));
  await fs.writeFile(path.join(f.root, '.supacharger/skills-install.lock'), 'busy');
  await assert.rejects(install(f), /Another skills installation/);
  assert.equal(await fs.readFile(path.join(f.root, '.supacharger/skills-install.lock'), 'utf8'), 'busy');
});
test('update does not install an absent skill', async t => {
  const f = await fixture(t);
  await assert.rejects(install(f, { update: true }), /not installed/);
});

test('a failed lock commit rolls back installed files and preserves the previous lock', async t => {
  const f = await fixture(t); await install(f);
  const before = await fs.readFile(path.join(f.root, '.supacharger/skills-lock.json'), 'utf8');
  const skillBefore = await fs.readFile(path.join(f.skill, 'SKILL.md'), 'utf8');
  await fs.appendFile(path.join(f.source, 'general/changelog/SKILL.md'), 'Updated\n'); f.commit();
  const original = fs.rename;
  fs.rename = async (from, to) => {
    if (path.basename(to) === 'skills-lock.json') throw new Error('Simulated lock write failure');
    return original(from, to);
  };
  try { await assert.rejects(install(f, { update: true }), /Simulated/); } finally { fs.rename = original; }
  assert.equal(await fs.readFile(path.join(f.skill, 'SKILL.md'), 'utf8'), skillBefore);
  assert.equal(await fs.readFile(path.join(f.root, '.supacharger/skills-lock.json'), 'utf8'), before);
});
