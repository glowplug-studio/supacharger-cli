const { exec } = require('child_process');
const fs = require('fs/promises');
const path = require('path');
const readline = require('readline');

function execCommand(command, options = {}) {
  return new Promise((resolve, reject) => {
    const child = exec(command, options, (error, stdout, stderr) => {
      if (error) return reject(error);
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

async function initialise() {
  const cwd = process.cwd();
  const tempDir = path.join(cwd, '.sc-core-install');
  const spinnerFrames = ['|', '/', '-', '\\'];
  let spinnerIndex = 0;
  let spinnerInterval;

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

    spinnerInterval = setInterval(() => {
      process.stdout.write(`\b${spinnerFrames[spinnerIndex]}`);
      spinnerIndex = (spinnerIndex + 1) % spinnerFrames.length;
    }, 100);

    await execCommand(`git clone --depth 1 git@github.com:glowplug-studio/supacharger-demo.git "${tempDir}"`);

    clearInterval(spinnerInterval);
    process.stdout.write('\b'); // Erase spinner
    console.log('Done.');

    await removeGitDir(tempDir);

    console.log('Moving files from temporary folder up to current directory ...');
    await moveAllFilesForce(tempDir, cwd);
    console.log('Files moved successfully.');

    console.log('Initialise completed successfully.');
  } catch (err) {
    if (spinnerInterval) {
      clearInterval(spinnerInterval);
      process.stdout.write('\b'); // Erase spinner
    }
    console.error('Error during initialise:', err);
    process.exit(1);
  }
}

module.exports = initialise;
