const { exec } = require('child_process');
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

async function coreupdate() {
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

    // Define the update directory path relative to current working directory
    const updateDir = path.resolve(process.cwd(), '.sc-core-update');

    // Create the .update directory if it doesn't exist
    await fs.mkdir(updateDir, { recursive: true });
    console.log(`Created or verified directory: ${updateDir}`);

    // Clone the repo into .update, using --depth 1 for latest commit only
    // If the directory is not empty, git clone will fail, so optionally you may want to clean it first
    console.log('Cloning latest commit from git@github.com:glowplug-studio/supacharger-demo.git ...');
    await execCommand(`git clone --depth 1 git@github.com:glowplug-studio/supacharger-demo.git "${updateDir}"`);

    console.log('Repository cloned successfully into .update/');
  } catch (err) {
    console.error('Error during coreupdate:', err);
    process.exit(1);
  }
}

module.exports = coreupdate;
