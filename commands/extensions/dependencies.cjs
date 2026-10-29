const fs = require('node:fs/promises');
const { safePath } = require('./installer.cjs');
const { readConfig } = require('./config.cjs');
async function checkDependencies(root, release, incoming) {
  const entries = release.entries ?? new Map();
  const checked = new Set();
  async function check(name, chain = []) {
    if (!/^supacharger-ext-[a-z][a-z0-9-]{0,63}$/.test(name)) throw new Error('Invalid dependency');
    if (chain.includes(name)) throw new Error('Cyclic extension dependency');
    if (checked.has(name)) return;
    const id = name.slice(16), base = `src/app/(project)/(extensions)/(sc_extensions)/(${id})`;
    await fs.access(await safePath(root, `${base}/index.ts`));
    if (!readConfig(await safePath(root, `${base}/supacharger-ext-${id}.config.ts`)).enabled) throw new Error(`Required extension ${name} is disabled`);
    for (const child of entries.get(name)?.dependencies ?? []) await check(child, [...chain, name]);
    checked.add(name);
  }
  for (const name of incoming.manifest.dependencies ?? []) await check(name);
  for (const rule of Object.values(incoming.manifest.provider_dependencies ?? {})) {
    const file = incoming.manifest.files.find(file => file.kind === 'config');
    if (!file) throw new Error('Provider selection needs configuration');
    const installed = await safePath(root, file.target);
    const config = await fs.access(installed).then(() => readConfig(installed), async error => {
      if (error.code !== 'ENOENT') throw error;
      return readConfig(await safePath(incoming.source, file.source));
    });
    const selected = config[rule.config_key] ?? rule.default;
    if (!Object.hasOwn(rule.providers, selected)) throw new Error('Unsupported provider');
    for (const name of rule.providers[selected]) await check(name);
  }
  if (incoming.manifest.core_services?.length) {
    require(require('node:path').join(root, 'src/supacharger/extensions/services.cjs')).resolveCoreServices(root, incoming.manifest.core_services);
  }
  return [...checked];
}
module.exports = { checkDependencies };
