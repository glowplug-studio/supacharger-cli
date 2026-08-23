const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const coreupdate = require('../commands/coreupdate');

const {
  assessPostUpdateWork,
  buildUpdatePlan,
  changedManualMergePaths,
  detectPackageManager,
  installMissingDeveloperStarters,
  matchingPreservedPath,
  migrateAuthProviderConfig,
  migrateLegacyAuthSessionConfig,
  migrateLegacyConfig,
  migrateLegacyPostcssConfig,
  migrateLegacyProjectStyles,
  migrateLegacyAuthRoutes,
  migrateRootDocumentConfig,
  moveFiles,
  managedFiles,
  managedFileHashes,
  personaliseStarterProjectStyles,
  readInstallState,
  readManagedManifest,
  removeObsoleteManagedFiles,
  runPostUpdateChecks,
  runPostUpdateSteps,
  verifyManagedFiles,
  writeCoreLock,
} = coreupdate.testHelpers;

const legacyCommit = 'c4bcd3fda8b7e68c5b33708930c62a626971f51c';

async function temporaryDirectory(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'supacharger-cli-test-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}

test('migrates legacy application settings out of the protected core', async (t) => {
  const root = await temporaryDirectory(t);
  const legacyPath = path.join(root, 'src', 'supacharger', 'supacharger-config.ts');
  await fs.mkdir(path.dirname(legacyPath), { recursive: true });
  await fs.writeFile(
    legacyPath,
    `export const SC_CONFIG = {
  SITE_TITLE: 'Developer title',
  /**
   * ==========
   * CLI - do not edit
   * ==========
   */
  CLI_INSTALL_HASH: '${legacyCommit}',
};
`,
    'utf8'
  );

  const legacyState = await readInstallState(root);
  assert.deepEqual(legacyState, {
    commit: legacyCommit,
    repository: 'glowplug-studio/supacharger-demo',
  });

  await migrateLegacyConfig(root);
  const migratedConfig = await fs.readFile(path.join(root, 'src', 'supacharger.config.ts'), 'utf8');
  assert.match(migratedConfig, /Developer title/);
  assert.doesNotMatch(migratedConfig, /CLI_INSTALL_HASH/);
});

test('stores installation metadata independently from application settings', async (t) => {
  const root = await temporaryDirectory(t);
  const commit = '207603866aabc6fc1de82ec3fab256753cf8e9d8';

  await writeCoreLock(root, commit);

  assert.deepEqual(await readInstallState(root), {
    commit,
    repository: 'glowplug-studio/supacharger',
  });
});

test('removes the legacy configurable auth verification mode', async (t) => {
  const root = await temporaryDirectory(t);
  const configPath = path.join(root, 'src', 'supacharger.config.ts');
  await fs.mkdir(path.dirname(configPath), { recursive: true });
  await fs.writeFile(
    configPath,
    "AUTH_SESSION: {\n  VERIFICATION_MODE: 'user',\n  ALLOW_ANONYMOUS_USERS: false,\n},\n",
    'utf8'
  );

  assert.deepEqual(await migrateLegacyAuthSessionConfig(root, { plan: true }), [
    'AUTH_SESSION.VERIFICATION_MODE',
  ]);
  await migrateLegacyAuthSessionConfig(root, { backup: false });

  const migrated = await fs.readFile(configPath, 'utf8');
  assert.doesNotMatch(migrated, /VERIFICATION_MODE/);
  assert.match(migrated, /ALLOW_ANONYMOUS_USERS: false/);
});

test('migrates a legacy developer stylesheet to the project style seam', async (t) => {
  const root = await temporaryDirectory(t);
  const legacyPath = path.join(root, 'src', 'styles', 'globals.css');
  await fs.mkdir(path.dirname(legacyPath), { recursive: true });
  await fs.writeFile(path.join(root, 'package.json'), '{"name":"example-application"}\n', 'utf8');
  await fs.writeFile(legacyPath, '.product-banner { color: rebeccapurple; }\n', 'utf8');

  await migrateLegacyProjectStyles(root);

  const migrated = await fs.readFile(path.join(root, 'src', 'styles', 'project.css'), 'utf8');
  assert.match(migrated, /Project: example-application/);
  assert.match(migrated, /product-banner/);
});

test('backs up and removes only the known legacy PostCSS configuration', async (t) => {
  const root = await temporaryDirectory(t);
  await fs.writeFile(
    path.join(root, 'postcss.config.js'),
    "module.exports = {\n  plugins: {\n    '@tailwindcss/postcss': {},\n  },\n};\n",
    'utf8',
  );

  assert.equal(await migrateLegacyPostcssConfig(root, { plan: true }), true);
  assert.equal(await migrateLegacyPostcssConfig(root), true);
  await assert.rejects(fs.access(path.join(root, 'postcss.config.js')));

  const backups = await fs.readdir(path.join(root, '.supacharger', 'backups'));
  assert.equal(backups.length, 1);
  assert.equal(
    await fs.readFile(path.join(root, '.supacharger', 'backups', backups[0], 'postcss.config.js'), 'utf8'),
    "module.exports = {\n  plugins: {\n    '@tailwindcss/postcss': {},\n  },\n};\n",
  );
});

test('preserves a customised legacy PostCSS configuration for manual migration', async (t) => {
  const root = await temporaryDirectory(t);
  await fs.writeFile(path.join(root, 'postcss.config.js'), 'module.exports = { plugins: { autoprefixer: {} } };\n');

  await assert.rejects(migrateLegacyPostcssConfig(root), /contains application changes/);
  assert.match(await fs.readFile(path.join(root, 'postcss.config.js'), 'utf8'), /autoprefixer/);
});

test('preserves existing developer-owned files while moving an update', async (t) => {
  const root = await temporaryDirectory(t);
  const update = await temporaryDirectory(t);
  const developerFiles = [
    'src/supacharger.config.ts',
    path.join('src', 'app', 'layout.tsx'),
    path.join('src', 'i18n', 'config.ts'),
    path.join('src', 'i18n', 'request.ts'),
    path.join('src', 'assets', 'svgr', 'ui', 'inline-loader-dark.svg'),
    path.join('src', 'assets', 'svgr', 'ui', 'inline-loader.svg'),
    'src/styles/project.css',
  ];

  for (const relativePath of developerFiles) {
    const localFile = path.join(root, relativePath);
    const incomingFile = path.join(update, relativePath);
    await fs.mkdir(path.dirname(localFile), { recursive: true });
    await fs.mkdir(path.dirname(incomingFile), { recursive: true });
    await fs.writeFile(localFile, `developer ${relativePath}\n`, 'utf8');
    await fs.writeFile(incomingFile, `template ${relativePath}\n`, 'utf8');
  }

  await moveFiles(update, root, developerFiles);

  for (const relativePath of developerFiles) {
    assert.equal(
      await fs.readFile(path.join(root, relativePath), 'utf8'),
      `developer ${relativePath}\n`
    );
  }
});

test('updates the protected configuration contract while preserving application values', async (t) => {
  const root = await temporaryDirectory(t);
  const update = await temporaryDirectory(t);
  const developerConfig = path.join('src', 'supacharger.config.ts');
  const contract = path.join('src', 'supacharger', 'supacharger-config-contract.ts');

  await fs.mkdir(path.dirname(path.join(root, developerConfig)), { recursive: true });
  await fs.mkdir(path.dirname(path.join(root, contract)), { recursive: true });
  await fs.mkdir(path.dirname(path.join(update, developerConfig)), { recursive: true });
  await fs.mkdir(path.dirname(path.join(update, contract)), { recursive: true });
  await fs.writeFile(path.join(root, developerConfig), 'application values\n', 'utf8');
  await fs.writeFile(path.join(root, contract), 'old contract\n', 'utf8');
  await fs.writeFile(path.join(update, developerConfig), 'starter values\n', 'utf8');
  await fs.writeFile(path.join(update, contract), 'canonical contract\n', 'utf8');

  await moveFiles(update, root, [developerConfig]);

  assert.equal(await fs.readFile(path.join(root, developerConfig), 'utf8'), 'application values\n');
  assert.equal(await fs.readFile(path.join(root, contract), 'utf8'), 'canonical contract\n');
});

test('updates managed access helpers without moving developer-owned recovery routes or configuration', async (t) => {
  const root = await temporaryDirectory(t);
  const update = await temporaryDirectory(t);
  const preservedPaths = [
    path.join('src', 'app', '(project)'),
    path.join('src', 'supacharger.config.ts'),
  ];
  const developerFiles = [
    path.join('src', 'app', '(project)', '(authenticated)', 'account', 'setup-profile', 'page.tsx'),
    path.join('src', 'app', '(project)', '(authenticated)', 'account', 'billing', 'subscribe', 'page.tsx'),
    path.join('src', 'supacharger.config.ts'),
  ];
  const managedHelper = path.join('src', 'supacharger', 'auth', 'server-access.ts');

  for (const relativePath of developerFiles) {
    await fs.mkdir(path.dirname(path.join(root, relativePath)), { recursive: true });
    await fs.mkdir(path.dirname(path.join(update, relativePath)), { recursive: true });
    await fs.writeFile(path.join(root, relativePath), `developer ${relativePath}\n`);
    await fs.writeFile(path.join(update, relativePath), `starter ${relativePath}\n`);
  }
  await fs.mkdir(path.dirname(path.join(root, managedHelper)), { recursive: true });
  await fs.mkdir(path.dirname(path.join(update, managedHelper)), { recursive: true });
  await fs.writeFile(path.join(root, managedHelper), 'old helper\n');
  await fs.writeFile(path.join(update, managedHelper), 'three-level helper\n');

  await moveFiles(update, root, preservedPaths);

  for (const relativePath of developerFiles) {
    assert.equal(await fs.readFile(path.join(root, relativePath), 'utf8'), `developer ${relativePath}\n`);
  }
  assert.equal(await fs.readFile(path.join(root, managedHelper), 'utf8'), 'three-level helper\n');
});

test('adds disabled social OAuth defaults without changing existing provider values', async (t) => {
  const root = await temporaryDirectory(t);
  const configPath = path.join(root, 'src', 'supacharger.config.ts');
  await fs.mkdir(path.dirname(configPath), { recursive: true });
  await fs.writeFile(
    configPath,
    `export const SC_CONFIG = {
  AUTH_PROVDERS_ENABLED: {
    google: true,
    facebook: false,
  },
};
`,
    'utf8'
  );

  const planned = await migrateAuthProviderConfig(root, { plan: true });
  assert.ok(planned.includes('apple'));
  assert.doesNotMatch(await fs.readFile(configPath, 'utf8'), /apple:\s*false/);

  const migratedKeys = await migrateAuthProviderConfig(root, { backup: false });
  const migrated = await fs.readFile(configPath, 'utf8');
  assert.deepEqual(migratedKeys, planned);
  assert.match(migrated, /google:\s*true/);
  assert.match(migrated, /facebook:\s*false/);
  assert.match(migrated, /apple:\s*false/);
  assert.match(migrated, /linkedin_oidc:\s*false/);
  assert.match(migrated, /slack_oidc:\s*false/);
  assert.match(migrated, /zoom:\s*false/);
  assert.deepEqual(await migrateAuthProviderConfig(root, { backup: false }), []);
});

test('adds root document defaults without replacing application branding', async (t) => {
  const root = await temporaryDirectory(t);
  const configPath = path.join(root, 'src', 'supacharger.config.ts');
  await fs.mkdir(path.dirname(configPath), { recursive: true });
  await fs.mkdir(path.join(root, 'public', 'favicons'), { recursive: true });
  await Promise.all(
    [
      'favicon.ico',
      path.join('favicons', 'favicon.svg'),
      path.join('favicons', 'favicon-96x96.png'),
      path.join('favicons', 'apple-touch-icon.png'),
      path.join('favicons', 'web-app-manifest-192x192.png'),
      path.join('favicons', 'web-app-manifest-512x512.png'),
      path.join('favicons', 'site.webmanifest'),
    ].map(
      (file) => fs.writeFile(path.join(root, 'public', file), file)
    )
  );
  await fs.writeFile(
    configPath,
    `export const SC_CONFIG = {
  SITE_TITLE: 'Example App',
  MARKETING_SITE_URL: null,
};
`,
    'utf8'
  );

  const planned = await migrateRootDocumentConfig(root, { plan: true });
  assert.deepEqual(planned, ['METADATA', 'ROOT_PROVIDERS', 'ANALYTICS']);
  assert.doesNotMatch(await fs.readFile(configPath, 'utf8'), /TITLE_TEMPLATE/);

  await migrateRootDocumentConfig(root, { backup: false });
  const migrated = await fs.readFile(configPath, 'utf8');
  assert.match(migrated, /SITE_TITLE: 'Example App'/);
  assert.match(migrated, /TITLE_TEMPLATE: '%s \| Example App'/);
  assert.match(migrated, /FAVICON_SET_ENABLED: true/);
  assert.match(migrated, /NEXT_PUBLIC_GOOGLE_ANALYTICS_ID/);
  assert.deepEqual(await migrateRootDocumentConfig(root, { backup: false }), []);
});

test('preserves the complete developer-owned messages directory', async (t) => {
  const root = await temporaryDirectory(t);
  const update = await temporaryDirectory(t);
  const localMessages = path.join(root, 'messages');
  const incomingMessages = path.join(update, 'messages');

  await fs.mkdir(localMessages, { recursive: true });
  await fs.mkdir(incomingMessages, { recursive: true });
  await fs.writeFile(path.join(localMessages, 'en.json'), '{"owner":"application"}\n', 'utf8');
  await fs.writeFile(path.join(incomingMessages, 'en.json'), '{"owner":"core"}\n', 'utf8');
  await fs.writeFile(path.join(incomingMessages, 'fr.json'), '{"owner":"core"}\n', 'utf8');

  await moveFiles(update, root, ['messages']);

  assert.equal(
    await fs.readFile(path.join(localMessages, 'en.json'), 'utf8'),
    '{"owner":"application"}\n'
  );
  await assert.rejects(fs.access(path.join(localMessages, 'fr.json')));
});

test('installs starter messages only when the developer-owned directory is absent', async (t) => {
  const root = await temporaryDirectory(t);
  const update = await temporaryDirectory(t);
  const incomingMessage = path.join(update, 'messages', 'en.json');

  await fs.mkdir(path.dirname(incomingMessage), { recursive: true });
  await fs.writeFile(incomingMessage, '{"starter":true}\n', 'utf8');

  await moveFiles(update, root, ['messages']);

  assert.equal(
    await fs.readFile(path.join(root, 'messages', 'en.json'), 'utf8'),
    '{"starter":true}\n'
  );
});

test('matches nested files beneath a preserved developer-owned directory', () => {
  assert.equal(matchingPreservedPath(path.join('messages', 'en.json'), ['messages']), 'messages');
  assert.equal(
    matchingPreservedPath(path.join('src', 'app', 'page.tsx'), ['messages']),
    undefined
  );
});

test('installs a missing developer-owned starter file', async (t) => {
  const root = await temporaryDirectory(t);
  const update = await temporaryDirectory(t);
  const relativePath = 'src/styles/project.css';
  const incomingFile = path.join(update, relativePath);
  await fs.mkdir(path.dirname(incomingFile), { recursive: true });
  await fs.writeFile(incomingFile, 'starter styles\n', 'utf8');

  await moveFiles(update, root, [relativePath]);

  assert.equal(await fs.readFile(path.join(root, relativePath), 'utf8'), 'starter styles\n');
});

test('installs missing auth presentation starters without overwriting developer customisations', async (t) => {
  const root = await temporaryDirectory(t);
  const update = await temporaryDirectory(t);
  const authStyles = path.join('src', 'styles', 'supacharger-auth.css');
  const authSidecar = path.join('src', 'supacharger.adapters', 'auth', 'auth-sidecar.tsx');
  for (const relativePath of [authStyles, authSidecar]) {
    await fs.mkdir(path.dirname(path.join(update, relativePath)), { recursive: true });
    await fs.writeFile(path.join(update, relativePath), `starter ${relativePath}\n`);
  }
  await fs.mkdir(path.dirname(path.join(root, authStyles)), { recursive: true });
  await fs.writeFile(path.join(root, authStyles), 'developer auth styles\n');

  assert.deepEqual(await installMissingDeveloperStarters(update, root), [authSidecar]);
  assert.equal(await fs.readFile(path.join(root, authStyles), 'utf8'), 'developer auth styles\n');
  assert.equal(await fs.readFile(path.join(root, authSidecar), 'utf8'), `starter ${authSidecar}\n`);
});

test('installs missing account adapter starters without overwriting developer customisations', async (t) => {
  const root = await temporaryDirectory(t);
  const update = await temporaryDirectory(t);
  const adapterDirectory = path.join('src', 'supacharger.adapters', 'account');
  const adapters = [
    'details-page.tsx',
    'navigation.ts',
    'notifications.ts',
    'presentation.ts',
    'privacy.ts',
    'profile-extension.ts',
    'profile-fields.tsx',
    'security-page.tsx',
  ].map((file) => path.join(adapterDirectory, file));

  for (const relativePath of adapters) {
    await fs.mkdir(path.dirname(path.join(update, relativePath)), { recursive: true });
    await fs.writeFile(path.join(update, relativePath), `starter ${relativePath}\n`);
  }
  await fs.mkdir(path.dirname(path.join(root, adapters[1])), { recursive: true });
  await fs.writeFile(path.join(root, adapters[1]), 'developer navigation\n');

  assert.deepEqual(await installMissingDeveloperStarters(update, root), adapters.filter((path) => path !== adapters[1]));
  assert.equal(await fs.readFile(path.join(root, adapters[1]), 'utf8'), 'developer navigation\n');
});

test('moves unchanged legacy auth routes out of the developer route group and rejects modified routes', async (t) => {
  const root = await temporaryDirectory(t);
  const baseline = await temporaryDirectory(t);
  const route = path.join(
    'src',
    'app',
    '(project)',
    '(unauthenticated)',
    'account',
    'login',
    'page.tsx',
  );
  for (const directory of [root, baseline]) {
    await fs.mkdir(path.dirname(path.join(directory, route)), { recursive: true });
    await fs.writeFile(path.join(directory, route), 'canonical legacy route\n');
  }

  assert.deepEqual(await migrateLegacyAuthRoutes(root, baseline), [route]);
  await assert.rejects(fs.access(path.join(root, route)));

  await fs.writeFile(path.join(root, route), 'developer route changes\n');
  await assert.rejects(migrateLegacyAuthRoutes(root, baseline), /contains application changes/);
});

test('personalises the core project stylesheet starter without changing established names', async (t) => {
  const root = await temporaryDirectory(t);
  const projectStyles = path.join(root, 'src', 'styles', 'project.css');
  await fs.mkdir(path.dirname(projectStyles), { recursive: true });
  await fs.writeFile(path.join(root, 'package.json'), '{"name":"consumer-app"}\n', 'utf8');
  await fs.writeFile(projectStyles, '/**\n * Project: Supacharger\n */\n', 'utf8');

  await personaliseStarterProjectStyles(root);
  assert.match(await fs.readFile(projectStyles, 'utf8'), /Project: consumer-app/);

  await fs.writeFile(projectStyles, '/**\n * Project: Custom Display Name\n */\n', 'utf8');
  await personaliseStarterProjectStyles(root);
  assert.match(await fs.readFile(projectStyles, 'utf8'), /Project: Custom Display Name/);
});

test('detects the declared package manager before lockfile fallbacks', () => {
  assert.equal(detectPackageManager({ packageManager: 'pnpm@10.0.0' }, ['package-lock.json']), 'pnpm');
  assert.equal(detectPackageManager({}, ['yarn.lock']), 'yarn');
  assert.equal(detectPackageManager({}, []), 'npm');
});

test('installs changed dependencies and verifies changed migrations before completion', async (t) => {
  const root = await temporaryDirectory(t);
  const update = await temporaryDirectory(t);
  const migration = path.join('supabase', 'migrations', '20260812000000_billing.sql');
  const currentPackage = { name: 'consumer', packageManager: 'npm@11.0.0', dependencies: { stripe: '18.5.0' } };
  const incomingPackage = { name: 'consumer', packageManager: 'npm@11.0.0', dependencies: { stripe: '22.5.0' } };

  await fs.mkdir(path.join(update, 'supabase', 'migrations'), { recursive: true });
  await fs.writeFile(path.join(root, 'package.json'), `${JSON.stringify(currentPackage)}\n`);
  await fs.writeFile(path.join(update, 'package.json'), `${JSON.stringify(incomingPackage)}\n`);
  await fs.writeFile(path.join(update, migration), 'select 1;\n');

  const assessment = await assessPostUpdateWork(root, update);
  assert.equal(assessment.dependencyChanged, true);
  assert.deepEqual(assessment.changedMigrations.map((entry) => entry.path), [migration]);

  const commands = [];
  const completed = await runPostUpdateSteps(root, assessment, {
    run: async (command, options) => {
      commands.push({ command, cwd: options.cwd });
      return command.includes('migration list')
        ? { stdout: JSON.stringify({ migrations: [{ local: '20260812000000', remote: '20260812000000' }] }) }
        : { stdout: '' };
    },
    confirm: async () => 'y',
  });

  assert.equal(completed, true);
  const mergedPackage = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
  assert.equal(mergedPackage.name, 'consumer');
  assert.equal(mergedPackage.dependencies.stripe, '22.5.0');
  assert.equal(await fs.readFile(path.join(root, migration), 'utf8'), 'select 1;\n');
  assert.deepEqual(commands.map(({ command }) => command), [
    'npm install',
    'npx supabase db push --linked --dry-run',
    'npx supabase db push --linked --yes',
    'npx supabase migration list --linked --output json',
  ]);
  assert.ok(commands.every(({ cwd }) => cwd === root));
});

test('installs missing required Core scripts without overwriting consumer scripts', async (t) => {
  const root = await temporaryDirectory(t);
  const update = await temporaryDirectory(t);
  const currentPackage = {
    name: 'consumer',
    scripts: { 'test:billing-schema': 'node test/shared.mjs && node test/project.mjs' },
    dependencies: {},
  };
  const incomingPackage = {
    name: 'supacharger',
    scripts: {
      'test:billing-schema': 'node test/shared.mjs',
      'check:bruno-rpcs': 'node scripts/check-bruno-rpc-parity.mjs',
    },
    dependencies: {},
  };

  await fs.writeFile(path.join(root, 'package.json'), `${JSON.stringify(currentPackage)}\n`);
  await fs.writeFile(path.join(update, 'package.json'), `${JSON.stringify(incomingPackage)}\n`);

  const assessment = await assessPostUpdateWork(root, update, {
    postUpdateChecks: ['check:bruno-rpcs'],
  });
  assert.deepEqual(assessment.missingRequiredScripts, ['check:bruno-rpcs']);

  await runPostUpdateSteps(root, assessment);
  const mergedPackage = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
  assert.equal(mergedPackage.scripts['check:bruno-rpcs'], 'node scripts/check-bruno-rpc-parity.mjs');
  assert.equal(mergedPackage.scripts['test:billing-schema'], 'node test/shared.mjs && node test/project.mjs');
});

test('fails completion when the linked migration ledger omits an updated migration', async (t) => {
  const root = await temporaryDirectory(t);
  const update = await temporaryDirectory(t);
  const migration = path.join('supabase', 'migrations', '20260812000000_billing.sql');
  const packageJson = { name: 'consumer', dependencies: {} };

  await fs.mkdir(path.join(root, 'supabase', 'migrations'), { recursive: true });
  await fs.mkdir(path.join(update, 'supabase', 'migrations'), { recursive: true });
  await fs.writeFile(path.join(root, 'package.json'), `${JSON.stringify(packageJson)}\n`);
  await fs.writeFile(path.join(update, 'package.json'), `${JSON.stringify(packageJson)}\n`);
  await fs.writeFile(path.join(update, migration), 'select 1;\n');
  const assessment = await assessPostUpdateWork(root, update);
  await assert.rejects(
    runPostUpdateSteps(root, assessment, {
      run: async () => ({ stdout: JSON.stringify({ migrations: [{ local: '20260811000000', remote: '20260811000000' }] }) }),
      confirm: async () => 'y',
    }),
    /did not report migration/,
  );
});

test('does not complete or advance past a declined migration application', async (t) => {
  const root = await temporaryDirectory(t);
  const update = await temporaryDirectory(t);
  const migration = path.join('supabase', 'migrations', '20260812000000_billing.sql');
  const packageJson = { name: 'consumer', dependencies: {} };

  await fs.mkdir(path.join(root, 'supabase', 'migrations'), { recursive: true });
  await fs.mkdir(path.join(update, 'supabase', 'migrations'), { recursive: true });
  await fs.writeFile(path.join(root, 'package.json'), `${JSON.stringify(packageJson)}\n`);
  await fs.writeFile(path.join(update, 'package.json'), `${JSON.stringify(packageJson)}\n`);
  await fs.writeFile(path.join(update, migration), 'select 1;\n');

  const assessment = await assessPostUpdateWork(root, update);
  const commands = [];
  const completed = await runPostUpdateSteps(root, assessment, {
    run: async (command) => commands.push(command),
    confirm: async () => 'n',
  });

  assert.equal(completed, false);
  assert.deepEqual(commands, ['npx supabase db push --linked --dry-run']);
});

test('considers only migrations added after the installed core baseline', async (t) => {
  const root = await temporaryDirectory(t);
  const update = await temporaryDirectory(t);
  const existing = path.join('supabase', 'migrations', '20260811000000_existing.sql');
  const added = path.join('supabase', 'migrations', '20260812000000_added.sql');
  const packageJson = { name: 'consumer', dependencies: {} };

  await fs.mkdir(path.join(update, 'supabase', 'migrations'), { recursive: true });
  await fs.writeFile(path.join(root, 'package.json'), `${JSON.stringify(packageJson)}\n`);
  await fs.writeFile(path.join(update, 'package.json'), `${JSON.stringify(packageJson)}\n`);
  await fs.writeFile(path.join(update, existing), 'select 1;\n');
  await fs.writeFile(path.join(update, added), 'select 2;\n');

  const allMigrations = await assessPostUpdateWork(root, update);
  const existingHash = allMigrations.changedMigrations.find(({ path: migration }) => migration === existing).hash;
  const assessment = await assessPostUpdateWork(root, update, {
    baselineMigrationHashes: new Map([[existing, existingHash]]),
  });

  assert.deepEqual(assessment.changedMigrations.map(({ path: migration }) => migration), [added]);
});

test('rejects mutation of a migration published in the installed baseline', async (t) => {
  const root = await temporaryDirectory(t);
  const update = await temporaryDirectory(t);
  const migration = path.join('supabase', 'migrations', '20260811000000_existing.sql');
  const packageJson = { name: 'consumer', dependencies: {} };

  await fs.mkdir(path.join(update, 'supabase', 'migrations'), { recursive: true });
  await fs.writeFile(path.join(root, 'package.json'), `${JSON.stringify(packageJson)}\n`);
  await fs.writeFile(path.join(update, 'package.json'), `${JSON.stringify(packageJson)}\n`);
  await fs.writeFile(path.join(update, migration), 'select 2;\n');

  await assert.rejects(
    assessPostUpdateWork(root, update, { baselineMigrationHashes: new Map([[migration, 'different-hash']]) }),
    /Published migration changed after installation/,
  );
});

test('preserves a colliding project migration instead of overwriting it', async (t) => {
  const root = await temporaryDirectory(t);
  const update = await temporaryDirectory(t);
  const migration = path.join('supabase', 'migrations', '20260812000000_collision.sql');
  const packageJson = { name: 'consumer', dependencies: {} };

  await fs.mkdir(path.join(root, 'supabase', 'migrations'), { recursive: true });
  await fs.mkdir(path.join(update, 'supabase', 'migrations'), { recursive: true });
  await fs.writeFile(path.join(root, 'package.json'), `${JSON.stringify(packageJson)}\n`);
  await fs.writeFile(path.join(update, 'package.json'), `${JSON.stringify(packageJson)}\n`);
  await fs.writeFile(path.join(root, migration), 'project history;\n');
  await fs.writeFile(path.join(update, migration), 'core history;\n');
  const assessment = await assessPostUpdateWork(root, update);

  await assert.rejects(runPostUpdateSteps(root, assessment), /Forward-only migration collision/);
  assert.equal(await fs.readFile(path.join(root, migration), 'utf8'), 'project history;\n');
});

test('limits managed files to the versioned manifest and excludes developer seams', async (t) => {
  const root = await temporaryDirectory(t);
  await fs.mkdir(path.join(root, '.supacharger'), { recursive: true });
  await fs.mkdir(path.join(root, 'src', 'supacharger'), { recursive: true });
  await fs.mkdir(path.join(root, 'src', 'supacharger.adapters'), { recursive: true });
  await fs.writeFile(path.join(root, 'src', 'supacharger', 'core.ts'), 'managed\n');
  await fs.writeFile(path.join(root, 'src', 'supacharger.adapters', 'project.ts'), 'developer\n');
  await fs.writeFile(
    path.join(root, '.supacharger', 'managed-files.json'),
    JSON.stringify({
      version: 2,
      managedPaths: ['.supacharger/managed-files.json', 'src/supacharger'],
      mergeManagedPaths: ['package.json'],
      forwardOnlyMigrationPaths: ['supabase/migrations'],
      developerOwnedPaths: ['src/supacharger.adapters'],
    }),
  );

  const manifest = await readManagedManifest(root);
  assert.deepEqual(manifest.mergeManagedPaths, ['package.json']);
  assert.deepEqual(manifest.forwardOnlyMigrationPaths, [path.join('supabase', 'migrations')]);
  assert.deepEqual((await managedFiles(root, manifest)).sort(), [
    path.join('.supacharger', 'managed-files.json'),
    path.join('src', 'supacharger', 'core.ts'),
  ]);
});

test('plans managed writes and obsolete removals without changing the project', async (t) => {
  const root = await temporaryDirectory(t);
  const baseline = await temporaryDirectory(t);
  const latest = await temporaryDirectory(t);
  const manifest = {
    version: 1,
    managedPaths: ['.supacharger/managed-files.json', 'package.json', 'src/supacharger'],
    developerOwnedPaths: [],
    postUpdateChecks: ['lint'],
  };

  for (const directory of [root, baseline, latest]) {
    await fs.mkdir(path.join(directory, '.supacharger'), { recursive: true });
    await fs.mkdir(path.join(directory, 'src', 'supacharger'), { recursive: true });
    await fs.writeFile(path.join(directory, '.supacharger', 'managed-files.json'), JSON.stringify(manifest));
    await fs.writeFile(
      path.join(directory, 'package.json'),
      '{"name":"fixture","scripts":{"lint":"eslint ."},"dependencies":{}}\n'
    );
  }
  await fs.writeFile(path.join(root, 'src', 'supacharger', 'changed.ts'), 'old\n');
  await fs.writeFile(path.join(baseline, 'src', 'supacharger', 'changed.ts'), 'old\n');
  await fs.writeFile(path.join(baseline, 'src', 'supacharger', 'obsolete.ts'), 'obsolete\n');
  await fs.writeFile(path.join(latest, 'src', 'supacharger', 'changed.ts'), 'new\n');
  await fs.writeFile(path.join(latest, 'src', 'supacharger', 'added.ts'), 'added\n');

  const plan = await buildUpdatePlan(root, baseline, latest);
  assert.deepEqual(plan.removals, [path.join('src', 'supacharger', 'obsolete.ts')]);
  assert.deepEqual(plan.writes.sort(), [
    path.join('src', 'supacharger', 'added.ts'),
    path.join('src', 'supacharger', 'changed.ts'),
  ]);
  assert.equal(await fs.readFile(path.join(root, 'src', 'supacharger', 'changed.ts'), 'utf8'), 'old\n');
});

test('removes only obsolete managed files and requires every declared check', async (t) => {
  const root = await temporaryDirectory(t);
  const obsolete = path.join('src', 'supacharger', 'obsolete.ts');
  const preserved = path.join('src', 'supacharger.adapters', 'project.ts');
  await fs.mkdir(path.dirname(path.join(root, obsolete)), { recursive: true });
  await fs.mkdir(path.dirname(path.join(root, preserved)), { recursive: true });
  await fs.writeFile(path.join(root, obsolete), 'old\n');
  await fs.writeFile(path.join(root, preserved), 'project\n');
  await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ scripts: { lint: 'eslint .' } }));

  assert.deepEqual(
    await removeObsoleteManagedFiles(root, [obsolete, preserved], [], ['src/supacharger.adapters']),
    [obsolete],
  );
  await assert.rejects(fs.access(path.join(root, obsolete)));
  assert.equal(await fs.readFile(path.join(root, preserved), 'utf8'), 'project\n');

  const commands = [];
  await runPostUpdateChecks(root, { postUpdateChecks: ['lint', 'typecheck'] }, {
    run: async (command) => commands.push(command),
  });
  assert.deepEqual(commands, ['npm run lint', 'npx tsc --noEmit']);
  await assert.rejects(
    runPostUpdateChecks(root, { postUpdateChecks: ['missing'] }, { run: async () => {} }),
    /Required post-update check is unavailable/,
  );
});

test('detects manual merge-managed changes and refuses a false exact-file verification', async (t) => {
  const root = await temporaryDirectory(t);
  const baseline = await temporaryDirectory(t);
  const latest = await temporaryDirectory(t);
  const relativePath = 'tailwind.config.ts';
  const manifest = { mergeManagedPaths: [relativePath] };
  await fs.writeFile(path.join(baseline, relativePath), 'baseline\n');
  await fs.writeFile(path.join(latest, relativePath), 'latest\n');
  await fs.writeFile(path.join(root, relativePath), 'consumer\n');

  assert.deepEqual(await changedManualMergePaths(baseline, latest, manifest), [relativePath]);
  const expectedHashes = await managedFileHashes(latest, [relativePath]);
  await assert.rejects(verifyManagedFiles(root, expectedHashes), /Managed files do not match/);
});
