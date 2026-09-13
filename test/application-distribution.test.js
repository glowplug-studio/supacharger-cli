const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { prepareStarter, cleanScripts } = require('../commands/common/test-distribution');
const { installMissingDeveloperStarters, mergeDependencyContract } = require('../commands/coreupdate').testHelpers;

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sc-distribution-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}
async function write(root, name, contents = '') {
  await fs.mkdir(path.dirname(path.join(root, name)), { recursive: true });
  await fs.writeFile(path.join(root, name), contents);
}

test('starter export removes nested maintainer tests but preserves skills and runtime source', async t => {
  const root = await fixture(t);
  for (const name of ['test/application.test.mjs', 'tools/mcp/test/server.test.js', 'extensions/brevo/send.test.mjs', 'supabase/tests/contract.sql', 'fixtures/example.json', 'src/main.ts', '.agents/skills/example/test/fixture.md']) await write(root, name);
  await write(root, 'tools/mcp/package.json', JSON.stringify({ scripts: { test: 'node --test', start: 'node index.js' } }));
  await prepareStarter(root);
  for (const name of ['test', 'tools/mcp/test', 'extensions/brevo/send.test.mjs', 'supabase/tests', 'fixtures']) await assert.rejects(fs.access(path.join(root, name)));
  await fs.access(path.join(root, 'src/main.ts'));
  await fs.access(path.join(root, '.agents/skills/example/test/fixture.md'));
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(root, 'tools/mcp/package.json'))).scripts, { start: 'node index.js' });
});

test('package updates remove test scripts while preserving direct validators and product commands', async t => {
  const root = await fixture(t);
  const scripts = { 'test:auth': 'node --test test/auth.mjs', 'db:test': 'supabase test db', 'check:old': 'node --test test/old.mjs', 'check:i18n-english': 'node scripts/check-i18n-english.mjs', build: 'next build', deploy: 'deploy-to-test-environment' };
  await write(root, 'package.json', JSON.stringify({ scripts }));
  await mergeDependencyContract(root, {});
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(root, 'package.json'))).scripts, { 'check:i18n-english': scripts['check:i18n-english'], build: 'next build', deploy: 'deploy-to-test-environment' });
  assert.deepEqual(cleanScripts({ test: 'custom-runner', lint: 'eslint .' }), { lint: 'eslint .' });
});

test('updates install missing technical references and preserve existing product references', async t => {
  const root = await fixture(t);
  const incoming = path.join(root, 'incoming');
  const app = path.join(root, 'app');
  await write(incoming, 'docs/agents/agent-guidance.md', 'new index');
  await write(incoming, 'docs/agents/billing.md', 'Core billing');
  await write(app, 'docs/agents/billing.md', 'Product billing');
  const installed = await installMissingDeveloperStarters(incoming, app);
  assert.ok(installed.includes('docs/agents/agent-guidance.md'));
  assert.equal(await fs.readFile(path.join(app, 'docs/agents/billing.md'), 'utf8'), 'Product billing');
  assert.deepEqual(await installMissingDeveloperStarters(incoming, app), []);
});

const { execFileSync } = require('node:child_process');

test('application initialisation allows committing skills while retaining unrelated ignores', async t => {
  const root = await fixture(t);
  await write(root, '.gitignore', '/node_modules/\n# BEGIN SUPACHARGER CORE-ONLY SKILLS\n/.agents/skills/\n/.supacharger/skills-lock.json\n/skills-lock.json\n# END SUPACHARGER CORE-ONLY SKILLS\n/.env.local\n');
  execFileSync('git', ['init', '-q', root]);
  await prepareStarter(root);
  for (const name of ['.agents/skills/example/SKILL.md', '.supacharger/skills-lock.json', 'skills-lock.json']) {
    await write(root, name, '{}');
    execFileSync('git', ['-C', root, 'add', '--', name]);
  }
  const tracked = execFileSync('git', ['-C', root, 'ls-files'], { encoding: 'utf8' });
  assert.ok(tracked.includes('.agents/skills/example/SKILL.md'));
  assert.equal(execFileSync('git', ['-C', root, 'check-ignore', '.env.local'], { encoding: 'utf8' }).trim(), '.env.local');
  await prepareStarter(root);
  assert.ok((await fs.readFile(path.join(root, '.gitignore'), 'utf8')).includes('/node_modules/'));
});


test('email branding ships initially and remains outside updates', async t => {
  const root = await fixture(t);
  const logo = 'public/images/email-template/email-logo.png';
  await write(root, logo, 'custom logo');
  await prepareStarter(root);
  assert.equal(await fs.readFile(path.join(root, logo), 'utf8'), 'custom logo');
  const { managedFiles } = require('../commands/coreupdate').testHelpers;
  assert.ok(!(await managedFiles(root, null)).includes(logo));
  const manifest = { managedPaths: ['public'], developerOwnedPaths: ['public/images/email-template'] };
  assert.ok(!(await managedFiles(root, manifest)).includes(logo));
  const incoming = await fixture(t);
  await write(incoming, logo, 'upstream logo');
  await installMissingDeveloperStarters(incoming, root);
  assert.equal(await fs.readFile(path.join(root, logo), 'utf8'), 'custom logo');
  const empty = await fixture(t);
  await installMissingDeveloperStarters(incoming, empty);
  await assert.rejects(fs.access(path.join(empty, logo)));
});
