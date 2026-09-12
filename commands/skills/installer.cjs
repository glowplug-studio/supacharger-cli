const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const YAML = require('yaml');
const english = require('../../messages/en.json').PublicSkillsCli;
function message(key, values = {}) {
  const template = english[key];
  if (typeof template !== 'string' || !template.trim()) throw new Error(`Missing English CLI message: ${key}`);
  return template.replace(/\{(\w+)\}/g, (_, name) => String(values[name] ?? `{${name}}`));
}
const exec = promisify(execFile);
const REPOSITORY = 'glowplug-studio/glowplug-skills';
const URL = `https://github.com/${REPOSITORY}.git`;
const namePattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const idPattern = /^(general|supacharger|specdrive)\/[a-z0-9]+(?:-[a-z0-9]+)*$/;
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const plain = value => typeof value === 'string' && value.trim() && value.length <= 1024 && !/[\x00-\x1f\x7f]/.test(value);
async function git(cwd, args) {
  return (await exec('git', args, { cwd, encoding: 'buffer', maxBuffer: 12 * 1024 * 1024, timeout: 60000, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } })).stdout;
}
function validateRef(ref) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._/-]*$/.test(ref) || ref.includes('..') || ref.endsWith('/') || ref.includes('//')) throw new Error(message('UseAGitBranchTagOr'));
}
function parseCatalogue(bytes) {
  const catalogue = JSON.parse(bytes.toString());
  if (catalogue.version !== 1 || !Array.isArray(catalogue.skills) || catalogue.skills.length > 200) throw new Error(message('UnsupportedSkillsCatalogue'));
  const names = new Set();
  for (const skill of catalogue.skills) {
    if (!idPattern.test(skill.id) || skill.name !== skill.id.split('/')[1] || skill.name.length > 64 || !plain(skill.description) || names.has(skill.name)) throw new Error(message('InvalidOrDuplicateSkillCatalogueEntry'));
    names.add(skill.name);
  }
  return catalogue.skills;
}
async function openSource({ source, ref = 'main' } = {}) {
  validateRef(ref);
  let temporary;
  let root = source && path.resolve(source);
  try {
    if (!root) {
      temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'supacharger-skills-'));
      root = path.join(temporary, 'source');
      await git(temporary, ['clone', '--no-checkout', '--depth', '1', '--', URL, root]);
      await git(root, ['fetch', '--depth', '1', 'origin', ref]);
    }
    const commit = (await git(root, ['rev-parse', '--verify', `${source ? ref : 'FETCH_HEAD'}^{commit}`])).toString().trim();
    if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error(message('SkillsSourceDidNotResolveTo'));
    const skills = parseCatalogue(await git(root, ['show', `${commit}:catalogue.json`]));
    return { root, commit, skills, close: async () => { if (temporary) await fs.rm(temporary, { recursive: true, force: true }); } };
  } catch (error) {
    if (temporary) await fs.rm(temporary, { recursive: true, force: true });
    throw new Error(message('CannotReadPublicSkillsCatalogueValue', { value0: error.message }));
  }
}
function safeFile(name) {
  return typeof name === 'string' && name.length > 0 && !name.includes('\\') && !/[\x00-\x1f\x7f]/.test(name) && !path.posix.isAbsolute(name) && name.split('/').every(p => p && p !== '.' && p !== '..' && p !== '.git');
}
async function skillFiles(source, skill) {
  const entries = (await git(source.root, ['ls-tree', '-rz', source.commit, '--', `${skill.id}/`])).toString().split('\0').filter(Boolean);
  if (!entries.length || entries.length > 300) throw new Error(message('InvalidFileCountForValue', { value0: skill.id }));
  const files = Object.create(null);
  let size = 0;
  const foldedNames = new Set();
  for (const line of entries) {
    const match = /^(\d+) blob ([a-f0-9]{40})\t(.+)$/.exec(line);
    if (!match || !['100644', '100755'].includes(match[1])) throw new Error(message('LinksAndSubmodulesAreNotAllowed', { value0: skill.id }));
    const relative = match[3].slice(skill.id.length + 1);
    if (!match[3].startsWith(`${skill.id}/`) || !safeFile(relative)) throw new Error(message('UnsafeSkillFilePath'));
    const folded = relative.normalize('NFC').toLowerCase();
    if (foldedNames.has(folded)) throw new Error(message('CaseCollidingSkillFilePaths'));
    foldedNames.add(folded);
    const bytes = await git(source.root, ['cat-file', 'blob', match[2]]);
    size += bytes.length;
    if (size > 10 * 1024 * 1024) throw new Error(message('SkillValueExceedsMib', { value0: skill.id }));
    files[relative] = { bytes, mode: match[1] === '100755' ? 0o755 : 0o644 };
  }
  const text = files['SKILL.md']?.bytes.toString();
  const frontmatter = text && /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
  if (!frontmatter) throw new Error(message('MissingSkillMdFrontmatterInValue', { value0: skill.id }));
  const doc = YAML.parseDocument(frontmatter[1]);
  if (doc.errors.length) throw new Error(message('InvalidSkillMdYamlInValue', { value0: skill.id }));
  const metadata = doc.toJS({ maxAliasCount: 0 });
  if (metadata?.name !== skill.name || !plain(metadata.description)) throw new Error(message('InvalidSkillMdMetadataInValue', { value0: skill.id }));
  return files;
}
async function stat(file) { try { return await fs.lstat(file); } catch (error) { if (error.code === 'ENOENT') return null; throw error; } }
async function assertDirectories(root, segments) {
  let dir = root;
  for (const part of segments) {
    dir = path.join(dir, part);
    const info = await stat(dir);
    if (info && (!info.isDirectory() || info.isSymbolicLink())) throw new Error(message('RefusingNonDirectoryOrSymbolicLink', { value0: dir }));
  }
}
function parseLock(text) {
  if (!text) return { version: 1, skills: {} };
  const lock = JSON.parse(text);
  if (lock.version !== 1 || !lock.skills || typeof lock.skills !== 'object' || Array.isArray(lock.skills)) throw new Error(message('InvalidSkillsLock'));
  for (const [name, record] of Object.entries(lock.skills)) {
    if (!namePattern.test(name) || !idPattern.test(record.id) || record.id.split('/')[1] !== name || record.repository !== REPOSITORY || !/^[a-f0-9]{40}$/.test(record.commit) || !record.files || typeof record.files !== 'object' || Array.isArray(record.files) || !record.files['SKILL.md']) throw new Error(message('InvalidSkillsLockEntry'));
    for (const [file, hash] of Object.entries(record.files)) if (!safeFile(file) || !/^[a-f0-9]{64}$/.test(hash)) throw new Error(message('InvalidSkillsLockFileHash'));
  }
  return lock;
}
async function inspectProject(root) {
  root = await fs.realpath(path.resolve(root));
  await assertDirectories(root, ['.supacharger']);
  await assertDirectories(root, ['.agents', 'skills']);
  const lockPath = path.join(root, '.supacharger/skills-lock.json');
  const info = await stat(lockPath);
  if (info && (!info.isFile() || info.isSymbolicLink())) throw new Error(message('RefusingNonFileSkillsLock'));
  return { root, lockPath, lock: parseLock(info ? await fs.readFile(lockPath, 'utf8') : null) };
}
async function installedHashes(directory) {
  const hashes = Object.create(null);
  async function walk(dir, prefix = '') {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const relative = `${prefix}${entry.name}`;
      if (!safeFile(relative) || entry.isSymbolicLink()) throw new Error(message('InstalledSkillContainsAnUnsafePath'));
      if (entry.isDirectory()) await walk(path.join(dir, entry.name), `${relative}/`);
      else if (entry.isFile()) hashes[relative] = digest(await fs.readFile(path.join(dir, entry.name)));
      else throw new Error(message('InstalledSkillContainsASpecialFile'));
    }
  }
  await walk(directory);
  return hashes;
}
function equalHashes(a, b) { const keys = Object.keys(a); return keys.length === Object.keys(b).length && keys.every(key => a[key] === b[key]); }
async function installSelection(source, ids, { root = process.cwd(), update = false } = {}) {
  if (!ids.length) return [];
  const selected = [...new Set(ids)].map(id => {
    const skill = source.skills.find(item => item.id === id);
    if (!skill) throw new Error(message('UnknownPublicSkillValue', { value0: id }));
    return skill;
  });
  const project = await inspectProject(root);
  await fs.mkdir(path.join(project.root, '.supacharger'), { recursive: true });
  const guardPath = path.join(project.root, '.supacharger/skills-install.lock');
  let guard;
  try { guard = await fs.open(guardPath, 'wx'); } catch (error) { if (error.code === 'EEXIST') throw new Error(message('AnotherSkillsInstallationIsActiveInspect')); throw error; }
  let transaction;
  let preserveRecovery = false;
  const applied = [];
  try {
    // Re-read after acquiring the installer lock.
    const { lock, lockPath } = await inspectProject(project.root);
    const plans = [];
    for (const skill of selected) {
      const destination = path.join(project.root, '.agents/skills', skill.name);
      const info = await stat(destination);
      const previous = lock.skills[skill.name];
      if (info) {
        if (!info.isDirectory() || info.isSymbolicLink()) throw new Error(message('RefusingUnsafeSkillDestinationValue', { value0: skill.name }));
        if (!previous || previous.id !== skill.id) throw new Error(message('ExistingSkillValueIsNotTracked', { value0: skill.name, value1: skill.id }));
        if (!equalHashes(await installedHashes(destination), previous.files)) throw new Error(message('LocalChangesInValueInstallationRefused', { value0: skill.name }));
        if (!update && previous.commit !== source.commit) throw new Error(message('ValueIsInstalledUseSkillsUpdate', { value0: skill.name, value1: skill.id }));
        if (previous.commit === source.commit) continue;
      } else if (update) throw new Error(message('ValueIsNotInstalledUseSkills', { value0: skill.name, value1: skill.id }));
      const files = await skillFiles(source, skill);
      plans.push({ skill, destination, files, existed: Boolean(info) });
    }
    if (!plans.length) return [];
    await fs.mkdir(path.join(project.root, '.agents/skills'), { recursive: true });
    transaction = await fs.mkdtemp(path.join(project.root, '.supacharger/skills-transaction-'));
    for (const [index, plan] of plans.entries()) {
      plan.staged = path.join(transaction, `${index}-new`);
      plan.backup = path.join(transaction, `${index}-old`);
      const hashes = Object.create(null);
      for (const [file, { bytes, mode }] of Object.entries(plan.files)) {
        const target = path.join(plan.staged, file);
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.writeFile(target, bytes, { mode, flag: 'wx' });
        hashes[file] = digest(bytes);
      }
      lock.skills[plan.skill.name] = { id: plan.skill.id, repository: REPOSITORY, commit: source.commit, files: hashes };
    }
    const stagedLock = path.join(transaction, 'skills-lock.json');
    await fs.writeFile(stagedLock, `${JSON.stringify(lock, null, 2)}\n`);
    for (const plan of plans) {
      if (plan.existed) await fs.rename(plan.destination, plan.backup);
      applied.push(plan);
      await fs.rename(plan.staged, plan.destination);
    }
    await fs.rename(stagedLock, lockPath);
    return plans.map(plan => plan.skill.id);
  } catch (error) {
    for (const plan of applied.reverse()) {
      try {
        await fs.rm(plan.destination, { recursive: true, force: true });
        if (plan.existed) await fs.rename(plan.backup, plan.destination);
      } catch (rollback) { preserveRecovery = true; error.message += message('RecoveryRetained', { directory: transaction, reason: rollback.message }); }
    }
    throw error;
  } finally {
    if (transaction && !preserveRecovery) await fs.rm(transaction, { recursive: true, force: true });
    await guard.close();
    await fs.rm(guardPath, { force: true });
  }
}
async function runSkills(ids = [], options = {}) {
  if (!ids.length && (!process.stdin.isTTY || !process.stdout.isTTY)) throw new Error(message('PassSkillIdentifiersInANon'));
  const source = await openSource(options);
  try {
    const project = await inspectProject(options.root || process.cwd());
    if (!ids.length) {
      const { default: checkbox, Separator } = await import('@inquirer/checkbox');
      const choices = [];
      for (const category of ['general', 'supacharger', 'specdrive']) {
        const skills = source.skills.filter(skill => skill.id.startsWith(`${category}/`));
        if (!skills.length) continue;
        choices.push(new Separator(category));
        for (const skill of skills) {
          const exists = Boolean(await stat(path.join(project.root, '.agents/skills', skill.name)));
          const record = project.lock.skills[skill.name];
          const status = exists ? (record ? message('InstalledStatus') : message('UntrackedStatus')) : message('MissingStatus');
          choices.push({ name: `${skill.name} (${status})`, value: skill.id, description: skill.description, disabled: options.update ? (!exists || !record ? message('InstallFirst') : false) : (exists ? message('UseUpdate') : false) });
        }
      }
      ids = await checkbox({ message: options.update ? message('UpdatePrompt') : message('InstallPrompt'), choices, required: false });
    }
    const installed = await installSelection(source, ids, options);
    console.log(installed.length ? message(options.update ? 'UpdatedResult' : 'InstalledResult', { ids: installed.join(', '), commit: source.commit }) : message('NoChanges'));
    return installed;
  } catch (error) {
    if (error.name === 'ExitPromptError') { console.log(message('Cancelled')); return []; }
    throw error;
  } finally { await source.close(); }
}
module.exports = { message, REPOSITORY, openSource, parseCatalogue, skillFiles, inspectProject, installSelection, runSkills };
