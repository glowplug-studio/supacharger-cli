const fs = require('node:fs/promises');
const path = require('node:path');

const copy = require('../messages/en.json').VersionCli;

async function findCoreLock(startDirectory = process.cwd()) {
  let directory = path.resolve(startDirectory);
  while (true) {
    const lockPath = path.join(directory, '.supacharger', 'core-lock.json');
    try {
      const stat = await fs.lstat(lockPath);
      if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(copy.UnsafeLock.replace('{path}', lockPath));
      const lock = JSON.parse(await fs.readFile(lockPath, 'utf8'));
      if (
        typeof lock.repository !== 'string' || !lock.repository ||
        typeof lock.version !== 'string' || !require('semver').valid(lock.version) ||
        typeof lock.commit !== 'string' || !/^[a-f0-9]{40}$/.test(lock.commit)
      ) throw new Error(copy.InvalidLock.replace('{path}', lockPath));
      return { directory, lock, lockPath };
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }

    const parent = path.dirname(directory);
    if (parent === directory) return null;
    directory = parent;
  }
}

async function printCoreVersion(options = {}) {
  const installation = await findCoreLock(options.cwd);
  if (!installation) throw new Error(copy.NotFound);
  const { lock } = installation;
  console.log(lock.version);
  return { version: lock.version, commit: lock.commit, root: installation.directory };
}

module.exports = { findCoreLock, printCoreVersion };
