import fs from 'node:fs/promises';
import path from 'node:path';
import semver from 'semver';
import english from '../messages/en.json';

const copy = english.WhichCli;

interface VersionOptions { cwd?: string; registry?: string; fetch?: typeof fetch; core?: boolean; extension?: string }
interface CoreLock { repository: string; version: string; commit: string }
import { loadExtensionRegistry, REGISTRY_MANIFEST_URL, versionPattern } from './extensions/registry.cjs';

async function findCoreLock(startDirectory = process.cwd()) {
  let directory = path.resolve(startDirectory);
  while (true) {
    const lockPath = path.join(directory, '.supacharger', 'core-lock.json');
    try {
      const stat = await fs.lstat(lockPath);
      if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(copy.UnsafeLock.replace('{path}', lockPath));
      const lock = JSON.parse(await fs.readFile(lockPath, 'utf8')) as CoreLock;
      if (
        typeof lock.repository !== 'string' || !lock.repository ||
        typeof lock.version !== 'string' || !semver.valid(lock.version) ||
        typeof lock.commit !== 'string' || !/^[a-f0-9]{40}$/.test(lock.commit)
      ) throw new Error(copy.InvalidLock.replace('{path}', lockPath));
      return { directory, lock, lockPath };
    } catch (caught) {
      const error = caught as NodeJS.ErrnoException;
      if (error?.code !== 'ENOENT') throw error;
    }

    const parent = path.dirname(directory);
    if (parent === directory) return null;
    directory = parent;
  }
}

async function printCoreVersion(options: VersionOptions = {}) {
  const installation = await findCoreLock(options.cwd);
  if (!installation) throw new Error(copy.NotFound);
  const { lock } = installation;
  console.log(lock.version);
  return { version: lock.version, commit: lock.commit, root: installation.directory };
}

async function printExtensionVersion(name: string, options: VersionOptions = {}) {
  const registry = options.registry || REGISTRY_MANIFEST_URL;
  const { entries } = await loadExtensionRegistry(registry, { fetch: options.fetch });
  const descriptor = entries.get(name);
  if (!descriptor) throw new Error(copy.ExtensionNotFound.replace('{name}', name));
  if (!versionPattern.test(descriptor.version)) throw new Error(copy.ExtensionUnpublished.replace('{name}', name));
  console.log(descriptor.version);
  return { name, version: descriptor.version, commit: descriptor.source_commit, source: 'registry' };
}

async function printSelectedVersion(options: VersionOptions = {}) {
  if (options.core && options.extension) throw new Error(copy.OneTarget);
  if (options.core) return printCoreVersion(options);
  if (options.extension) return printExtensionVersion(options.extension, options);
  throw new Error(copy.TargetRequired);
}

export { findCoreLock, printCoreVersion, printExtensionVersion, printSelectedVersion };
