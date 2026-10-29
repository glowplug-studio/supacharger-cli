const semver = require('semver');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { findCoreLock } = require('../version');
const { loadCoreDescriptor } = require('../extensions/registry.cjs');
const copy = require('../../messages/en.json').CoreCompatibility;

const SUPPORTED_CORE_RANGE = '>=0.0.1-alpha <0.0.2';
const UPDATE_COMMAND = 'npm install -g @glowplug/supacharger-cli@latest';

function compatibilityError(version, reason = copy.Unsupported) {
  return new Error(reason.replace('{version}', String(version ?? copy.Unknown))
    + '\n' + copy.Range.replace('{range}', SUPPORTED_CORE_RANGE)
    + '\n' + copy.Update.replace('{command}', UPDATE_COMMAND));
}

function assertSupportedCore(version) {
  if (!semver.valid(version) || !semver.satisfies(version, SUPPORTED_CORE_RANGE)) {
    throw compatibilityError(version);
  }
  return version;
}

async function checkLocalCore(directory = process.cwd()) {
  let installation;
  try { installation = await findCoreLock(directory); }
  catch (error) { throw compatibilityError(null, error.message); }
  if (!installation) throw compatibilityError(null, copy.MissingLock);
  assertSupportedCore(installation.lock.version);
  return installation;
}

async function prepareCoreTarget(options = {}) {
  const current = await loadCoreDescriptor(options.registry, { fetch: options.fetch });
  const releases = [current, ...Object.entries(current.version_history || {}).map(([version, release]) => ({ ...release, version }))];
  let ref = options.ref;
  if (options.source) ref = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: path.resolve(options.source), encoding: 'utf8' }).trim();
  const target = ref ? releases.find(release => ref === release.version || ref === `v${release.version}` || ref === release.source_commit) : current;
  if (!target || !/^[a-f0-9]{40}$/.test(target.source_commit || '')) throw compatibilityError(ref, copy.Unregistered);
  assertSupportedCore(target.version);
  return { ...options, ref: target.source_commit, coreVersion: target.version };
}

async function checkCommandCompatibility(command) {
  if (command.name() === 'init') return; // Check the actual descriptor inside init, before preparing files.
  const options = command.opts();
  const installation = await checkLocalCore(options.root || process.cwd());
  // Resolve user paths before normalising the working directory.
  if (options.source) command.setOptionValue('source', path.resolve(options.source));
  if (options.registry && !/^https:\/\//.test(options.registry)) command.setOptionValue('registry', path.resolve(options.registry));
  if (options.root) command.setOptionValue('root', installation.directory);
  else process.chdir(installation.directory);
}

module.exports = { SUPPORTED_CORE_RANGE, assertSupportedCore, checkLocalCore, prepareCoreTarget, checkCommandCompatibility };
