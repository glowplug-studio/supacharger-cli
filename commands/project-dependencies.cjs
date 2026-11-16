const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
const copy = require('../messages/en.json').InitialiseCli;

async function installProjectDependencies(root, prompts, run = spawn) {
  if (!await prompts.confirm({ message: `${copy.InstallDependenciesQuestion}\n`, default: true })) {
    console.log(copy.DependenciesSkipped);
    return false;
  }
  const locked = await fs.stat(path.join(root, 'package-lock.json')).then(() => true, error => {
    if (error.code === 'ENOENT') return false;
    throw error;
  });
  const args = locked ? ['ci'] : ['install'];
  console.log(copy.InstallDependenciesRunning.replace('{command}', `npm ${args[0]}`));
  await runNpm(args, copy.DependenciesFailed);
  const manifest = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
  if (manifest.scripts?.['setup:ui']) await runNpm(['run', 'setup:ui'], copy.UiSetupFailed);
  return true;

  function runNpm(args, failureMessage) {
    return new Promise((resolve, reject) => {
      const child = run(process.platform === 'win32' ? 'npm.cmd' : 'npm', args, { cwd: root, stdio: 'inherit' });
      child.once('error', reject);
      child.once('exit', (code, signal) => {
        if (code === 0) return resolve();
        const error = new Error(failureMessage);
        if (signal === 'SIGINT' || code === 130) error.code = 'USER_CANCELLED';
        reject(error);
      });
    });
  }
}

module.exports = { installProjectDependencies };
