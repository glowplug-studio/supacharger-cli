const fs = require('node:fs/promises');
const path = require('node:path');
const { execFileSync } = require('node:child_process');


const REGISTRY_MANIFEST_URL = 'https://raw.githubusercontent.com/glowplug-studio/supacharger-cli-extension-register/refs/heads/main/manifest.json';
const namePattern = /^supacharger-ext-[a-z][a-z0-9-]{0,63}$/;
const versionPattern = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/;
const commitPattern = /^[a-f0-9]{40}$/;
const registryPathPattern = /^(?:core|extensions)\/[a-z0-9][a-z0-9./-]*\.json$/;

function validRegistryPath(registryPath) {
  return typeof registryPath === 'string' &&
    registryPathPattern.test(registryPath) &&
    registryPath.split('/').every(part => part && part !== '.' && part !== '..');
}

function parseRegistryManifest(bytes) {
  const data = JSON.parse(bytes);
  if (
    data.schemaVersion !== 2 ||
    !data.core ||
    data.core.name !== 'supacharger' ||
    !validRegistryPath(data.core.path) ||
    !Array.isArray(data.extensions)
  ) throw new Error('Unsupported registry schema');

  const names = new Set();
  const paths = new Set([data.core.path]);
  for (const item of data.extensions) {
    if (
      !item ||
      !namePattern.test(item.name) ||
      names.has(item.name) ||
      !validRegistryPath(item.path) ||
      paths.has(item.path)
    ) throw new Error('Invalid registry extension entry');
    names.add(item.name);
    paths.add(item.path);
  }
  return data;
}

function validateDescriptorIdentity(descriptor, expectedName) {
  if (
    !descriptor ||
    descriptor.schemaVersion !== 2 ||
    descriptor.name !== expectedName ||
    typeof descriptor.github_repo_url !== 'string' ||
    !/^(?:https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\.git)?|git@github\.com:[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\.git)$/.test(descriptor.github_repo_url) ||
    !Array.isArray(descriptor.dependencies) ||
    new Set(descriptor.dependencies).size !== descriptor.dependencies.length
  ) throw new Error(`Invalid registry descriptor: ${expectedName}`);

  if (expectedName !== 'supacharger' && descriptor.dependencies.some(name => !namePattern.test(name) || name === expectedName)) {
    throw new Error(`Invalid registry dependencies: ${expectedName}`);
  }
  if (descriptor.provider_dependencies !== undefined) {
    if (!descriptor.provider_dependencies || Array.isArray(descriptor.provider_dependencies) || typeof descriptor.provider_dependencies !== 'object') {
      throw new Error(`Invalid registry provider dependencies: ${expectedName}`);
    }
    for (const [slot, rule] of Object.entries(descriptor.provider_dependencies)) {
      if (!/^[a-z][a-zA-Z0-9_]*$/.test(slot) || !rule || typeof rule !== 'object' ||
          !/^[a-z][a-zA-Z0-9_]*$/.test(rule.config_key) || !rule.providers || Array.isArray(rule.providers) ||
          typeof rule.providers !== 'object' || !Object.hasOwn(rule.providers, rule.default)) {
        throw new Error(`Invalid registry provider dependency rule: ${expectedName}`);
      }
      for (const [provider, names] of Object.entries(rule.providers)) {
        if (!/^[a-z][a-z0-9_-]*$/.test(provider) || !Array.isArray(names) || !names.length ||
            new Set(names).size !== names.length || names.some(name => !namePattern.test(name) || name === expectedName)) {
          throw new Error(`Invalid registry provider dependency mapping: ${expectedName}`);
        }
      }
    }
  }
  return descriptor;
}

function validateCoreDescriptor(descriptor) {
  validateDescriptorIdentity(descriptor, 'supacharger');
  if (
    typeof descriptor.version !== 'string' || !descriptor.version ||
    !commitPattern.test(descriptor.source_commit) ||
    descriptor.archive_checksum?.algorithm !== 'sha256' ||
    descriptor.archive_checksum?.format !== 'zip' ||
    !/^[a-f0-9]{64}$/.test(descriptor.archive_checksum?.value) ||
    typeof descriptor.download_url !== 'string' ||
    !/^https:\/\/github\.com\//.test(descriptor.download_url)
  ) throw new Error('Core registry descriptor is incomplete');
  return descriptor;
}

async function readLocation(location, options = {}) {
  if (/^https:\/\//.test(location)) {
    const fetchImplementation = options.fetch ?? globalThis.fetch;
    if (typeof fetchImplementation !== 'function') throw new Error('This Node.js version cannot fetch the Supacharger registry');
    const attempts = options.attempts ?? 3;
    let response;
    let lastError;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        response = await fetchImplementation(location, { signal: AbortSignal.timeout(options.timeout ?? 30_000) });
        if (response.ok) break;
        if (![408, 429, 500, 502, 503, 504].includes(response.status) || attempt === attempts) {
          throw new Error(`HTTP ${response.status}`);
        }
        lastError = new Error(`HTTP ${response.status}`);
      } catch (error) {
        lastError = error;
        if (attempt === attempts || /^HTTP 4\d\d$/.test(error.message)) break;
      }
      await new Promise(resolve => setTimeout(resolve, attempt * 250));
    }
    if (!response?.ok) {
      const cause = lastError?.cause;
      const detail = [lastError?.message, cause?.code, cause?.message]
        .filter(Boolean)
        .filter((value, index, values) => values.indexOf(value) === index)
        .join(': ');
      throw new Error(`Registry request failed for ${location}${detail ? `: ${detail}` : ''}`);
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > (options.maxBytes ?? 1024 * 1024)) throw new Error(`Registry response is too large: ${location}`);
    return bytes;
  }
  return fs.readFile(path.resolve(location));
}

function resolveRegistryLocation(manifestLocation, relativePath) {
  if (/^https:\/\//.test(manifestLocation)) return new URL(relativePath, manifestLocation).toString();
  return path.resolve(path.dirname(path.resolve(manifestLocation)), relativePath);
}

async function loadRegistryManifest(location = REGISTRY_MANIFEST_URL, options = {}) {
  return parseRegistryManifest(await readLocation(location, options));
}

async function loadRegistryDescriptor(entry, manifestLocation = REGISTRY_MANIFEST_URL, options = {}) {
  const location = resolveRegistryLocation(manifestLocation, entry.path);
  const descriptor = JSON.parse(await readLocation(location, options));
  return validateDescriptorIdentity(descriptor, entry.name);
}

async function loadCoreDescriptor(location = REGISTRY_MANIFEST_URL, options = {}) {
  const manifest = await loadRegistryManifest(location, options);
  return validateCoreDescriptor(await loadRegistryDescriptor(manifest.core, location, options));
}

async function loadExtensionRegistry(location = REGISTRY_MANIFEST_URL, options = {}) {
  const manifest = await loadRegistryManifest(location, options);
  const descriptors = await Promise.all(
    manifest.extensions.map(entry => loadRegistryDescriptor(entry, location, options)),
  );
  const entries = new Map(descriptors.map(descriptor => [descriptor.name, descriptor]));
  const visit = (name, chain = []) => {
    if (chain.includes(name)) throw new Error('Cyclic extension dependency');
    const entry = entries.get(name);
    if (!entry) throw new Error(`Unknown registry dependency: ${name}`);
    const dependencies = [
      ...entry.dependencies,
      ...Object.values(entry.provider_dependencies || {}).flatMap(rule => Object.values(rule.providers).flat()),
    ];
    dependencies.forEach(dependency => visit(dependency, [...chain, name]));
  };
  entries.forEach((entry, name) => visit(name));
  return { manifest, entries };
}

async function listExtensions(location = REGISTRY_MANIFEST_URL, options = {}) {
  const { entries } = await loadExtensionRegistry(location, options);
  return [...entries.keys()];
}

function sourceInventory(source, commit) {
  if (!commitPattern.test(commit)) throw new Error('Exact source commit required');
  const git = args => execFileSync('git', ['-C', source, ...args], { maxBuffer: 128 * 1024 * 1024 });
  const head = git(['rev-parse', 'HEAD']).toString('utf8').trim();
  if (head !== commit) throw new Error('Extension source is not checked out at the registered commit');
  if (git(['status', '--porcelain']).length > 0) throw new Error('Extension source has uncommitted or untracked files');

  const tree = git(['ls-tree', '-rz', '--full-tree', commit]);
  const records = []; const seen = new Set();
  for (const row of tree.toString('utf8').split('\0').filter(Boolean)) {
    const tab = row.indexOf('\t'); const [mode, type, oid] = row.slice(0, tab).split(' '); const file = row.slice(tab + 1);
    if (!['100644', '100755'].includes(mode) || type !== 'blob' || file.includes('\ufffd') ||
        file.includes('\\') || file.startsWith('/') || file.split('/').some(part => !part || part === '.' || part === '..') || seen.has(file.toLowerCase())) {
      throw new Error('Unsupported source tree entry');
    }
    seen.add(file.toLowerCase());
    const bytes = git(['cat-file', 'blob', oid]);
    if (bytes.toString('utf8', 0, 100).startsWith('version https://git-lfs.github.com/spec/v1')) throw new Error('LFS source unsupported');
    records.push([file, mode, bytes]);
  }
  records.sort((first, second) => Buffer.compare(Buffer.from(first[0]), Buffer.from(second[0])));
  return { records };
}

function publishedExtensionDescriptor(descriptor) {
  return versionPattern.test(descriptor.version) && commitPattern.test(descriptor.source_commit);
}

async function verifyRelease(source, bundle, registryLocation = REGISTRY_MANIFEST_URL, options = {}) {
  const { entries } = await loadExtensionRegistry(registryLocation, options);
  const entry = entries.get(bundle.name);
  if (!entry) throw new Error(`Extension is not registered: ${bundle.name}`);
  if (!publishedExtensionDescriptor(entry)) {
    return { verified: false, registered: true, reason: 'The registered extension has no published release yet', entry, entries };
  }
  if (entry.version !== bundle.version) throw new Error('Registry version does not match bundle');
  if (JSON.stringify(entry.dependencies) !== JSON.stringify(bundle.dependencies || [])) throw new Error('Registry dependencies do not match bundle');
  if (entry.provider_dependencies !== undefined && JSON.stringify(entry.provider_dependencies) !== JSON.stringify(bundle.provider_dependencies || {})) {
    throw new Error('Registry provider dependencies do not match bundle');
  }

  let inventory;
  try {
    inventory = sourceInventory(source, entry.source_commit).records;
  } catch (error) {
    throw new Error(`Registered extension verification requires a clean Git checkout: ${error.message}`);
  }
  const { safePath } = require('./installer.cjs');
  for (const [file, mode, bytes] of inventory) {
    const stat = await fs.stat(await safePath(source, file));
    if ((mode === '100755') !== Boolean(stat.mode & 0o111)) throw new Error(`Source mode differs from registered commit: ${file}`);
    if (!(await fs.readFile(await safePath(source, file))).equals(bytes)) throw new Error(`Source differs from registered commit: ${file}`);
  }
  const tracked = new Set(inventory.map(row => row[0]));
  if (!tracked.has('extension.json') || bundle.files.some(file => !tracked.has(file.source))) {
    throw new Error('Payload is not in the registered source');
  }
  return { verified: true, registered: true, entry, entries, inventory };
}

module.exports = {
  REGISTRY_MANIFEST_URL,
  listExtensions,
  loadCoreDescriptor,
  loadExtensionRegistry,
  loadRegistryDescriptor,
  loadRegistryManifest,
  parseRegistryManifest,
  readLocation,
  resolveRegistryLocation,
  sourceInventory,
  validateCoreDescriptor,
  verifyRelease,
  versionPattern,
};
