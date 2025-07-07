const { exec } = require('child_process');
const path = require('path');

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

async function initialise() {
  const cwd = process.cwd();
  const spinnerFrames = ['|', '/', '-', '\\'];
  let spinnerIndex = 0;
  let spinnerInterval;

  try {
    process.stdout.write(`Cloning latest commit from git@github.com:glowplug-studio/supacharger-demo.git into ${cwd} ... `);

    // Start spinner animation
    spinnerInterval = setInterval(() => {
      process.stdout.write(`\b${spinnerFrames[spinnerIndex]}`);
      spinnerIndex = (spinnerIndex + 1) % spinnerFrames.length;
    }, 100);

    // Run git clone with depth 1 for latest commit only
    await execCommand(`git clone --depth 1 git@github.com:glowplug-studio/supacharger-demo.git "${cwd}"`);

    clearInterval(spinnerInterval);
    process.stdout.write('\b'); // Erase spinner
    console.log('Repository cloned successfully.');
  } catch (err) {
    if (spinnerInterval) clearInterval(spinnerInterval);
    process.stdout.write('\b'); // Erase spinner
    console.error('Error during initialise:', err);
    process.exit(1);
  }
}

module.exports = initialise;
