// Canonical installer, shipped byte-identically in the Supacharger CLI.
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const validId = value => typeof value === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(value);
const inside = (file, parent) => file === parent || file.startsWith(`${parent}/`);
function relative(value) {
  if (typeof value !== 'string' || !value || value.includes('\\') || value.includes('\0') ||
      path.posix.isAbsolute(value) || value.split('/').some(p => !p || p === '.' || p === '..' || !/^[a-zA-Z0-9_.()-]+$/.test(p))) {
    throw new Error('Unsafe extension path');
  }
  return value;
}
async function safePath(root, file) {
  relative(file);
  let current = root;
  const parts = file.split('/');
  for (const [index, part] of parts.entries()) {
    current = path.join(current, part);
    const stat = await fs.lstat(current).catch(error => { if (error.code !== 'ENOENT') throw error; return null; });
    if (stat && (stat.isSymbolicLink() || (!stat.isDirectory() && index < parts.length - 1))) throw new Error(`Unsafe path: ${file}`);
    if (stat && index === parts.length - 1 && !stat.isFile()) throw new Error(`Not a regular file: ${file}`);
  }
  return current;
}
async function readOptional(file) {
  return fs.readFile(file).catch(error => { if (error.code !== 'ENOENT') throw error; return null; });
}
// The current bundle format maps repository payload paths to fixed project namespaces. Never execute payload code.
function payloadTarget(id, source) {
  relative(source);
  const app = `src/app/(project)/(extensions)/(sc_extensions)/(${id})/`;
  if (source.startsWith('payload/app/')) return app + source.slice('payload/app/'.length);
  if (source.startsWith('payload/supabase/shared/')) return `supabase/functions/_shared/extensions/sc_ext-${id}/` + source.slice('payload/supabase/shared/'.length);
  if (source.startsWith('payload/supabase/functions/')) {
    const rest = source.slice('payload/supabase/functions/'.length);
    const name = rest.split('/')[0];
    if (name !== `ext-${id}` && !name.startsWith(`ext-${id}-`)) throw new Error('Edge Function must use its extension namespace');
    if (!rest.includes('/')) throw new Error('Edge Function payload needs a file');
    return `supabase/functions/${rest}`;
  }
  if (source.startsWith('payload/supabase/migrations/')) return 'supabase/migrations/' + source.slice('payload/supabase/migrations/'.length);
  if (source.startsWith('payload/agents/')) return `docs/agents/extensions/supacharger-ext-${id}/` + source.slice('payload/agents/'.length);
  if (source.startsWith('payload/docs/')) return `docs/extensions/${id}/` + source.slice('payload/docs/'.length);
  throw new Error('Unsupported extension payload source');
}
function validateManifest(manifest, id) {
  if (!validId(id) || manifest.schemaVersion !== 3 || manifest.id !== id ||
      !/^\d+\.\d+\.\d+$/.test(manifest.version) || manifest.coreOwnershipVersion !== 2 ||
      !Array.isArray(manifest.files) || !manifest.files.length || manifest.files.length > 1000) throw new Error('Invalid extension manifest');
  if (manifest.name !== `supacharger-ext-${id}`) throw new Error('Registry name must match the extension ID');
  if (manifest.dependencies !== undefined && (!Array.isArray(manifest.dependencies) || new Set(manifest.dependencies).size !== manifest.dependencies.length || manifest.dependencies.some(name => !/^supacharger-ext-[a-z][a-z0-9-]{0,63}$/.test(name) || name === manifest.name))) throw new Error('Invalid extension dependencies');
  if (manifest.provider_dependencies !== undefined) {
    const rules = manifest.provider_dependencies;
    if (!rules || typeof rules !== 'object' || Array.isArray(rules)) throw new Error('Invalid provider dependencies');
    for (const [slot, rule] of Object.entries(rules)) {
      if (!/^[a-z][a-zA-Z0-9_]*$/.test(slot) || !rule || !/^[a-z][a-zA-Z0-9_]*$/.test(rule.config_key) || !rule.providers || typeof rule.providers !== 'object' || Array.isArray(rule.providers) || !Object.hasOwn(rule.providers,rule.default)) throw new Error('Invalid provider dependency rule');
      for (const [provider,names] of Object.entries(rule.providers)) if (!/^[a-z][a-z0-9_-]*$/.test(provider) || !Array.isArray(names) || !names.length || new Set(names).size !== names.length || names.some(name => !/^supacharger-ext-[a-z][a-z0-9-]{0,63}$/.test(name) || name===manifest.name)) throw new Error('Invalid provider mapping');
    }
  }
  const destinations = new Set();
  const migrationVersions = new Set();
  for (const file of manifest.files) {
    relative(file.source); relative(file.target);
    if (payloadTarget(id, file.source) !== file.target) throw new Error('Payload target does not match the source mapping');
    const allowed = [
      `src/app/(project)/(extensions)/(sc_extensions)/(${id})`,
      `supabase/functions/_shared/extensions/sc_ext-${id}`,
      `docs/extensions/${id}`, `docs/agents/extensions/supacharger-ext-${id}`, `supabase/functions/ext-${id}`,
    ];
    const functionName = file.target.split('/')[2];
    if (file.target.startsWith('supabase/functions/') && functionName?.startsWith(`ext-${id}-`)) allowed.push(`supabase/functions/${functionName}`);
    const migration = file.kind === 'migration' &&
      new RegExp(`^supabase/migrations/[0-9]{14}_ext_${id.replaceAll('-', '_')}_[a-z0-9_]+\\.sql$`).test(file.target);
    if (migration) {
      const version = path.basename(file.target).slice(0, 14);
      if (migrationVersions.has(version)) throw new Error(`Migration version collision: ${version}`);
      migrationVersions.add(version);
    }
    const config = file.source === `payload/app/supacharger-ext-${id}.config.ts`;
    if (config !== (file.kind === 'config')) throw new Error('Extension config must be marked developer-owned with kind config');
    if ((!migration && !allowed.some(prefix => file.target.startsWith(`${prefix}/`))) ||
        (file.kind !== undefined && !migration && !config) ||
        !/^[a-f0-9]{64}$/.test(file.sha256) || destinations.has(file.target.toLowerCase())) throw new Error('Invalid extension destination or digest');
    destinations.add(file.target.toLowerCase());
  }
  const guides = manifest.files.filter(file => file.source.startsWith('payload/agents/'));
  if (guides.length && (!guides.some(file => file.source === 'payload/agents/AGENTS.md') || guides.some(file => !file.source.endsWith('.md')))) throw new Error('Agent payload requires AGENTS.md and Markdown files only');
  if (!manifest.files.some(file => file.target === `docs/extensions/${id}/INSTALL.md`)) throw new Error('Extension needs an installation guide');
}
async function ownership(root, files) {
  const manifest = JSON.parse(await fs.readFile(await safePath(root, '.supacharger/managed-files.json'), 'utf8'));
  if (manifest.version !== 2) throw new Error('Requires Core ownership manifest v2');
  for (const file of files) {
    for (const field of ['managedPaths', 'mergeManagedPaths', 'forwardOnlyMigrationPaths']) {
      if (!Array.isArray(manifest[field])) throw new Error('Invalid Core ownership manifest');
      if (field === 'forwardOnlyMigrationPaths' && file.kind === 'migration') continue;
      if (manifest[field].some(prefix => inside(file.target, prefix) || inside(prefix, file.target))) throw new Error(`Protected Core path: ${file.target}`);
    }
  }
}
async function install(id, options = {}) {
  if (!options.source) throw new Error('Use --source with a reviewed local bundle. Specdrive token downloads are not implemented.');
  const root = await fs.realpath(options.root ?? process.cwd());
  const source = await fs.realpath(options.source);
  const manifestBytes = await fs.readFile(await safePath(source, 'extension.json'));
  const manifest = JSON.parse(manifestBytes);
  validateManifest(manifest, id);
  await ownership(root, manifest.files);
  const lockPath = await safePath(root, `.supacharger/extensions/${id}.json`);
  const oldBytes = await readOptional(lockPath);
  const old = oldBytes ? JSON.parse(oldBytes) : null;
  if (old) validateManifest(old.manifest, id);
  if (old && old.manifest.version === manifest.version && old.manifestSha256 !== digest(manifestBytes)) throw new Error('Published extension versions are immutable; increment the version');
  if (old && old.manifest.version.split('.').map(Number).some((v, i, a) => a.slice(0, i).every((n, j) => n === Number(manifest.version.split('.')[j])) && v > Number(manifest.version.split('.')[i]))) throw new Error('Extension downgrades require manual review');
  const prior = new Map((old?.manifest.files ?? []).map(file => [file.target, file.sha256]));
  const priorKinds = new Map((old?.manifest.files ?? []).map(file => [file.target, file.kind]));
  if ([...prior.keys()].some(target => !manifest.files.some(file => file.target === target))) throw new Error('Removed destinations require manual migration; nothing changed');
  const changes = [];
  for (const file of manifest.files) {
    const bytes = await fs.readFile(await safePath(source, file.source));
    if (digest(bytes) !== file.sha256) throw new Error(`Bundle checksum mismatch: ${file.source}`);
    const target = await safePath(root, file.target);
    const existing = await readOptional(target);
    if (file.kind === 'migration') {
      if (prior.has(file.target) && prior.get(file.target) !== file.sha256) throw new Error(`Migration history is immutable: ${file.target}`);
      const version = path.basename(file.target).slice(0, 14);
      const siblings = await fs.readdir(path.join(root, 'supabase/migrations')).catch(error => { if (error.code !== 'ENOENT') throw error; return []; });
      if (siblings.some(name => name.startsWith(`${version}_`) && name !== path.basename(file.target))) throw new Error(`Migration version collision: ${version}`);
    }
    if (prior.has(file.target) && priorKinds.get(file.target) !== file.kind) throw new Error('Changing file ownership requires manual review');
    if (file.kind === 'config') {
      changes.push({ ...file, targetPath: target, bytes, existing, write: !existing });
      continue;
    }
    if (prior.has(file.target) && (!existing || digest(existing) !== prior.get(file.target))) throw new Error(`Locally modified or missing extension file: ${file.target}`);
    if (!prior.has(file.target) && existing && digest(existing) !== file.sha256) throw new Error(`Existing project file: ${file.target}`);
    changes.push({ ...file, targetPath: target, bytes, existing, write: !existing || digest(existing) !== file.sha256 });
  }
  const result = { id, version: manifest.version, writes: changes.filter(c => c.write).map(c => c.target), guide: `docs/extensions/${id}/INSTALL.md` };
  if (options.plan) return { ...result, plan: true };
  // Stage and back up outside compilable source. An OS interruption leaves recovery material.
  const transaction = `.supacharger/extension-transactions/${id}-${randomUUID()}`;
  const stagePath = await safePath(root, `${transaction}/plan.json`);
  await fs.mkdir(path.dirname(stagePath), { recursive: true });
  await fs.writeFile(stagePath, JSON.stringify(result, null, 2), { flag: 'wx' });
  const completed = [];
  try {
    for (const [index, change] of changes.filter(c => c.write).entries()) {
      if (change.existing) await fs.writeFile(path.join(path.dirname(stagePath), `${index}.before`), change.existing, { flag: 'wx' });
      await safePath(root, change.target);
      const current = await readOptional(change.targetPath);
      if ((current && digest(current)) !== (change.existing && digest(change.existing))) throw new Error('Destination changed during installation');
      await fs.mkdir(path.dirname(change.targetPath), { recursive: true });
      const staged = path.join(path.dirname(stagePath), `${index}.next`);
      await fs.writeFile(staged, change.bytes, { flag: 'wx' });
      await fs.rename(staged, change.targetPath);
      completed.push(change);
    }
    for (const change of changes) {
      if (change.kind === 'config') continue;
      const installed = await readOptional(change.targetPath);
      if (!installed || digest(installed) !== change.sha256) throw new Error(`Installed checksum mismatch: ${change.target}`);
    }
    await safePath(root, `.supacharger/extensions/${id}.json`);
    if ((await readOptional(lockPath))?.toString() !== oldBytes?.toString()) throw new Error('Extension lock changed during installation');
    await fs.mkdir(path.dirname(lockPath), { recursive: true });
    if (oldBytes) await fs.writeFile(path.join(path.dirname(stagePath), 'lock.before'), oldBytes, { flag: 'wx' });
    const stagedLock = path.join(path.dirname(stagePath), 'lock.next');
    await fs.writeFile(stagedLock, JSON.stringify({ schemaVersion: 1, manifestSha256: digest(manifestBytes), manifest }, null, 2) + '\n', { flag: 'wx' });
    await fs.rename(stagedLock, lockPath);
  } catch (error) {
    for (const change of completed.reverse()) {
      await safePath(root, change.target);
      const current = await readOptional(change.targetPath);
      if (!current || digest(current) !== change.sha256) continue; // Preserve concurrent user edits.
      if (change.existing) await fs.writeFile(change.targetPath, change.existing);
      else await fs.unlink(change.targetPath);
    }
    throw error;
  }
  return { ...result, recovery: transaction };
}
async function doctor(id, options = {}) {
  if (!validId(id)) throw new Error('Invalid extension ID');
  const root = await fs.realpath(options.root ?? process.cwd());
  const lock = JSON.parse(await fs.readFile(await safePath(root, `.supacharger/extensions/${id}.json`), 'utf8'));
  validateManifest(lock.manifest, id);
  await ownership(root, lock.manifest.files);
  const conflicts = [];
  for (const file of lock.manifest.files) {
    const bytes = await readOptional(await safePath(root, file.target));
    if (!bytes || (file.kind !== 'config' && digest(bytes) !== file.sha256)) conflicts.push(file.target);
  }
  return { id, version: lock.manifest.version, healthy: conflicts.length === 0, conflicts, configuration: 'not checked', deployment: 'not checked' };
}
module.exports = { install, doctor, payloadTarget, validateManifest, safePath, readOptional, digest, ownership };
