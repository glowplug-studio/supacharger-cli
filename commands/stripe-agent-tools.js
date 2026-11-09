const { execFile, spawn } = require('node:child_process');

const copy = require('../messages/en.json').StripeAgentToolsCli;

function inspectStripe(run = execFile) {
  return new Promise((resolve, reject) => {
    run('stripe', ['version'], { timeout: 30_000 }, (error, stdout, stderr) => {
      if (error?.code === 'ENOENT') return resolve({ available: false, version: '' });
      if (error) return reject(error);
      resolve({ available: true, version: (stdout || stderr || '').trim().split(/\r?\n/, 1)[0] });
    });
  });
}

async function configureStripeAgentTools(prompts, options = {}) {
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
  await new Promise((resolve, reject) => {
    const child = run('stripe', ['agent', 'setup'], { stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) return resolve();
      const error = new Error(copy.Failed.replace('{status}', signal || String(code)));
      if (signal === 'SIGINT' || code === 130) error.code = 'USER_CANCELLED';
      reject(error);
    });
  });
  console.log(copy.Complete);
  return { selected: true, configured: true, version: status.version };
}

module.exports = { configureStripeAgentTools, inspectStripe };
