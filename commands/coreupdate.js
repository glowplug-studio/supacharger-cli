const { exec } = require('child_process');
const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const readline = require('readline');

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

function askYesNo(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase());
    });
  });
}

async function readCliInstallHash(configPath) {
  try {
    const content = await fs.readFile(configPath, 'utf8');
    const match = content.match(/CLI_INSTALL_HASH\s*:\s*['"`]([a-f0-9]+)['"`]/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

async function getRemoteMainHash() {
  try {
    const { stdout } = await execCommand(
      'git ls-remote git@github.com:glowplug-studio/supacharger-demo.git refs/heads/main'
    );
    const hash = stdout.split('\t')[0].trim();
    return hash;
  } catch (err) {
    throw new Error(`Failed to fetch remote main branch hash: ${err.message}`);
  }
}

async function removeGitDir(dir) {
  const gitPath = path.join(dir, '.git');
  try {
    const stat = await fs.stat(gitPath);
    if (stat.isDirectory()) {
      await fs.rm(gitPath, { recursive: true, force: true });
      console.log('Removed .git directory from cloned folder.');
    }
  } catch {
    // .git does not exist, no action needed
  }
}

async function hashFile(filePath) {
  const hash = crypto.createHash('sha256');
  const data = await fs.readFile(filePath);
  hash.update(data);
  return hash.digest('hex');
}

async function walkFiles(baseDir, currentDir = '') {
  const dirPath = path.join(baseDir, currentDir);
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  let files = [];

  for (const entry of entries) {
    const relPath = path.join(currentDir, entry.name);
    if (entry.isDirectory()) {
      const subFiles = await walkFiles(baseDir, relPath);
      files = files.concat(subFiles);
    } else if (entry.isFile()) {
      files.push(relPath);
    }
  }
  return files;
}

async function removeDirContents(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  await Promise.all(entries.map(async (entry) => {
    const fullPath = path.join(dir, entry.name);
    await fs.rm(fullPath, { recursive: true, force: true });
  }));
}

async function cloneLatestMain(updateDir) {
  await removeDirContents(updateDir);
  console.log('Cloning latest main branch...');
  await execCommand(`git clone --depth 1 --branch main git@github.com:glowplug-studio/supacharger-demo.git "${updateDir}"`);
  console.log('Latest main branch cloned.');
}

async function coreupdate() {
  const spinnerFrames = ['|', '/', '-', '\\'];
  let spinnerIndex = 0;
  let spinnerInterval;

  // Files to ignore during integrity check
  const ignoredFiles = [
    'src/supacharger/supacharger-config.ts',
  ];

  try {
    const warningMessage = `
\u001b[37;41m
WARNING: THIS ACTION CAN SERIOUSLY DAMAGE YOUR APPLICATION!\u001b[0m\u001b[33m
I will attempt to pull the latest core files, apply database changes and potentially update supabase edge and RPC functions and more.
Ensure you have committed any unsaved changes, are on an appropriate branch and are not making changes to a production database.
You have been warned!
Enter Y to continue: \u001b[0m`;

    const answer = await askYesNo(warningMessage);

    if (answer !== 'y') {
      console.log('Aborted by user. No changes were made.');
      process.exit(0);
    }

    const cwd = process.cwd();
    const localConfigPath = path.resolve(cwd, 'src', 'supacharger', 'supacharger-config.ts');
    const updateDir = path.resolve(cwd, '.sc-core-update');

    const localHash = await readCliInstallHash(localConfigPath);

    if (!localHash) {
      console.error('Error: CLI_INSTALL_HASH does not exist in supacharger-config.ts. Aborting.');
      process.exit(1);
    }

    console.log(`Current CLI_INSTALL_HASH: ${localHash}`);

    const remoteHash = await getRemoteMainHash();
    console.log(`Latest remote main branch commit hash: ${remoteHash}`);

    // If hashes are equal, no update needed
    if (localHash === remoteHash) {
      console.log('Core is already up to date. No update needed.');
      process.exit(0);
    }

    // Prepare update directory
    await fs.rm(updateDir, { recursive: true, force: true });
    await fs.mkdir(updateDir, { recursive: true });
    console.log(`Created or cleaned directory: ${updateDir}`);

    // Clone main branch without checkout
    console.log(`Cloning main branch into ${updateDir}...`);
    await execCommand(`git clone --no-checkout --branch main git@github.com:glowplug-studio/supacharger-demo.git "${updateDir}"`);

    // Checkout specific commit (CLI_INSTALL_HASH only)
    await execCommand(`git -C "${updateDir}" checkout ${localHash}`);

    // Remove .git directory
    await removeGitDir(updateDir);

    // Start integrity check
    console.log('Checking Core Integrity...');

    spinnerInterval = setInterval(() => {
      process.stdout.write(`\rChecking Core Integrity... ${spinnerFrames[spinnerIndex]} `);
      spinnerIndex = (spinnerIndex + 1) % spinnerFrames.length;
    }, 100);

    const updateFiles = await walkFiles(updateDir);

    const missingFiles = [];
    const differentFiles = [];

    for (const relPath of updateFiles) {
      if (ignoredFiles.includes(relPath)) continue;

      process.stdout.write(`\rChecking Core Integrity... ${spinnerFrames[spinnerIndex]}  ${relPath}  `);

      const updateFilePath = path.join(updateDir, relPath);
      const localFilePath = path.join(cwd, relPath);

      try {
        await fs.access(localFilePath);
      } catch {
        missingFiles.push(relPath);
        continue;
      }

      const [hashUpdate, hashLocal] = await Promise.all([
        hashFile(updateFilePath),
        hashFile(localFilePath),
      ]);

      if (hashUpdate !== hashLocal) {
        differentFiles.push(relPath);
      }
    }

    process.stdout.write('\r\x1b[K');
    clearInterval(spinnerInterval);

    // If no missing or different files, files match exactly the commit in CLI_INSTALL_HASH
    if (missingFiles.length === 0 && differentFiles.length === 0) {
      console.log('Local files match the state of the remote at the CLI_INSTALL_HASH commit.');
      console.log('Proceeding to clone the latest main branch into the update directory.');

      await removeDirContents(updateDir);
      await cloneLatestMain(updateDir);
    } else {
      console.log('\nThe following files have been modified or are missing:');
      missingFiles.forEach(f => console.log(`  - MISSING: ${f}`));
      differentFiles.forEach(f => console.log(`  - MODIFIED: ${f}`));

      const action = await askYesNo('\nChoose action: Overwrite all (o), Skip update (s), Exit (e): ');

      if (action === 'o' || action === 's') {
        console.log(`You chose to ${action === 'o' ? 'overwrite' : 'skip'} the update.`);

        await removeDirContents(updateDir);
        await cloneLatestMain(updateDir);

        console.log('Update directory reset with latest main branch.');
      } else {
        console.log('Exiting without changes.');
        process.exit(0);
      }
    }

    console.log('Core update process complete.');
  } catch (err) {
    console.error('Error during coreupdate:', err);
    process.exit(1);
  }
}

module.exports = coreupdate;
