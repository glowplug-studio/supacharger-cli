const fs = require('node:fs/promises');
const { install, validateManifest, safePath, readOptional, digest, ownership } = require('./installer.cjs');
const { verifyRelease, versionPattern } = require('./registry.cjs');
const { checkDependencies } = require('./dependencies.cjs');
const { retainReview } = require('./review.cjs');
function normaliseId(name) { return name.startsWith('supacharger-ext-') ? name.slice(16) : name; }
async function bundleAt(source, id) {
  if (!source) throw new Error('Versioned downloads are coming soon; supply a local --source directory');
  source = await fs.realpath(source);
  const bytes = await fs.readFile(await safePath(source, 'extension.json'));
  const manifest = JSON.parse(bytes); validateManifest(manifest, id);
  if (!versionPattern.test(manifest.version)) throw new Error('Invalid release version');
  const files = [];
  for (const file of manifest.files) {
    const content = await fs.readFile(await safePath(source, file.source));
    if (digest(content) !== file.sha256) throw new Error(`Bundle checksum mismatch: ${file.source}`);
    files.push({ ...file, bytes: content });
  }
  return { source, bytes, manifest, files };
}
async function runExtension(action, name, options = {}) {
  const id = normaliseId(name); const root = await fs.realpath(options.root || process.cwd());
  const incoming = await bundleAt(options.source, id);
  const release = await verifyRelease(incoming.source, incoming.manifest, options.registry);
  if (release.verified) {
    const hashes = new Map(release.inventory.map(([file, , hash]) => [file, hash]));
    for (const [file, bytes] of [['extension.json', incoming.bytes], ...incoming.files.map(f => [f.source, f.bytes])]) {
      if (digest(bytes) !== hashes.get(file)) throw new Error('Validated snapshot differs from the registered release');
    }
  }
  await checkDependencies(root, release, incoming);
  await ownership(root, incoming.manifest.files);
  const receiptBytes = await readOptional(await safePath(root, `.supacharger/extensions/${id}.json`));
  if (action === 'update' && !receiptBytes) throw new Error('Extension is not installed; use install');
  if (receiptBytes) {
    if (!options.baselineSource) throw new Error('Supply --baseline-source for the original installed release; fetching releases is coming soon');
    const receipt = JSON.parse(receiptBytes);
    const original = await bundleAt(options.baselineSource, id);
    if (digest(original.bytes) !== receipt.manifestSha256 || JSON.stringify(original.manifest) !== JSON.stringify(receipt.manifest)) throw new Error('Original source does not match installed release record');
    if (options.baselineRegistry) await verifyRelease(original.source, original.manifest, options.baselineRegistry);
    const a = original.manifest.version.split('.').map(BigInt), b = incoming.manifest.version.split('.').map(BigInt);
    for (let i=0; i<3; i++) { if (b[i] < a[i]) throw new Error('Downgrades require manual review'); if (b[i] > a[i]) break; }
    if (original.manifest.version === incoming.manifest.version && digest(original.bytes) !== digest(incoming.bytes)) throw new Error('Published versions are immutable');
    const differences = [];
    for (const file of original.files) {
      if (file.kind === 'config') continue;
      const installed = await readOptional(await safePath(root, file.target));
      if (!installed || !installed.equals(file.bytes)) differences.push(file.target);
    }
    if (differences.length) {
      if (options.plan) return { reviewRequired: true, differences, writes: [] };
      if (!options.askReview) throw new Error('Local changes need review. Run interactively to choose whether to prepare an agent prompt');
      if (!await options.askReview()) return { reviewRequired: true, declined: true, writes: [] };
      return { reviewRequired: true, prompt: await retainReview(root, original, incoming, differences), writes: [] };
    }
  }
  // Install the validated snapshot, not a source directory that could change after verification.
  const path = require('node:path');
  const stage = await fs.mkdtemp(path.join(require('node:os').tmpdir(), 'sc-extension-verified-'));
  try {
    for (const [file, bytes] of [['extension.json', incoming.bytes], ...incoming.files.map(f => [f.source, f.bytes])]) {
      const target = await safePath(stage, file); await fs.mkdir(path.dirname(target), { recursive: true }); await fs.writeFile(target, bytes);
    }
    const result = await install(id, { ...options, root, source: stage });
    return { ...result, registryVerified: release.verified };
  } finally { await fs.rm(stage, { recursive: true, force: true }); }
}
module.exports = { runExtension, bundleAt, normaliseId };
