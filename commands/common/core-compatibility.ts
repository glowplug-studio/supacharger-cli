import semver from 'semver';
import type { Command } from 'commander';
import { errorMessage } from './errors';

export interface CoreTargetOptions {
  registry?: string;
  fetch?: typeof globalThis.fetch;
  ref?: string;
  source?: string;
}

import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { findCoreLock } from '../version';
import { loadCoreDescriptor } from '../extensions/registry.cjs';
import english from '../../messages/en.json';
const copy = english.CoreCompatibility;

const SUPPORTED_CORE_RANGE = '>=0.0.1-alpha <0.0.2';
const UPDATE_COMMAND = 'npm install -g @glowplug/supacharger-cli@latest';

function compatibilityError(version: unknown, reason = copy.Unsupported) {
  return new Error(reason.replace('{version}', String(version ?? copy.Unknown))
    + '\n' + copy.Range.replace('{range}', SUPPORTED_CORE_RANGE)
    + '\n' + copy.Update.replace('{command}', UPDATE_COMMAND));
}

function assertSupportedCore(version: string) {
  if (!semver.valid(version) || !semver.satisfies(version, SUPPORTED_CORE_RANGE)) {
    throw compatibilityError(version);
  }
  return version;
}

async function checkLocalCore(directory = process.cwd()) {
  let installation;
  try { installation = await findCoreLock(directory); }
  catch (error) { throw compatibilityError(null, errorMessage(error)); }
  if (!installation) throw compatibilityError(null, copy.MissingLock);
  assertSupportedCore(installation.lock.version);
  return installation;
}

async function prepareCoreTarget<T extends CoreTargetOptions>(options: T = {} as T) {
  const current = await loadCoreDescriptor(options.registry, { fetch: options.fetch });
  const releases = [current, ...Object.entries(current.version_history || {}).map(([version, release]) => ({ ...release, version }))];
  let ref = options.ref;
  if (options.source) ref = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: path.resolve(options.source), encoding: 'utf8' }).trim();
  const target = ref ? releases.find(release => ref === release.version || ref === `v${release.version}` || ref === release.source_commit) : current;
  if (!target || !/^[a-f0-9]{40}$/.test(target.source_commit || '')) throw compatibilityError(ref, copy.Unregistered);
  assertSupportedCore(target.version);
  return { ...options, ref: target.source_commit, coreVersion: target.version };
}

async function checkCommandCompatibility(command: Command) {
  if (command.name() === 'init' || command.name() === 'which') return; // These commands inspect or establish version state themselves.
  const options = command.opts<CoreTargetOptions & { root?: string }>();
  const installation = await checkLocalCore(options.root || process.cwd());
  // Resolve user paths before normalising the working directory.
  if (options.source) command.setOptionValue('source', path.resolve(options.source));
  if (options.registry && !/^https:\/\//.test(options.registry)) command.setOptionValue('registry', path.resolve(options.registry));
  if (options.root) command.setOptionValue('root', installation.directory);
  process.chdir(installation.directory);
}

export { SUPPORTED_CORE_RANGE, assertSupportedCore, checkLocalCore, prepareCoreTarget, checkCommandCompatibility };
