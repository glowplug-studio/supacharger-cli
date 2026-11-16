import { execFile, spawn, type ExecFileException } from 'node:child_process';
import type { Prompts } from './environment';
import type { SpawnRunner } from './ai-sdk';
import english from '../messages/en.json';

type InspectRunner = (command: string, args: string[], options: { timeout: number }, callback: (error: ExecFileException | null, stdout: string, stderr: string) => void) => unknown;
type StripeStatus = { available: boolean; version: string };

const copy = english.StripeAgentToolsCli;

function inspectStripe(run: InspectRunner = execFile) {
  return new Promise<StripeStatus>((resolve, reject) => {
    run('stripe', ['version'], { timeout: 30_000 }, (error, stdout, stderr) => {
      if (error?.code === 'ENOENT') return resolve({ available: false, version: '' });
      if (error) return reject(error);
      resolve({ available: true, version: (stdout || stderr || '').trim().split(/\r?\n/, 1)[0] });
    });
  });
}

async function configureStripeAgentTools(prompts: Pick<Prompts, 'confirm'>, options: { inspectRun?: InspectRunner; spawnRun?: SpawnRunner } = {}) {
  const selected = await prompts.confirm({ message: `${copy.Question}\n`, default: false });
  if (!selected) return { selected: false, configured: false };

  const status = await inspectStripe(options.inspectRun);
  if (!status.available) {
    console.log(copy.Missing);
    return { selected: true, configured: false, missing: true };
  }

  console.log(copy.Found.replace('{version}', status.version || copy.VersionUnknown));
  console.log(copy.Running);
  const run = options.spawnRun ?? spawn;
  await new Promise<void>((resolve, reject) => {
    const child = run('stripe', ['agent', 'setup'], { stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) return resolve();
      const error: Error & { code?: string } = new Error(copy.Failed.replace('{status}', signal || String(code)));
      if (signal === 'SIGINT' || code === 130) error.code = 'USER_CANCELLED';
      reject(error);
    });
  });
  console.log(copy.Complete);
  return { selected: true, configured: true, version: status.version };
}

export { configureStripeAgentTools, inspectStripe };
