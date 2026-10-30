const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { readProjectNamespace } = require('../environment');
const execute = promisify(execFile);
const contractPath = 'src/supacharger/database-starter/contract.json';
const pendingPath = '.supacharger/database-update.json';
const copy = require('../../messages/en.json').DeclarativeDatabaseCli;
const hash = contents => crypto.createHash('sha256').update(contents).digest('hex');
const treeHash = tree => hash(JSON.stringify([...tree].sort(([a], [b]) => a.localeCompare(b)).map(([name, data]) => [name, hash(data)])));
async function read(file) {
  try { return await fs.readFile(file, 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
async function collectSchemas(root) {
  const result = new Map();
  async function walk(directory, relative = '') {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) throw new Error(copy.SymbolicLink);
      const name = path.posix.join(relative, entry.name);
      if (entry.isDirectory()) await walk(path.join(directory, entry.name), name);
      else if (name.endsWith('.sql')) result.set('supabase/schemas/' + name, await fs.readFile(path.join(directory, entry.name)));
    }
  }
  try { await walk(path.join(root, 'supabase/schemas')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  return result;
}
async function mergeText(root, current, base, incoming, filename) {
  const directory = path.join(root, 'supabase/.temp');
  await fs.mkdir(directory, { recursive: true });
  const scratch = await fs.mkdtemp(path.join(directory, 'core-schema-merge-'));
  try {
    const files = ['current', 'base', 'incoming'].map(name => path.join(scratch, name));
    await Promise.all([current, base, incoming].map((contents, index) => fs.writeFile(files[index], contents)));
    try { return (await execute('git', ['merge-file', '-p', ...files], { maxBuffer: 16 * 1024 * 1024 })).stdout; }
    catch (error) { if (Number.isInteger(error.code) && error.code > 0) throw new Error(copy.Conflict.replace('{path}', filename)); throw error; }
  } finally { await fs.rm(scratch, { recursive: true, force: true }); }
}
async function planDatabaseUpdate(root, incomingRoot, options) {
  const raw = await read(path.join(incomingRoot, contractPath));
  if (raw === null) return null;
  const contract = JSON.parse(raw);
  if (contract.version !== 1) throw new Error(copy.Unsupported);
  const baseline = options.baselineSchemaContents;
  if (!baseline?.size || !options.baselineMigrationContents) throw new Error(copy.MissingBaseline);
  await collectSchemas(root); // Reject symbolic links before reading or writing project definitions.
  const namespace = await readProjectNamespace(root);
  const { renderDeclarativeSql } = require(path.join(incomingRoot, 'src/supacharger/declarative-namespace.cjs'));
  const incoming = await collectSchemas(incomingRoot);
  const bootstrapPath = 'src/supacharger/database-starter/bootstrap.sql';
  if (options.baselineBootstrap !== undefined && options.baselineBootstrap !== null && options.baselineBootstrap !== await read(path.join(incomingRoot, bootstrapPath))) throw new Error(copy.DataUpgrade);
  for (const file of options.baselineMigrationContents.keys()) {
    if (await read(path.join(incomingRoot, file)) === null) throw new Error(copy.HistoryChanged.replace('{path}', file));
  }
  for (const name of await fs.readdir(path.join(incomingRoot, 'supabase/migrations'))) {
    if (!name.endsWith('.sql')) continue;
    const file = 'supabase/migrations/' + name;
    const sql = await fs.readFile(path.join(incomingRoot, file));
    const old = options.baselineMigrationContents.get(file);
    if (old) { if (!old.equals(sql)) throw new Error(copy.HistoryChanged.replace('{path}', file)); }
    else if (contract.schemaOnlyUpgrades?.[name] !== hash(sql)) throw new Error(copy.DataUpgrade + ' ' + file);
  }
  const configuredSchema = renderDeclarativeSql('supabase/schemas/sc_app/schema.sql', namespace);
  if (await read(path.join(root, configuredSchema)) === null) throw new Error(copy.NamespaceMismatch);
  const changes = [];
  for (const file of new Set([...baseline.keys(), ...incoming.keys()])) {
    const target = renderDeclarativeSql(file, namespace);
    const base = baseline.has(file) ? renderDeclarativeSql(baseline.get(file).toString(), namespace) : null;
    const next = incoming.has(file) ? renderDeclarativeSql(incoming.get(file).toString(), namespace) : null;
    const current = await read(path.join(root, target));
    if (base === next || current === next) continue;
    let contents;
    if (current === base) contents = next;
    else if (base === null || next === null || current === null) throw new Error(copy.Conflict.replace('{path}', target));
    else contents = await mergeText(root, current, base, next, target);
    if (contents !== current) changes.push({ path: target, previous: current, contents });
  }
  const identity = treeHash(incoming);
  const pendingRaw = await read(path.join(root, pendingPath));
  const pending = pendingRaw === null ? null : JSON.parse(pendingRaw);
  if (pending && (pending.version !== 1 || pending.target !== identity || pending.planningFailed || pending.desiredSha256 !== treeHash(await collectSchemas(root)))) throw new Error(copy.PendingMismatch);
  if (pending) for (const item of pending.migrations) {
    if (!/^supabase\/migrations\/\d+_[a-z0-9_]+\.sql$/.test(item.path) || hash(await fs.readFile(path.join(root, item.path))) !== item.sha256) throw new Error(copy.PendingMismatch);
  }
  return { changes, target: identity, pending };
}
async function applyDatabaseUpdate(root, plan) {
  for (const item of plan.changes) if (await read(path.join(root, item.path)) !== item.previous) throw new Error(copy.Conflict.replace('{path}', item.path));
  if (plan.changes.length) {
    const directory = path.join(root, 'supabase/.temp');
    await fs.mkdir(directory, { recursive: true });
    const backup = await fs.mkdtemp(path.join(directory, 'core-schema-backup-'));
    await fs.writeFile(path.join(backup, 'definitions.json'), JSON.stringify(plan.changes.map(({ path, previous }) => ({ path, previous })), null, 2) + '\n');
  }
  for (const item of plan.changes) {
    const target = path.join(root, item.path);
    if (item.contents === null) await fs.unlink(target);
    else { await fs.mkdir(path.dirname(target), { recursive: true }); await fs.writeFile(target, item.contents); }
  }
}
async function generateProjectMigration(root, plan, run) {
  if (plan.pending) return plan.pending.migrations;
  const directory = path.join(root, 'supabase/migrations');
  const before = new Set(await fs.readdir(directory));
  // Pin the project's installed binary; never download another CLI during an update.
  let failure;
  try {
    await run('npx --no-install supabase db schema declarative sync --experimental --no-apply --file supacharger_core_update --agent no', { cwd: root, maxBuffer: 32 * 1024 * 1024 });
  } catch (error) { failure = error; }
  const migrations = [];
  for (const name of await fs.readdir(directory)) if (!before.has(name) && name.endsWith('.sql')) {
    migrations.push({ path: 'supabase/migrations/' + name, sha256: hash(await fs.readFile(path.join(directory, name))) });
  }
  if (migrations.length || failure) {
    await fs.mkdir(path.join(root, '.supacharger'), { recursive: true });
    await fs.writeFile(path.join(root, pendingPath), JSON.stringify({ version: 1, target: plan.target, desiredSha256: treeHash(await collectSchemas(root)), planningFailed: Boolean(failure), migrations }, null, 2) + '\n');
  }
  if (failure) throw failure;
  return migrations;
}
async function completeDatabaseUpdate(root) { await fs.rm(path.join(root, pendingPath), { force: true }); }
module.exports = { collectSchemas, planDatabaseUpdate, applyDatabaseUpdate, generateProjectMigration, completeDatabaseUpdate };
