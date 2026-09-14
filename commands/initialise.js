const { spawn, exec } = require('child_process');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const readline = require('readline');

const { printGitHubDevelopmentWarning } = require('./common/github-development-warning');
const { prepareStarter } = require('./common/test-distribution');

const CORE_REPOSITORY = 'glowplug-studio/supacharger';
const CORE_SSH_URL = `git@github.com:${CORE_REPOSITORY}.git`;

function execCommand(command, options = {}) {
  return new Promise((resolve, reject) => {
    const child = exec(command, options, (error, stdout, stderr) => {
      if (error) {
        reject(error);
        return;
      }
      resolve({ stdout, stderr });
    });
    child.stdout?.pipe(process.stdout);
    child.stderr?.pipe(process.stderr);
  });
}

function promptYesOnly(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve, reject) => {
    rl.question(question, answer => {
      rl.close();
      const trimmed = answer.trim();
      if (trimmed === 'Y' || trimmed === 'y') resolve(true);
      else reject(new Error('Cancelled by user'));
    });
  });
}

async function removeGitDir(dir) {
  const gitPath = path.join(dir, '.git');
  try {
    const stat = await fs.stat(gitPath);
    if (stat.isDirectory()) {
      await fs.rm(gitPath, { recursive: true, force: true });
      console.log('\x1b[34mRemoved .git directory from prepared Core.\x1b[0m');
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}

async function writeCoreLock(rootDir, commit) {
  const lockPath = path.join(rootDir, '.supacharger', 'core-lock.json');
  await fs.mkdir(path.dirname(lockPath), { recursive: true });
  await fs.writeFile(lockPath, `${JSON.stringify({ repository: CORE_REPOSITORY, commit }, null, 2)}\n`, 'utf8');
}

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function isCurrentDirTarget(target) {
  return !target || target === '.';
}

function assertSafeTargetDirectory(targetDir, cwd = process.cwd()) {
  const resolvedTarget = path.resolve(targetDir);
  const resolvedCwd = path.resolve(cwd);
  const filesystemRoot = path.parse(resolvedTarget).root;
  if (resolvedTarget === filesystemRoot || resolvedTarget === path.resolve(os.homedir())) {
    throw new Error(`Refusing to initialise into unsafe target directory: ${resolvedTarget}`);
  }

  const targetContainsCwd = path.relative(resolvedTarget, resolvedCwd);
  if (
    resolvedTarget !== resolvedCwd &&
    targetContainsCwd !== '..' &&
    !targetContainsCwd.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(targetContainsCwd)
  ) {
    throw new Error(`Refusing to initialise into a parent of the current working directory: ${resolvedTarget}`);
  }
}

function gitClone(repoUrl, targetDir) {
  return new Promise((resolve, reject) => {
    const gitProcess = spawn('git', ['clone', '--depth', '1', repoUrl, targetDir], { stdio: 'inherit' });
    gitProcess.on('error', reject);
    gitProcess.on('close', code => {
      if (code === 0) resolve();
      else reject(new Error(`git clone exited with code ${code}`));
    });
  });
}

async function rollbackInitialise(targetDir, previousDir, installedNames, movedPrevious, targetExisted) {
  for (const name of [...installedNames].reverse()) {
    await fs.rm(path.join(targetDir, name), { recursive: true, force: true });
  }
  for (const name of [...movedPrevious].reverse()) {
    await fs.rename(path.join(previousDir, name), path.join(targetDir, name));
  }
  if (!targetExisted) {
    const remaining = await fs.readdir(targetDir);
    if (remaining.length === 0) await fs.rmdir(targetDir);
  }
}

async function installPreparedStarter(preparedDir, targetDir, previousDir, targetExisted) {
  await fs.mkdir(targetDir, { recursive: true });
  const movedPrevious = [];
  const installedNames = [];
  try {
    const existing = await fs.readdir(targetDir, { withFileTypes: true });
    for (const entry of existing) {
      if (entry.name === '.git') continue;
      await fs.rename(path.join(targetDir, entry.name), path.join(previousDir, entry.name));
      movedPrevious.push(entry.name);
    }

    const prepared = await fs.readdir(preparedDir, { withFileTypes: true });
    for (const entry of prepared) {
      if (entry.name === '.git') continue;
      await fs.rename(path.join(preparedDir, entry.name), path.join(targetDir, entry.name));
      installedNames.push(entry.name);
    }
  } catch (error) {
    try {
      await rollbackInitialise(targetDir, previousDir, installedNames, movedPrevious, targetExisted);
    } catch (rollbackError) {
      const failure = new Error(
        `Initialisation failed and automatic restoration was incomplete. Recovery files remain at ${previousDir}. ` +
        `Original error: ${error.message}. Restoration error: ${rollbackError.message}`,
      );
      failure.recoveryDirectory = previousDir;
      throw failure;
    }
    throw new Error(`Initialisation failed before completion; the original target contents were restored. ${error.message}`);
  }
}

async function initialise(target = '.', options = {}) {
  const cwd = process.cwd();
  const useCurrentDir = isCurrentDirTarget(target);
  const resolvedTargetDir = useCurrentDir ? cwd : path.resolve(cwd, target);
  let transactionRoot = null;
  let retainTransaction = false;

  try {
    assertSafeTargetDirectory(resolvedTargetDir, cwd);
    printGitHubDevelopmentWarning();

    const targetExisted = await pathExists(resolvedTargetDir);
    const targetEntries = targetExisted ? await fs.readdir(resolvedTargetDir, { withFileTypes: true }) : [];
    const hasGitDir = targetEntries.some(entry => entry.name === '.git');
    const hasContentToReplace = targetEntries.some(entry => entry.name !== '.git');

    if (useCurrentDir || hasGitDir || hasContentToReplace) {
      await promptYesOnly(
        '\x1b[41m\x1b[97mWARNING:\x1b[0m\x1b[33m Existing contents except .git will be replaced only after Core has downloaded and prepared successfully. Type Y to confirm: \x1b[0m',
      );
    }

    const parentDir = path.dirname(resolvedTargetDir);
    await fs.mkdir(parentDir, { recursive: true });
    transactionRoot = await fs.mkdtemp(path.join(parentDir, `.${path.basename(resolvedTargetDir)}.supacharger-init-`));
    const preparedDir = path.join(transactionRoot, 'prepared');
    const previousDir = path.join(transactionRoot, 'previous');
    await fs.mkdir(previousDir);

    console.log(`\x1b[34mPreparing Core outside the target directory: ${preparedDir}\x1b[0m`);
    await gitClone(CORE_SSH_URL, preparedDir);
    const { stdout: commitHash } = await execCommand('git rev-parse HEAD', { cwd: preparedDir });
    await prepareStarter(preparedDir);
    await removeGitDir(preparedDir);
    await writeCoreLock(preparedDir, commitHash.trim());

    console.log(`\x1b[34mInstalling prepared Core into: ${resolvedTargetDir}\x1b[0m`);
    try {
      await installPreparedStarter(preparedDir, resolvedTargetDir, previousDir, targetExisted);
    } catch (error) {
      retainTransaction = Boolean(error.recoveryDirectory);
      throw error;
    }

    await fs.rm(transactionRoot, { recursive: true, force: true });
    transactionRoot = null;

    if (!options.skipSkills && process.stdin.isTTY && process.stdout.isTTY) {
      try {
        await require('./skills/installer.cjs').runSkills([], { root: resolvedTargetDir });
      } catch (error) {
        console.warn(require('./skills/installer.cjs').message('OptionalFailed', { reason: error.message }));
      }
    }

    console.log('\x1b[32m✓ Initialise completed successfully. Review and commit the new application files.\x1b[0m');
  } catch (error) {
    if (transactionRoot && !retainTransaction) {
      await fs.rm(transactionRoot, { recursive: true, force: true }).catch(() => {});
    }
    if (error.message === 'Cancelled by user') {
      console.log('\x1b[34mOperation cancelled by user.\x1b[0m');
      process.exit(0);
    }
    console.error('Error during initialise:', error);
    process.exit(1);
  }
}

module.exports = initialise;
module.exports.testHelpers = {
  assertSafeTargetDirectory,
  installPreparedStarter,
  isCurrentDirTarget,
  rollbackInitialise,
};
