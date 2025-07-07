const { spawn, exec } = require('child_process');
const fs = require('fs/promises');
const path = require('path');
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
      console.log('Removed .git directory from cloned folder.');
    }
  } catch {
    // .git does not exist, no action needed
  }
}

async function updateConfigWithCommitHash(cloneDir, commitHash) {
  const configPath = path.join(cloneDir, 'src', 'supacharger', 'supacharger-config.ts');

  try {
    let content = await fs.readFile(configPath, 'utf8');

    // Regex to find SC_CONFIG object including multiline content
    const scConfigRegex = /const\s+SC_CONFIG\s*=\s*{([\s\S]*?)^};/m;

    const match = content.match(scConfigRegex);
    if (!match) {
      console.warn('Warning: Could not find SC_CONFIG object in supacharger-config.ts');
      return;
    }

    let scConfigBody = match[1];

    // Regex to find existing CLI_INSTALL_HASH block inside SC_CONFIG
    const cliHashBlockRegex = /\n\s*\/\*\*\n\s*\* =+ CLI - do not edit =+\n\s*\* =+\n\s*\*\/\n\s*CLI_INSTALL_HASH\s*:\s*['"`][a-f0-9]+['"`],?\n?/;

    // Remove existing CLI_INSTALL_HASH block if any
    scConfigBody = scConfigBody.replace(cliHashBlockRegex, '');

    // Define the CLI_INSTALL_HASH block to add
    const cliHashBlock = `

  /**
   * ==========
   * CLI - do not edit
   * ==========
   */
  CLI_INSTALL_HASH: '${commitHash}',

`;

    // Append the CLI_INSTALL_HASH block at the end of SC_CONFIG body
    scConfigBody = scConfigBody.trimEnd() + cliHashBlock;

    // Rebuild the SC_CONFIG object
    const newSCConfig = `const SC_CONFIG = {${scConfigBody}};`;

    // Replace old SC_CONFIG object with new one in the file content
    content = content.replace(scConfigRegex, newSCConfig);

    // Write updated content back to file
    await fs.writeFile(configPath, content, 'utf8');
    console.log(`Updated ${path.relative(cloneDir, configPath)} with CLI_INSTALL_HASH: ${commitHash}`);
  } catch (err) {
    console.warn(`Warning: Failed to update supacharger-config.ts: ${err.message}`);
  }
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

async function initialise() {
  const cwd = process.cwd();
  const tempDir = path.join(cwd, '.sc-core-install');

  try {
    console.log(`Starting initialise in directory: ${cwd}`);

    await promptYesOnly(
      '\x1b[41m\x1b[97mWARNING:\x1b[0m\x1b[33m I will erase EVERYTHING in this directory except the .git directory. Do you wish to continue? Type Y to confirm: \x1b[0m'
    );

    console.log('Deleting all files and folders except .git ...');
    await removeAllExceptGit(cwd);
    console.log('Cleanup complete.');

    try {
      await fs.access(tempDir);
      console.log(`Removing existing temporary folder: ${tempDir}`);
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // tempDir does not exist, no action needed
    }

    console.log(`Cloning repository into temporary folder '${tempDir}' ...`);
    await gitClone('git@github.com:glowplug-studio/supacharger-demo.git', tempDir);

    console.log('Done.');

    const { stdout: commitHash } = await execCommand('git rev-parse HEAD', { cwd: tempDir });
    const trimmedHash = commitHash.trim();

    await removeGitDir(tempDir);

    await updateConfigWithCommitHash(tempDir, trimmedHash);

    console.log('Moving files from temporary folder up to current directory ...');
    await moveAllFilesForce(tempDir, cwd);
    console.log('Files moved successfully.');

    console.log('Initialise completed successfully. You should now commit changes to your main branch.');
  } catch (err) {
    if (err.message === 'Cancelled by user') {
      console.log('\x1b[33mOperation cancelled by user.\x1b[0m');
      process.exit(0);
    }
    console.error('Error during initialise:', err);
    process.exit(1);
  }
}

module.exports = initialise;
