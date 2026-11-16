import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import english from '../messages/en.json';
const copy = english.InitialiseCli;

interface DependencyPrompts {
  confirm: (question: { message: string; default: boolean }) => Promise<boolean>;
}


async function installProjectDependencies(root: string, prompts: DependencyPrompts, run = spawn) {
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

  function runNpm(args: string[], failureMessage: string) {
    return new Promise<void>((resolve, reject) => {
      const child = run(process.platform === 'win32' ? 'npm.cmd' : 'npm', args, { cwd: root, stdio: 'inherit' });
      child.once('error', reject);
      child.once('exit', (code, signal) => {
        if (code === 0) return resolve();
        const error: NodeJS.ErrnoException = new Error(failureMessage);
        if (signal === 'SIGINT' || code === 130) error.code = 'USER_CANCELLED';
        reject(error);
      });
    });
  }
}

export { installProjectDependencies };
