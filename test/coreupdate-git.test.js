const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawn } = require('node:child_process');
const test = require('node:test');
const { installMissingDeveloperStarters } = require('../commands/coreupdate').testHelpers;

async function temporaryDirectory(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'coreupdate-git-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}

const loader = 'src/assets/svgr/ui/image-loader.svg';
const projectTailwindConfig = 'tailwind.project.config.ts';
test('image loader is installed once and customised artwork survives upgrades', async (t) => {
  const root = await temporaryDirectory(t);
  const incoming = path.join(root, 'incoming');
  const project = path.join(root, 'project');
  await fs.mkdir(path.dirname(path.join(incoming, loader)), { recursive: true });
  await fs.writeFile(path.join(incoming, loader), '<svg viewBox="0 0 10 10"/>');
  assert.deepEqual(await installMissingDeveloperStarters(incoming, project), [loader]);
  assert.equal(await fs.readFile(path.join(project, loader), 'utf8'), '<svg viewBox="0 0 10 10"/>');
  await fs.writeFile(path.join(project, loader), 'custom artwork');
  assert.deepEqual(await installMissingDeveloperStarters(incoming, project), []);
  assert.equal(await fs.readFile(path.join(project, loader), 'utf8'), 'custom artwork');
});

test('blank project Tailwind configuration is installed once and then preserved', async (t) => {
  const root = await temporaryDirectory(t);
  const incoming = path.join(root, 'incoming');
  const project = path.join(root, 'project');
  await fs.mkdir(incoming);
  await fs.writeFile(path.join(incoming, projectTailwindConfig), 'module.exports = {};\n');
  assert.deepEqual(await installMissingDeveloperStarters(incoming, project), [projectTailwindConfig]);
  await fs.writeFile(path.join(project, projectTailwindConfig), 'module.exports = { plugins: [plugin] };\n');
  assert.deepEqual(await installMissingDeveloperStarters(incoming, project), []);
  assert.equal(
    await fs.readFile(path.join(project, projectTailwindConfig), 'utf8'),
    'module.exports = { plugins: [plugin] };\n',
  );
});

for (const drift of [false, true]) {
  test(`Git update pins the resolved commit when main moves (${drift ? 'conflicting' : 'clean'} consumer)`, { timeout: 30000 }, async (t) => {
    const root = await temporaryDirectory(t);
    const source = path.join(root, 'remote');
    const project = path.join(root, 'project');
    const bin = path.join(root, 'bin');
    for (const dir of [source, project, bin]) await fs.mkdir(dir);
    const git = (...args) => execFileSync('/usr/bin/git', args, { cwd: source, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    git('init', '-b', 'main');
    git('config', 'user.name', 'CLI test');
    git('config', 'user.email', 'cli-test@example.invalid');
    git('config', 'commit.gpgsign', 'false');
    await fs.mkdir(path.join(source, '.supacharger'));
    await fs.mkdir(path.join(source, 'src/supacharger'), { recursive: true });
    await fs.mkdir(path.dirname(path.join(source, loader)), { recursive: true });
    await fs.writeFile(path.join(source, '.supacharger/managed-files.json'), JSON.stringify({
      version: 2, managedPaths: ['.supacharger/managed-files.json', 'src/supacharger'],
      mergeManagedPaths: ['package.json'], forwardOnlyMigrationPaths: [],
      developerOwnedPaths: [loader], postUpdateChecks: ['verify'],
    }));
    await fs.writeFile(path.join(source, 'package.json'), JSON.stringify({ name: 'cli-fixture', scripts: { verify: 'node check.cjs' } }));
    await fs.writeFile(path.join(source, loader), 'canonical artwork');
    await fs.writeFile(path.join(source, 'src/supacharger.config.ts'), 'export const SC_CONFIG = {\n  MARKETING_SITE_URL: null,\n  PROFILE_IDENTITY: {\n    USERNAME: \'optional\',\n  },\n  POST_SIGN_IN_ONBOARDING: {\n    REQUIRED: false,\n  },\n  BILLING_ACCESS: {\n    REQUIRED: false,\n  },\n  BILLING: {\n    AUTOMATIC_TAX: false,\n  },\n  AUTHENTICATION: {\n  },\n  AUTH_PROVDERS_ENABLED: {\n    google: false,\n  },\n};\n');
    const managed = path.join(source, 'src/supacharger/version.txt');
    await fs.writeFile(managed, 'baseline');
    git('add', '.'); git('commit', '-m', 'baseline');
    const baseline = git('rev-parse', 'HEAD');
    await fs.cp(source, project, { recursive: true, filter: (entry) => !entry.split(path.sep).includes('.git') });
    await fs.writeFile(path.join(project, '.supacharger/core-lock.json'), JSON.stringify({ repository: 'glowplug-studio/supacharger', commit: baseline }));
    await fs.writeFile(path.join(project, 'check.cjs'), "const fs = require('node:fs'); require('node:assert/strict').equal(fs.readFileSync('src/supacharger/version.txt', 'utf8'), 'requested'); fs.writeFileSync('checks-passed.txt', 'yes');");
    if (drift) {
      await fs.writeFile(path.join(project, 'src/supacharger/version.txt'), 'local drift');
      await fs.writeFile(path.join(project, loader), 'custom artwork');
    } else {
      await fs.rm(path.join(project, loader));
    }
    await fs.writeFile(managed, 'requested');
    git('add', '.'); git('commit', '-m', 'requested');
    const requested = git('rev-parse', 'HEAD');
    await fs.writeFile(managed, 'later branch update');
    git('add', '.'); git('commit', '-m', 'later');
    const later = git('rev-parse', 'HEAD');
    git('update-ref', 'refs/heads/main', requested);
    // Move the branch after ls-remote resolves it, before the CLI clones/fetches.
    await fs.writeFile(path.join(bin, 'git'), `#!/usr/bin/env node
const {spawnSync} = require('node:child_process');
const args = process.argv.slice(2);
const result = spawnSync('/usr/bin/git', args, {encoding:'utf8'});
if (args[0] === 'ls-remote' && result.status === 0) {
  const moved = spawnSync('/usr/bin/git', ['-C', process.env.CLI_TEST_REMOTE, 'update-ref', 'refs/heads/main', process.env.CLI_TEST_LATER]);
  if (moved.status !== 0) process.exit(99);
}
process.stdout.write(result.stdout || ''); process.stderr.write(result.stderr || ''); process.exit(result.status ?? 1);
`, { mode: 0o755 });
    const env = {
      ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`,
      GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: `url.file://${source}.insteadOf`,
      GIT_CONFIG_VALUE_0: 'git@github.com:glowplug-studio/supacharger.git',
      GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null',
      CLI_TEST_REMOTE: source, CLI_TEST_LATER: later,
    };
    const child = spawn(process.execPath, [path.resolve(__dirname, '../bin/cli.js'), 'coreupdate', '--ref', 'main'], { cwd: project, env });
    t.after(() => { if (child.exitCode === null) child.kill(); });
    let output = ''; let started = false; let conflictAnswered = false;
    const collect = (chunk) => {
      output += chunk.toString();
      if (!started && output.includes('Enter Y to continue:')) { started = true; if (drift) child.stdin.write('Y\n'); else child.stdin.end('Y\n'); }
      if (!conflictAnswered && output.includes('Your choice:')) { conflictAnswered = true; child.stdin.end('OB\n'); }
    };
    child.stdout.on('data', collect); child.stderr.on('data', collect);
    const code = await new Promise((resolve, reject) => { child.on('error', reject); child.on('close', resolve); });
    assert.equal(code, 0, output);
    assert.equal(conflictAnswered, drift, output);
    assert.equal(git('rev-parse', 'refs/heads/main'), later);
    assert.equal(JSON.parse(await fs.readFile(path.join(project, '.supacharger/core-lock.json'), 'utf8')).commit, requested);
    assert.equal(await fs.readFile(path.join(project, 'src/supacharger/version.txt'), 'utf8'), 'requested');
    assert.equal(await fs.readFile(path.join(project, 'checks-passed.txt'), 'utf8'), 'yes');
    assert.equal(await fs.readFile(path.join(project, loader), 'utf8'), drift ? 'custom artwork' : 'canonical artwork');
    if (drift) {
      const backups = await fs.readdir(path.join(project, '.supacharger/backups'));
      assert.equal(await fs.readFile(path.join(project, '.supacharger/backups', backups[0], 'src/supacharger/version.txt'), 'utf8'), 'local drift');
    }
  });
}
