const { spawn } = require('node:child_process');

const copy = require('../messages/en.json').AiSdkCli;

const AI_SDK_PACKAGES = [
  'ai@7.0.173',
  '@ai-sdk/react@4.0.177',
];

async function configureAiSdk(root, prompts, run = spawn) {
  const selected = await prompts.confirm({
    message: `${copy.Question}\n`,
    default: false,
  });
  if (!selected) {
    console.log(copy.Skipped);
    return false;
  }

  const args = ['install', '--save-exact', ...AI_SDK_PACKAGES];
  console.log(copy.Installing);
  await new Promise((resolve, reject) => {
    const child = run(process.platform === 'win32' ? 'npm.cmd' : 'npm', args, {
      cwd: root,
      stdio: 'inherit',
    });
    child.once('error', () => reject(new Error(copy.InstallFailed.replace('{command}', npmInstallCommand()))));
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      const error = new Error(copy.InstallFailed.replace('{command}', npmInstallCommand()));
      if (signal === 'SIGINT' || code === 130) error.code = 'USER_CANCELLED';
      reject(error);
    });
  });
  console.log(copy.Installed);
  return true;
}

function npmInstallCommand() {
  return `npm install --save-exact ${AI_SDK_PACKAGES.join(' ')}`;
}

module.exports = {
  AI_SDK_PACKAGES,
  configureAiSdk,
  npmInstallCommand,
};
