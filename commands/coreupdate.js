const { exec } = require('child_process');
const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const readline = require('readline');
const https = require('https');

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
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.github.com',
      path: '/repos/glowplug-studio/supacharger-demo/commits?sha=main&per_page=1',
      method: 'GET',
      headers: {
        'User-Agent': 'supacharger-cli',
        'Accept': 'application/vnd.github+json',
      },
    };

    const req = https.request(options, (res) => {
      let data = '';

      if (res.statusCode !== 200) {
        reject(new Error(`GitHub API responded with status code ${res.statusCode}`));
        res.resume();
        return;
      }

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (Array.isArray(json) && json.length > 0 && json[0].sha) {
            resolve(json[0].sha);
          } else {
            reject(new Error('Unexpected GitHub API response format'));
          }
        } catch (err) {
          reject(new Error('Failed to parse GitHub API response: ' + err.message));
        }
      });
    });

    req.on('error', (err) => {
      reject(new Error('Request error: ' + err.message));
    });

    req.end();
  });
}

async function removeGitDir(dir) {
  const gitPath = path.join(dir, '.git');
  try {
    const stat = await fs.stat(gitPath);
    if (stat.isDirectory()) {
      await fs.rm(gitPath, { recursive: true, force: true });
      console.log('\x1b[34mRemoved .git directory from cloned folder.\x1b[0m');
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
  await Promise.all(
    entries.map(async (entry) => {
      const fullPath = path.join(dir, entry.name);
      await fs.rm(fullPath, { recursive: true, force: true });
    })
  );
}

async function cloneLatestMain(updateDir) {
  await removeDirContents(updateDir);
  console.log('Cloning latest main branch...');
  await execCommand(
    `git clone --depth 1 --branch main git@github.com:glowplug-studio/supacharger-demo.git "${updateDir}"`
  );
  console.log('Latest main branch cloned.');
}

async function coreupdate() {
  const spinnerFrames = ['|', '/', '-', '\\'];
  let spinnerIndex = 0;
  let spinnerInterval;

  // Files to ignore during integrity check
  const ignoredFiles = ['src/supacharger/supacharger-config.ts'];

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
      console.log('\x1b[31mAborted by user. No changes were made.\x1b[0m');
      process.exit(0);
    }

    const cwd = process.cwd();
    const localConfigPath = path.resolve(cwd, 'src', 'supacharger', 'supacharger-config.ts');
    const updateDir = path.resolve(cwd, '.sc-core-update');

    const localHash = await readCliInstallHash(localConfigPath);

    if (!localHash) {
      console.error('\x1b[31mError: CLI_INSTALL_HASH does not exist in supacharger-config.ts. Aborting.\x1b[0m');
      process.exit(1);
    }

    console.log(`\x1b[34mCurrent CLI_INSTALL_HASH:\x1b[0m \x1b[32m${localHash}\x1b[0m`);
    console.log(`\x1b[34mChecking for latest remote commit...\x1b[0m`);

    const remoteHash = await getRemoteMainHash();

    console.log(`\x1b[34mLatest remote main branch commit hash:\x1b[0m \x1b[32m${remoteHash}\x1b[0m`);

    // If hashes are equal, no update needed
    if (localHash === remoteHash) {
      console.log('Core is already up to date. No update needed.');
      process.exit(0);
    }

    // Prepare update directory
    await fs.rm(updateDir, { recursive: true, force: true });
    await fs.mkdir(updateDir, { recursive: true });
    console.log(`\x1b[34mCreated or cleaned directory:\x1b[0m \x1b[32m${updateDir}\x1b[0m`);

    // Clone main branch without checkout
    await execCommand(
      `git clone --no-checkout --branch main git@github.com:glowplug-studio/supacharger-demo.git "${updateDir}"`
    );

    await execCommand(
      `git -C ${updateDir} config advice.detachedHead false`
    );

    // Checkout specific commit (CLI_INSTALL_HASH only)
    await execCommand(`git -C ${updateDir} checkout ${localHash}`);

    // Remove .git directory
    await removeGitDir(updateDir);

    // Start integrity check
    console.log('\x1b[34m\nChecking Core Integrity...\x1b[0m');

    spinnerInterval = setInterval(() => {
      process.stdout.write(`\rChecking Core Integrity... Comparing local core to remote. ${spinnerFrames[spinnerIndex]} `);
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

      const [hashUpdate, hashLocal] = await Promise.all([hashFile(updateFilePath), hashFile(localFilePath)]);

      if (hashUpdate !== hashLocal) {
        differentFiles.push(relPath);
      }
    }

    process.stdout.write('\r\x1b[K');
    clearInterval(spinnerInterval);

    if (missingFiles.length === 0 && differentFiles.length === 0) {
      console.log('Local files match the state of the remote at the CLI_INSTALL_HASH commit.');
      console.log('Proceeding to clone the latest main branch into the update directory.');

      await removeDirContents(updateDir);
      await cloneLatestMain(updateDir);
    } else {
      console.log('\x1b[41m\x1b[97m CONFLICTS! \x1b[0m \x1b[34m\nThe following files have been modified or are missing:\x1b[0m');

      missingFiles.forEach((f) => console.log(`  - \x1b[33mMISSING\x1b[0m: ${f}`));

      differentFiles.forEach((f) => console.log(`  - \x1b[31mMODIFIED\x1b[0m: ${f}`));


      const prompt = `
      \x1b[34mChoose action:\x1b[0m
      \x1b[31m- OVERWRITE ALL (O)\x1b[0m
      \x1b[33m- SKIP CONFLICT FILES OVERWRITE THE REST (S)\x1b[0m
      \x1b[34m- EXIT (E)\x1b[0m
      Your choice: `;

      const action = await askYesNo(prompt);

      if (action === 'O' || action === 'S') {
        console.log(`You chose to ${action === 'O' ? 'overwrite' : 'skip'} the update.`);

        await removeDirContents(updateDir);
        await cloneLatestMain(updateDir);

        console.log('Update directory reset with latest main branch.');

      } else {
        console.log('\x1b[34mExiting without changes.\x1b[0m');
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
