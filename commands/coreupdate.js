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
      resolve(answer.trim());
    });
  });
}

// Helper function to repeatedly ask for a valid action
async function askAction(prompt) {
  while (true) {
    const answer = (await askYesNo(prompt)).toUpperCase();
    if (['O', 'S', 'E'].includes(answer)) {
      return answer;
    }
    console.log('\x1b[31mInvalid input. Please enter O, S, or E.\x1b[0m');
  }
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

async function updateCliInstallHash(configPath, newHash) {
  let content = await fs.readFile(configPath, 'utf8');

  const scConfigRegex = /(const\s+SC_CONFIG\s*=\s*{)([\s\S]*?)(^};)/m;
  const cliHashBlock = `
  /**
   * ==========
   * CLI - do not edit
   * ==========
   */
  CLI_INSTALL_HASH: '${newHash}',`;

  const match = content.match(scConfigRegex);
  if (match) {
    let prefix = match[1];
    let body = match[2];
    let suffix = match[3];

    const cliHashRegex = /\n\s*\/\*\*\n\s*\* =+ CLI - do not edit =+\n\s*\* =+\n\s*\*\/\n\s*CLI_INSTALL_HASH\s*:\s*['"`][a-f0-9]+['"`],?/m;

    if (cliHashRegex.test(body)) {
      body = body.replace(cliHashRegex, cliHashBlock);
      console.log(`\x1b[34mUpdated CLI_INSTALL_HASH inside SC_CONFIG in supacharger-config.ts to ${newHash}\x1b[0m`);
    } else {
      body = body.trimEnd() + cliHashBlock + '\n';
      console.log(`\x1b[34mInserted CLI_INSTALL_HASH inside SC_CONFIG in supacharger-config.ts: ${newHash}\x1b[0m`);
    }

    content = content.replace(scConfigRegex, `${prefix}${body}${suffix}`);
  } else {
    content += cliHashBlock + '\n';
    console.log(`\x1b[34mSC_CONFIG not found. Appended CLI_INSTALL_HASH block to supacharger-config.ts: ${newHash}\x1b[0m`);
  }

  await fs.writeFile(configPath, content, 'utf8');
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

async function moveFileToRoot(updateDir, relPath, rootDir) {
  const destPath = path.join(rootDir, relPath);
  const destDir = path.dirname(destPath);
  await fs.mkdir(destDir, { recursive: true });
  await fs.rename(path.join(updateDir, relPath), destPath);
}

// Clone latest main branch fully (used when no conflicts)
async function cloneLatestMain(updateDir) {
  await removeDirContents(updateDir);

  console.log('\x1b[34mProceeding to clone the main branch latest commit  into the update directory.\x1b[0m');

  await execCommand(
    `git clone --depth 1 --branch main git@github.com:glowplug-studio/supacharger-demo.git "${updateDir}"`
  );
  console.log('\x1b[32mLatest main branch cloned.\x1b[0m');
}

async function cloneAndCheckout(updateDir, commitHash) {
  await removeDirContents(updateDir);
  console.log('\x1b[34mCloning main branch CLI_INSTALL_HASH commit...\x1b[0m');
  await execCommand(
    `git clone --no-checkout --branch main git@github.com:glowplug-studio/supacharger-demo.git "${updateDir}"`
  );
  await execCommand(`git -C "${updateDir}" config advice.detachedHead false`);
  console.log(`\x1b[34mChecking out commit ${commitHash}...\x1b[0m`);
  await execCommand(`git -C "${updateDir}" checkout ${commitHash}`);
  await removeGitDir(updateDir);
}

async function moveFiles(updateDir, rootDir, conflictFiles = []) {
  const files = await walkFiles(updateDir);
  for (const relPath of files) {
    if (conflictFiles.includes(relPath)) continue;
    await moveFileToRoot(updateDir, relPath, rootDir);
  }
}

async function coreupdate() {
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
    if (answer.toLowerCase() !== 'y') {
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

    const remoteHash = await getRemoteMainHash();
    console.log(`\x1b[34mLatest remote main branch commit hash:\x1b[0m \x1b[32m${remoteHash}\x1b[0m`);

    if (localHash === remoteHash) {
      console.log('\x1b[32m✓ Local files match the state of the remote CLI_INSTALL_HASH commit.\x1b[0m');
      // Remove old contents, clone latest main, move files up, update hash, remove update dir
      await removeDirContents(updateDir);
      await cloneLatestMain(updateDir);
      await moveFiles(updateDir, cwd);
      await updateCliInstallHash(localConfigPath, remoteHash);
      await fs.rm(updateDir, { recursive: true, force: true });

      console.log('\x1b[32mUpdate complete and .sc-core-update folder removed.\x1b[0m');
      return;
    }

    // Prepare update directory for integrity check
    await fs.rm(updateDir, { recursive: true, force: true });
    await fs.mkdir(updateDir, { recursive: true });
    console.log(`\x1b[34mCreated or cleaned directory:\x1b[0m \x1b[32m${updateDir}\x1b[0m`);

    await cloneAndCheckout(updateDir, localHash);

    console.log('\x1b[34m\nChecking Core Integrity...\x1b[0m');

    const updateFiles = await walkFiles(updateDir);

    const missingFiles = [];
    const differentFiles = [];

    for (const relPath of updateFiles) {
      if (ignoredFiles.includes(relPath)) continue;

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

    if (missingFiles.length === 0 && differentFiles.length === 0) {
      console.log('\x1b[32m✓ Local files match the state of the remote CLI_INSTALL_HASH commit.\x1b[0m');
      // Remove old contents, clone latest main, move files up, update hash, remove update dir
      await removeDirContents(updateDir);
      await cloneLatestMain(updateDir);
      await moveFiles(updateDir, cwd);
      await updateCliInstallHash(localConfigPath, remoteHash);
      await fs.rm(updateDir, { recursive: true, force: true });

      console.log('\x1b[32mUpdate complete and .sc-core-update folder removed.\x1b[0m');
      return;
    }

    console.log(
      '\x1b[41m\x1b[97m CONFLICTS! \x1b[0m \x1b[34m\nThe following core files have been modified or are missing:\x1b[0m'
    );

    missingFiles.forEach((f) => console.log(`  - \x1b[33mMISSING\x1b[0m: ${f}`));
    differentFiles.forEach((f) => console.log(`  - \x1b[31mMODIFIED\x1b[0m: ${f}`));

    const prompt = `
\x1b[34mchoose action:
\x1b[31m(O)\x1b[34m overwrite all
\x1b[33m(S)\x1b[34m skip conflict files overwrite the rest
\x1b[35m(E)\x1b[0m exit
\x1b[34mYour choice: \x1b[0m`;

    const action = await askAction(prompt);

    if (action === 'E') {
      console.log('\x1b[34mExiting without changes.\x1b[0m');
      process.exit(0);
    }

    // Clean update directory and clone latest main branch at latestHash
    await fs.rm(updateDir, { recursive: true, force: true });
    await fs.mkdir(updateDir, { recursive: true });
    await cloneAndCheckout(updateDir, remoteHash);

    // Move files according to action
    if (action === 'O') {
      await moveFiles(updateDir, cwd);
    } else if (action === 'S') {
      await moveFiles(updateDir, cwd, differentFiles);
    }

    // Update CLI_INSTALL_HASH in config to latestHash
    await updateCliInstallHash(localConfigPath, remoteHash);

    // Remove the update directory completely
    await fs.rm(updateDir, { recursive: true, force: true });

    console.log('\x1b[32mUpdate complete and .sc-core-update folder removed.\x1b[0m');
  } catch (err) {
    console.error('Error during coreupdate:', err);
    process.exit(1);
  }
}

module.exports = coreupdate;
