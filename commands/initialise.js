const { spawn, exec } = require('child_process');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const readline = require('readline');

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
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise((resolve, reject) => {
    rl.question(question, answer => {
      rl.close();
      const trimmed = answer.trim();
      if (trimmed === 'Y' || trimmed === 'y') {
        resolve(true);
      } else {
        reject(new Error('Cancelled by user'));
      }
    });
  });
}

async function removeAllExceptGit(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  await Promise.all(entries.map(async entry => {
    if (entry.name === '.git') return;
    const fullPath = path.join(dir, entry.name);
    await fs.rm(fullPath, { recursive: true, force: true });
  }));
}

async function removeGitDir(dir) {
  const gitPath = path.join(dir, '.git');
  try {
    const stat = await fs.stat(gitPath);
    if (stat.isDirectory()) {
      await fs.rm(gitPath, { recursive: true, force: true });
      console.log('\x1b[34m Removed .git directory from cloned folder.\x1b[0m');
    }
  } catch {
    // .git does not exist, no action needed
  }
}

async function writeCoreLock(rootDir, commit) {
  const lockPath = path.join(rootDir, '.supacharger', 'core-lock.json');
  await fs.mkdir(path.dirname(lockPath), { recursive: true });
  await fs.writeFile(
    lockPath,
    `${JSON.stringify({ repository: CORE_REPOSITORY, commit }, null, 2)}\n`,
    'utf8'
  );
}

async function moveAllFilesForce(srcDir, destDir) {
  const entries = await fs.readdir(srcDir, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(srcDir, entry.name);
    const destPath = path.join(destDir, entry.name);

    try {
      await fs.access(destPath);
      await fs.rm(destPath, { recursive: true, force: true });
    } catch {
      // destPath does not exist, no action needed
    }

    await fs.rename(srcPath, destPath);
  }
  await fs.rmdir(srcDir);
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
    const gitProcess = spawn('git', ['clone', '--depth', '1', repoUrl, targetDir], {
      stdio: 'inherit'
    });

    gitProcess.on('error', err => {
      reject(err);
    });

    gitProcess.on('close', code => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`git clone exited with code ${code}`));
      }
    });
  });
}

async function initialise(target = '.') {
  const cwd = process.cwd();
  const useCurrentDir = isCurrentDirTarget(target);
  const resolvedTargetDir = useCurrentDir ? cwd : path.resolve(cwd, target);
  const tempDir = path.join(resolvedTargetDir, '.sc-core-install');

  try {
    assertSafeTargetDirectory(resolvedTargetDir, cwd);
    if (!useCurrentDir) {
      const targetExists = await pathExists(resolvedTargetDir);
      if (!targetExists) {
        await fs.mkdir(resolvedTargetDir, { recursive: true });
        console.log(`\x1b[34mCreated target directory: ${resolvedTargetDir}\x1b[0m`);
      }
    }

    console.log(`\x1b[34mInitialising in directory: ${resolvedTargetDir} \x1b[0m`);

    if (useCurrentDir) {
      await promptYesOnly(
        '\x1b[41m\x1b[97mWARNING:\x1b[0m\x1b[33m I will erase EVERYTHING in this directory except the .git directory. Do you wish to continue? Type Y to confirm: \x1b[0m'
      );
    } else {
      const hasGitDir = await pathExists(path.join(resolvedTargetDir, '.git'));
      const targetEntries = await fs.readdir(resolvedTargetDir, { withFileTypes: true });
      const hasContentToWipe = targetEntries.some(entry => entry.name !== '.git');
      if (hasGitDir || hasContentToWipe) {
        await promptYesOnly(
          '\x1b[41m\x1b[97mWARNING:\x1b[0m\x1b[33m Target directory is not empty and its contents (except .git) will be erased. Do you wish to continue? Type Y to confirm: \x1b[0m'
        );
      }
    }

    await removeAllExceptGit(resolvedTargetDir);
    console.log('\x1b[34mRemoved all files and dirs except .git...\x1b[0m');

    try {
      await fs.access(tempDir);
      console.log(`Removing existing temporary folder: ${tempDir}`);
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // tempDir does not exist, no action needed
    }

    console.log(`\x1b[34mCreating temporary dir '${tempDir}'...\x1b[0m`);
    await gitClone(CORE_SSH_URL, tempDir);

    console.log('Done.');

    const { stdout: commitHash } = await execCommand('git rev-parse HEAD', { cwd: tempDir });
    const trimmedHash = commitHash.trim();

    await removeGitDir(tempDir);

    await writeCoreLock(tempDir, trimmedHash);

    console.log('\x1b[34mMoving files from temporary folder into target directory...\x1b[0m');
    await moveAllFilesForce(tempDir, resolvedTargetDir);
  
    console.log('\x1b[32m✓ Initialise completed successfully. You should now commit changes to your main branch.\x1b[0m');
  } catch (err) {
    if (err.message === 'Cancelled by user') {
      console.log('\x1b[34mOperation cancelled by user.\x1b[0m');
      process.exit(0);
    }
    console.error('Error during initialise:', err);
    process.exit(1);
  }
}

module.exports = initialise;
module.exports.testHelpers = { assertSafeTargetDirectory, isCurrentDirTarget };
