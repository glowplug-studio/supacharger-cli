const { spawn } = require('child_process');
const fs = require('fs/promises');
const path = require('path');
const readline = require('readline');

function promptYesOnly(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise(resolve => {
    rl.question(question, answer => {
      rl.close();
      resolve(answer.trim() === 'Y');
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

    // Regex to find SC_CONFIG object literal start and end (naive approach)
    // We'll look for: const SC_CONFIG = { ... };
    const scConfigRegex = /const\s+SC_CONFIG\s*=\s*{([\s\S]*?)^};/m;

    const match = content.match(scConfigRegex);
    if (!match) {
      console.warn('Warning: Could not find SC_CONFIG object in supacharger-config.ts');
      return;
    }

    let scConfigBody = match[1];

    // Remove any existing CLI_INSTALL_HASH block (comment + property)
    const cliHashBlockRegex = /\n\s*\/\*\*\n\s*\* =+ CLI - do not edit =+\n\s*\* =+\n\s*\*\/\n\s*CLI_INSTALL_HASH\s*:\s*['"`][a-f0-9]+['"`],?\n?/;
    scConfigBody = scConfigBody.replace(cliHashBlockRegex, '');

    // Prepare the new CLI_INSTALL_HASH block with comment and formatting
    const cliHashBlock = `

  /**
   * ==========
   * CLI - do not edit
   * ==========
   */
  CLI_INSTALL_HASH: '${commitHash}',

`;

    // Insert the block at the end before closing brace
    // Remove trailing whitespace/newlines before adding
    scConfigBody = scConfigBody.trimEnd() + cliHashBlock;

    // Rebuild SC_CONFIG declaration
    const newSCConfig = `const SC_CONFIG = {${scConfigBody}};`;

    content = content.replace(scConfigRegex, newSCConfig);

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

/**
 * Runs git clone with spinner animation.
 * Pauses spinner when SSH password prompt is detected.
 */
function gitCloneWithSpinner(repoUrl, targetDir, spinnerFrames) {
  return new Promise((resolve, reject) => {
    let spinnerIndex = 0;
    let spinnerInterval;

    const gitProcess = spawn('git', ['clone', '--depth', '1', repoUrl, targetDir], {
      stdio: ['inherit', 'pipe', 'pipe']
    });

    // Start spinner
    spinnerInterval = setInterval(() => {
      process.stdout.write(`\b${spinnerFrames[spinnerIndex]}`);
      spinnerIndex = (spinnerIndex + 1) % spinnerFrames.length;
    }, 100);

    // Flags to detect password prompt and cloning progress
    let waitingForPassword = false;
    let cloningStarted = false;

    // Listen for stderr data (git prompts password here)
    gitProcess.stderr.on('data', data => {
      const str = data.toString();

      // Detect password prompt (common phrases)
      if (/Enter passphrase for key/.test(str) || /Password for/.test(str)) {
        if (!waitingForPassword) {
          waitingForPassword = true;
          clearInterval(spinnerInterval);
          process.stdout.write('\b'); // Erase spinner
          console.log('\nSSH key password prompt detected. Please enter your password:');
        }
      }
    });

    // Listen for stdout data (cloning progress)
    gitProcess.stdout.on('data', data => {
      if (waitingForPassword) {
        // Password was entered, cloning resumed
        waitingForPassword = false;
        spinnerInterval = setInterval(() => {
          process.stdout.write(`\b${spinnerFrames[spinnerIndex]}`);
          spinnerIndex = (spinnerIndex + 1) % spinnerFrames.length;
        }, 100);
      }
      cloningStarted = true;
    });

    gitProcess.on('error', err => {
      clearInterval(spinnerInterval);
      process.stdout.write('\b');
      reject(err);
    });

    gitProcess.on('close', code => {
      clearInterval(spinnerInterval);
      process.stdout.write('\b'); // Erase spinner
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
  const spinnerFrames = ['|', '/', '-', '\\'];

  try {
    console.log(`Starting initialise in directory: ${cwd}`);

    const proceed = await promptYesOnly(
      'WARNING: I will erase EVERYTHING in this directory except the .git directory. Do you wish to continue? Type Y to confirm: '
    );

    if (!proceed) {
      console.log('Operation cancelled by user.');
      process.exit(0);
    }

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
    process.stdout.write('Cloning in progress... ');

    await gitCloneWithSpinner('git@github.com:glowplug-studio/supacharger-demo.git', tempDir, spinnerFrames);

    console.log('Done.');

    // Get latest commit hash from cloned repo
    const { stdout: commitHash } = await execCommand('git rev-parse HEAD', { cwd: tempDir });
    const trimmedHash = commitHash.trim();

    // Remove .git directory from cloned folder before moving files
    await removeGitDir(tempDir);

    // Update supacharger-config.ts with CLI_INSTALL_HASH property and comment block
    await updateConfigWithCommitHash(tempDir, trimmedHash);

    console.log('Moving files from temporary folder up to current directory ...');
    await moveAllFilesForce(tempDir, cwd);
    console.log('Files moved successfully.');

    console.log('Initialise completed successfully.');
  } catch (err) {
    console.error('Error during initialise:', err);
    process.exit(1);
  }
}

module.exports = initialise;
