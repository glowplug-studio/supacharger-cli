const fs = require('node:fs/promises');
const { execFileSync } = require('node:child_process');
const { digest } = require('./installer.cjs');
const REGISTRY_REPOSITORY = 'git@github.com:glowplug-studio/supacharger-cli-extension-register.git';
const namePattern = /^supacharger-ext-[a-z][a-z0-9-]{0,63}$/;
const versionPattern = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/;
function parseRegistry(bytes) {
  const data = JSON.parse(bytes);
  if (data.schemaVersion !== 1 || !Array.isArray(data.modules)) throw new Error('Unsupported registry schema');
  const entries = new Map();
  for (const item of data.modules) {
    if (!namePattern.test(item.name) || entries.has(item.name) || !versionPattern.test(item.version) ||
        typeof item.github_repo_url !== 'string' || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(item.source_commit) ||
        item.checksum?.algorithm !== 'sha256' || item.checksum?.format !== 'sc-source-tree-v1' ||
        !/^[a-f0-9]{64}$/.test(item.checksum?.value) || !Array.isArray(item.dependencies) ||
        new Set(item.dependencies).size !== item.dependencies.length ||
        item.dependencies.some(n => !namePattern.test(n) || n === item.name)) throw new Error('Invalid registry release');
    if (item.provider_dependencies !== undefined) {
      if (!item.provider_dependencies || Array.isArray(item.provider_dependencies) || typeof item.provider_dependencies !== 'object') throw new Error('Invalid provider dependencies');
      for (const [slot, rule] of Object.entries(item.provider_dependencies)) {
        if (!/^[a-z][a-zA-Z0-9_]*$/.test(slot) || !rule || typeof rule !== 'object' ||
            !/^[a-z][a-zA-Z0-9_]*$/.test(rule.config_key) || !rule.providers || Array.isArray(rule.providers) ||
            typeof rule.providers !== 'object' || !Object.hasOwn(rule.providers, rule.default)) throw new Error('Invalid provider dependency rule');
        for (const [provider, names] of Object.entries(rule.providers)) {
          if (!/^[a-z][a-z0-9_-]*$/.test(provider) || !Array.isArray(names) || !names.length ||
              new Set(names).size !== names.length || names.some(n => !namePattern.test(n) || n === item.name)) throw new Error('Invalid provider dependency mapping');
        }
      }
    }
    entries.set(item.name, item);
  }
  const visit = (name, chain = []) => {
    if (chain.includes(name)) throw new Error('Cyclic extension dependency');
    const entry = entries.get(name);
    if (!entry) throw new Error(`Unknown dependency: ${name}`);
    for (const dependency of [...entry.dependencies, ...Object.values(entry.provider_dependencies || {}).flatMap(rule => Object.values(rule.providers).flat())]) visit(dependency, [...chain, name]);
  };
  for (const name of entries.keys()) visit(name);
  return entries;
}
function sourceInventory(source, commit) {
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(commit)) throw new Error('Exact source commit required');
  const git = args => execFileSync('git', ['-C', source, ...args], { maxBuffer: 128 * 1024 * 1024 });
  const tree = git(['ls-tree', '-rz', '--full-tree', commit]);
  const records = []; const seen = new Set();
  for (const row of tree.toString('utf8').split('\0').filter(Boolean)) {
    const tab = row.indexOf('\t'); const [mode, type, oid] = row.slice(0, tab).split(' '); const file = row.slice(tab + 1);
    if (!['100644', '100755'].includes(mode) || type !== 'blob' || file.includes('\ufffd') ||
        file.includes('\\') || file.startsWith('/') || file.split('/').some(p => !p || p === '.' || p === '..') || seen.has(file.toLowerCase())) throw new Error('Unsupported source tree entry');
    seen.add(file.toLowerCase());
    const bytes = git(['cat-file', 'blob', oid]);
    if (bytes.toString('utf8', 0, 100).startsWith('version https://git-lfs.github.com/spec/v1')) throw new Error('LFS source unsupported');
    records.push([file, mode, digest(bytes)]);
  }
  records.sort((a,b) => Buffer.compare(Buffer.from(a[0]), Buffer.from(b[0])));
  return { records, checksum: digest(Buffer.from('sc-source-tree-v1\n' + JSON.stringify(records) + '\n')) };
}
async function verifyRelease(source, bundle, registryFile) {
  if (!registryFile) return { verified: false, reason: 'Local source; registry verification not requested' };
  const entries = parseRegistry(await fs.readFile(registryFile, 'utf8'));
  const entry = entries.get(bundle.name);
  if (!entry || entry.version !== bundle.version) throw new Error('Registry version does not match bundle');
  if (JSON.stringify(entry.dependencies) !== JSON.stringify(bundle.dependencies || []) || JSON.stringify(entry.provider_dependencies || {}) !== JSON.stringify(bundle.provider_dependencies || {})) throw new Error('Registry dependencies do not match bundle');
  const inventory = sourceInventory(source, entry.source_commit);
  if (inventory.checksum !== entry.checksum.value) throw new Error('Registry source checksum mismatch');
  const { safePath } = require('./installer.cjs');
  for (const [file, mode, hash] of inventory.records) {
    const stat = await fs.stat(await safePath(source, file));
    if ((mode === '100755') !== Boolean(stat.mode & 0o111)) throw new Error(`Source mode differs from registered commit: ${file}`);
    if (digest(await fs.readFile(await safePath(source, file))) !== hash) throw new Error(`Source differs from registered commit: ${file}`);
  }
  const tracked = new Set(inventory.records.map(row => row[0]));
  if (!tracked.has('extension.json') || bundle.files.some(f => !tracked.has(f.source))) throw new Error('Payload is not in the registered source');
  return { verified: true, entry, entries, inventory: inventory.records };
}
module.exports = { REGISTRY_REPOSITORY, parseRegistry, sourceInventory, verifyRelease, versionPattern };
