// Canonical installer, shipped byte-identically in the Supacharger CLI.
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

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
        destinations.has(file.target.toLowerCase())) throw new Error('Invalid extension destination');
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
async function compare(id, options = {}) {
  if (!options.source) throw new Error('Supply --source with the downloaded extension directory');
  const root = await fs.realpath(options.root ?? process.cwd());
  const source = await fs.realpath(options.source);
  const manifest = JSON.parse(await fs.readFile(await safePath(source, 'extension.json'), 'utf8'));
  validateManifest(manifest, id);
  await ownership(root, manifest.files);
  const changes = [];
  for (const file of manifest.files) {
    const bytes = await fs.readFile(await safePath(source, file.source));
    const targetPath = await safePath(root, file.target);
    const existing = await readOptional(targetPath);
    if (file.kind === 'migration') {
      if (existing && !existing.equals(bytes)) throw new Error(`Migration history is immutable: ${file.target}`);
      const version = path.basename(file.target).slice(0, 14);
      const siblings = await fs.readdir(path.join(root, 'supabase/migrations')).catch(error => { if (error.code !== 'ENOENT') throw error; return []; });
      if (siblings.some(name => name.startsWith(`${version}_`) && name !== path.basename(file.target))) throw new Error(`Migration version collision: ${version}`);
    }
    changes.push({ target: file.target, kind: file.kind, targetPath, bytes, existing,
      write: file.kind === 'config' ? !existing : !existing || !existing.equals(bytes) });
  }
  return { root, manifest, changes };
}
async function install(id, options = {}) {
  const { root, manifest, changes } = await compare(id, options);
  const result = { id, version: manifest.version, writes: changes.filter(c => c.write).map(c => c.target), guide: `docs/extensions/${id}/INSTALL.md` };
  if (options.plan) return { ...result, plan: true };
  const completed = [];
  try {
    for (const change of changes.filter(c => c.write)) {
      await safePath(root, change.target);
      const current = await readOptional(change.targetPath);
      if (current === null ? change.existing !== null : !change.existing || !current.equals(change.existing)) throw new Error('Destination changed during installation');
      await fs.mkdir(path.dirname(change.targetPath), { recursive: true });
      const staged = `${change.targetPath}.${randomUUID()}.tmp`;
      try {
        await fs.writeFile(staged, change.bytes, { flag: 'wx' });
        await fs.rename(staged, change.targetPath);
      } finally { await fs.rm(staged, { force: true }); }
      completed.push(change);
    }
    for (const change of changes) {
      if (change.kind === 'config') continue;
      const installed = await readOptional(await safePath(root, change.target));
      if (!installed || !installed.equals(change.bytes)) throw new Error(`Installed file mismatch: ${change.target}`);
    }
  } catch (error) {
    for (const change of completed.reverse()) {
      const current = await readOptional(await safePath(root, change.target));
      if (!current || !current.equals(change.bytes)) continue;
      if (change.existing) await fs.writeFile(change.targetPath, change.existing);
      else await fs.unlink(change.targetPath);
    }
    throw error;
  }
  return result;
}
async function doctor(id, options = {}) {
  const { manifest, changes } = await compare(id, options);
  const differences = changes.filter(c => c.write).map(c => c.target);
  return { id, version: manifest.version, matchesSource: differences.length === 0, differences, configuration: 'preserved', deployment: 'not checked' };
}
module.exports = { install, doctor, compare, payloadTarget, validateManifest, safePath, readOptional, ownership };
