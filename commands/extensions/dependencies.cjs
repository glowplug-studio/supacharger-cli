const fs = require('node:fs/promises');
const { safePath, validateManifest, digest } = require('./installer.cjs');
const { readConfig } = require('./config.cjs');
async function checkDependencies(root, release, incoming) {
  const entries = release.verified ? release.entries : new Map([[incoming.manifest.name, incoming.manifest]]);
  const entry = release.verified ? release.entry : incoming.manifest;
  const checked = new Set();
  async function configFor(name, manifest, source) {
    const id = name.slice('supacharger-ext-'.length);
    const configFile = manifest.files.find(file => file.kind === 'config');
    if (!configFile) throw new Error(`Provider selection needs a config file: ${name}`);
    const target = await safePath(root, configFile.target);
    try { await fs.access(target); return readConfig(target); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (!source) throw new Error(`Missing dependency config: ${id}`);
    return readConfig(await safePath(source, configFile.source));
  }
  async function requirements(name, item, manifest, source) {
    const names = [...(item.dependencies || [])];
    if (item.provider_dependencies) {
      const config = await configFor(name, manifest, source);
      for (const rule of Object.values(item.provider_dependencies)) {
        const selected = config[rule.config_key] ?? rule.default;
        if (typeof selected !== 'string' || !Object.hasOwn(rule.providers, selected)) throw new Error(`Unsupported configured provider for ${name}`);
        names.push(...rule.providers[selected]);
      }
    }
    return names;
  }
  async function check(name, chain) {
    if (chain.includes(name)) throw new Error('Cyclic configured extension dependency');
    if (checked.has(name)) return;
    const id = name.slice('supacharger-ext-'.length);
    let receipt;
    try { receipt = JSON.parse(await fs.readFile(await safePath(root, `.supacharger/extensions/${id}.json`), 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') throw new Error(`Cannot verify required extension ${name}: install it with the CLI first`); throw error; }
    validateManifest(receipt.manifest, id);
    for (const file of receipt.manifest.files) {
      const bytes = await fs.readFile(await safePath(root, file.target)).catch(error => { if (error.code === 'ENOENT') throw new Error(`Missing dependency file: ${name}: ${file.target}`); throw error; });
      if (file.kind !== 'config' && digest(bytes) !== file.sha256) throw new Error(`Dependency needs review: ${name}: ${file.target}`);
      if (file.kind === 'config' && readConfig(await safePath(root,file.target)).enabled === false) throw new Error(`Required extension ${name} is disabled`);
    }
    const item = entries.get(name) || (!release.verified ? receipt.manifest : null);
    if (!item) throw new Error(`Unknown dependency: ${name}`);
    for (const child of await requirements(name, item, receipt.manifest)) await check(child, [...chain,name]);
    checked.add(name);
  }
  for (const name of await requirements(incoming.manifest.name, entry, incoming.manifest, incoming.source)) await check(name, [incoming.manifest.name]);
  return [...checked];
}
module.exports = { checkDependencies };
