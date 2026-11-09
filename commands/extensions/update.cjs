const { install, doctor, safePath } = require('./installer.cjs');
const { verifyRelease, withDownloadedRelease } = require('./registry.cjs');
const { checkDependencies } = require('./dependencies.cjs');
const fs = require('node:fs/promises');
function normaliseId(name) { return name.startsWith('supacharger-ext-') ? name.slice(16) : name; }
async function runExtension(action, name, options = {}) {
  if (!['install', 'update', 'doctor'].includes(action)) throw new Error('Invalid extension action');
  const id = normaliseId(name), root = await fs.realpath(options.root || process.cwd());
  async function apply(source, manifest, release) {
    if (action !== 'doctor') await checkDependencies(root, release, { source, manifest });
    const result = await (action === 'doctor' ? doctor : install)(id, { ...options, root, source });
    return { ...result, registryRegistered: release.registered ?? release.verified, registryVerified: release.verified };
  }
  if (!options.source) return withDownloadedRelease(`supacharger-ext-${id}`, options.registry, apply);
  const source = await fs.realpath(options.source);
  const manifest = JSON.parse(await fs.readFile(await safePath(source, 'extension.json'), 'utf8'));
  const { validateManifest } = require('./installer.cjs');
  validateManifest(manifest, id);
  const release = await verifyRelease(source, manifest, options.registry);
  return apply(source, manifest, release);
}
async function reportExtensionDoctor(name, options = {}) {
  const result = await runExtension('doctor', name, options);
  const copy = require('../../messages/en.json').ExtensionsCli;
  console.log((result.matchesSource ? copy.DoctorMatched : copy.DoctorDifferences).replace('{name}', name));
  for (const file of result.differences) console.log(`  ${file}`);
  console.log(copy.DoctorScope);
  if (!result.matchesSource) process.exitCode = 1;
  return result;
}
module.exports = { runExtension, normaliseId, reportExtensionDoctor };
