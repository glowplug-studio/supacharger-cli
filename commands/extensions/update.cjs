const { install, safePath } = require('./installer.cjs');
const { verifyRelease } = require('./registry.cjs');
const { checkDependencies } = require('./dependencies.cjs');
const fs = require('node:fs/promises');
function normaliseId(name) { return name.startsWith('supacharger-ext-') ? name.slice(16) : name; }
async function runExtension(action, name, options = {}) {
  if (!['install', 'update'].includes(action)) throw new Error('Invalid extension action');
  if (!options.source) throw new Error('Supply --source with the downloaded extension directory');
  const id = normaliseId(name), root = await fs.realpath(options.root || process.cwd());
  const source = await fs.realpath(options.source);
  const manifest = JSON.parse(await fs.readFile(await safePath(source, 'extension.json'), 'utf8'));
  const { validateManifest } = require('./installer.cjs');
  validateManifest(manifest, id);
  const release = await verifyRelease(source, manifest, options.registry);
  await checkDependencies(root, release, { source, manifest });
  const result = await install(id, { ...options, root, source });
  return { ...result, registryRegistered: release.registered ?? release.verified, registryVerified: release.verified };
}
module.exports = { runExtension, normaliseId };
