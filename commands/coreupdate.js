const { exec } = require('child_process');
const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const readline = require('readline');
const os = require('os');
const { isDeepStrictEqual } = require('node:util');

const CORE_REPOSITORY = 'glowplug-studio/supacharger';
const CORE_SSH_URL = `git@github.com:${CORE_REPOSITORY}.git`;
const CORE_LOCK_FILE = path.join('.supacharger', 'core-lock.json');
const MANAGED_FILES_MANIFEST = path.join('.supacharger', 'managed-files.json');
const AUTOMATIC_MERGE_PATHS = new Set(['package.json', 'package-lock.json']);
const DEFAULT_MIGRATION_PATHS = [path.join('supabase', 'migrations')];
const PROJECT_STYLES_FILE = path.join('src', 'styles', 'project.css');
const AUTH_STYLES_FILE = path.join('src', 'styles', 'supacharger-auth.css');
const AUTH_SIDECAR_FILE = path.join('src', 'supacharger.adapters', 'auth', 'auth-sidecar.tsx');
const AUTH_DEVELOPER_STARTERS = [AUTH_STYLES_FILE, AUTH_SIDECAR_FILE];
const LEGACY_AUTH_ROUTE_FILES = [
  path.join('src', 'app', '(project)', '(unauthenticated)', 'account', 'layout.tsx'),
  path.join('src', 'app', '(project)', '(unauthenticated)', 'account', 'login', 'page.tsx'),
  path.join('src', 'app', '(project)', '(unauthenticated)', 'account', 'create', 'page.tsx'),
  path.join('src', 'app', '(project)', '(unauthenticated)', 'account', 'login-magic', 'page.tsx'),
  path.join('src', 'app', '(project)', '(unauthenticated)', 'account', 'reset-password', 'page.tsx'),
  path.join('src', 'app', '(project)', '(unauthenticated)', 'account', 'reset-password', 'new', 'page.tsx'),
];
const LEGACY_PROJECT_STYLE_FILES = [
  path.join('src', 'styles', 'globals.css'),
  path.join('src', 'styles', 'globals.scss'),
];
const LEGACY_POSTCSS_CONFIG = `module.exports = {
  plugins: {
    '@tailwindcss/postcss': {},
  },
};`;
const DEVELOPER_OWNED_FILES = [
  'src/supacharger.config.ts',
  path.join('src', 'app', 'layout.tsx'),
  path.join('src', 'i18n', 'config.ts'),
  path.join('src', 'i18n', 'request.ts'),
  path.join('src', 'assets', 'svgr', 'ui', 'inline-loader-dark.svg'),
  path.join('src', 'assets', 'svgr', 'ui', 'inline-loader.svg'),
  AUTH_STYLES_FILE,
  AUTH_SIDECAR_FILE,
  PROJECT_STYLES_FILE,
  CORE_LOCK_FILE,
];
const DEVELOPER_OWNED_DIRECTORIES = ['messages'];
const DEVELOPER_OWNED_PATHS = [
  ...DEVELOPER_OWNED_FILES,
  ...DEVELOPER_OWNED_DIRECTORIES,
];
const AUTH_PROVIDER_CONFIG_KEYS = [
  'apple',
  'azure',
  'bitbucket',
  'discord',
  'facebook',
  'figma',
  'github',
  'gitlab',
  'google',
  'kakao',
  'keycloak',
  'linkedin_oidc',
  'notion',
  'twitch',
  'x',
  'twitter',
  'slack_oidc',
  'slack',
  'spotify',
  'workos',
  'zoom',
];
const ROOT_DOCUMENT_CONFIG_KEYS = ['METADATA', 'ROOT_PROVIDERS', 'ANALYTICS'];
const STANDARD_FAVICON_FILES = [
  'favicon.ico',
  path.join('favicons', 'favicon.svg'),
  path.join('favicons', 'favicon-96x96.png'),
  path.join('favicons', 'apple-touch-icon.png'),
  path.join('favicons', 'web-app-manifest-192x192.png'),
  path.join('favicons', 'web-app-manifest-512x512.png'),
  path.join('favicons', 'site.webmanifest'),
];

async function readManagedManifest(rootDir) {
  try {
    const manifest = await readJson(path.join(rootDir, MANAGED_FILES_MANIFEST));
    const supportsVersion = manifest.version === 1 || manifest.version === 2;
    if (!supportsVersion || !Array.isArray(manifest.managedPaths) || !Array.isArray(manifest.developerOwnedPaths)) {
      throw new Error('Unsupported managed-file manifest');
    }
    if (
      manifest.version === 2 &&
      (!Array.isArray(manifest.mergeManagedPaths) || !Array.isArray(manifest.forwardOnlyMigrationPaths))
    ) {
      throw new Error('Version 2 managed-file manifests require merge-managed and forward-only migration paths');
    }
    return {
      ...manifest,
      managedPaths: manifest.managedPaths.map((entry) => path.normalize(entry)),
      mergeManagedPaths: (manifest.mergeManagedPaths ?? []).map((entry) => path.normalize(entry)),
      forwardOnlyMigrationPaths: (manifest.forwardOnlyMigrationPaths ?? []).map((entry) => path.normalize(entry)),
      developerOwnedPaths: manifest.developerOwnedPaths.map((entry) => path.normalize(entry)),
    };
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

function pathMatchesManifest(relPath, manifestPaths) {
  return manifestPaths.some(
    (manifestPath) => relPath === manifestPath || relPath.startsWith(`${manifestPath}${path.sep}`)
  );
}

async function managedFiles(rootDir, manifest) {
  const files = await walkFiles(rootDir);
  if (!manifest) {
    return files.filter((file) => !matchingPreservedPath(file, DEVELOPER_OWNED_PATHS));
  }
  return files.filter(
    (file) =>
      pathMatchesManifest(file, manifest.managedPaths) &&
      !pathMatchesManifest(file, manifest.developerOwnedPaths)
  );
}

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
      resolve(answer.trim());
    });
  });
}

// Helper function to repeatedly ask for a valid action, now includes 'OB'
async function askAction(prompt) {
  while (true) {
    const answer = (await askYesNo(prompt)).toUpperCase();
    if (['O', 'S', 'E', 'OB'].includes(answer)) {
      return answer;
    }
    console.log('\x1b[31mInvalid input. Please enter O, S, OB, or E.\x1b[0m');
  }
}

async function readLegacyInstallHash(configPath) {
  try {
    const content = await fs.readFile(configPath, 'utf8');
    const match = content.match(/CLI_INSTALL_HASH\s*:\s*['"`]([a-f0-9]+)['"`]/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

async function readInstallState(rootDir) {
  const lockPath = path.join(rootDir, CORE_LOCK_FILE);
  try {
    const lock = JSON.parse(await fs.readFile(lockPath, 'utf8'));
    const repositoryIsValid =
      typeof lock.repository === 'string' &&
      /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(lock.repository);
    if (
      typeof lock.commit === 'string' &&
      /^[a-f0-9]{40}$/.test(lock.commit) &&
      repositoryIsValid
    ) {
      return {
        commit: lock.commit,
        repository: lock.repository,
      };
    }
  } catch {
    // Fall back to the legacy hash embedded in the old configuration file.
  }

  const legacyConfigPath = path.join(rootDir, 'src', 'supacharger', 'supacharger-config.ts');
  const legacyHash = await readLegacyInstallHash(legacyConfigPath);
  return legacyHash
    ? { commit: legacyHash, repository: 'glowplug-studio/supacharger-demo' }
    : null;
}

async function writeCoreLock(rootDir, commit) {
  const lockPath = path.join(rootDir, CORE_LOCK_FILE);
  await fs.mkdir(path.dirname(lockPath), { recursive: true });
  await fs.writeFile(
    lockPath,
    `${JSON.stringify({ repository: CORE_REPOSITORY, commit }, null, 2)}\n`,
    'utf8'
  );
}

async function migrateLegacyConfig(rootDir) {
  const developerConfigPath = path.join(rootDir, 'src', 'supacharger.config.ts');
  try {
    await fs.access(developerConfigPath);
    return;
  } catch {
    // Continue only when the new developer-owned configuration does not exist.
  }

  const legacyConfigPath = path.join(rootDir, 'src', 'supacharger', 'supacharger-config.ts');
  let content = await fs.readFile(legacyConfigPath, 'utf8');
  const legacyHashBlock = /\n\s*\/\*\*\n\s*\* =+\n\s*\* CLI - do not edit\n\s*\* =+\n\s*\*\/\n\s*CLI_INSTALL_HASH\s*:\s*['"`][a-f0-9]+['"`],?\n?/m;
  content = content.replace(legacyHashBlock, '\n');
  await fs.writeFile(developerConfigPath, content, 'utf8');
  console.log('\x1b[34mMoved application settings to src/supacharger.config.ts.\x1b[0m');
}

async function assessAuthProviderConfig(rootDir) {
  const configPath = path.join(rootDir, 'src', 'supacharger.config.ts');
  let content;
  try {
    content = await fs.readFile(configPath, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return { missingKeys: [], propertyIndent: '  ' };
    throw error;
  }
  const block = content.match(/\bAUTH_PROVDERS_ENABLED\s*:\s*\{([\s\S]*?)\n([ \t]*)\},/m);
  if (!block) {
    throw new Error('Could not find AUTH_PROVDERS_ENABLED in src/supacharger.config.ts. Migrate the configuration manually.');
  }

  const body = block[1];
  return {
    missingKeys: AUTH_PROVIDER_CONFIG_KEYS.filter(
      (provider) => !new RegExp(`(?:["']${provider}["']|\\b${provider})\\s*:`).test(body)
    ),
    propertyIndent: `${block[2]}  `,
  };
}

async function migrateAuthProviderConfig(rootDir, options = {}) {
  const configPath = path.join(rootDir, 'src', 'supacharger.config.ts');
  const assessment = await assessAuthProviderConfig(rootDir);
  if (assessment.missingKeys.length === 0 || options.plan === true) return assessment.missingKeys;

  if (options.backup !== false) {
    await backupConflicts(rootDir, rootDir, ['src/supacharger.config.ts']);
  }

  const content = await fs.readFile(configPath, 'utf8');
  const additions = assessment.missingKeys
    .map((provider) => `${assessment.propertyIndent}${provider}: false,`)
    .join('\n');
  const migrated = content.replace(
    /(\bAUTH_PROVDERS_ENABLED\s*:\s*\{[\s\S]*?)(\n[ \t]*\},)/m,
    `$1\n${additions}$2`
  );
  await fs.writeFile(configPath, migrated, 'utf8');
  console.log(
    `\x1b[34mAdded disabled defaults for new OAuth providers in src/supacharger.config.ts: ${assessment.missingKeys.join(', ')}.\x1b[0m`
  );
  return assessment.missingKeys;
}

async function migrateLegacyAuthSessionConfig(rootDir, options = {}) {
  const configPath = path.join(rootDir, 'src', 'supacharger.config.ts');
  let content;
  try {
    content = await fs.readFile(configPath, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }

  const legacyProperty = /^([ \t]*)VERIFICATION_MODE\s*:\s*['"](?:claims|user)['"],?\s*$/m;
  if (!legacyProperty.test(content)) return [];
  if (options.plan === true) return ['AUTH_SESSION.VERIFICATION_MODE'];

  if (options.backup !== false) {
    await backupConflicts(rootDir, rootDir, ['src/supacharger.config.ts']);
  }
  await fs.writeFile(configPath, content.replace(legacyProperty, '').replace(/\n{3,}/g, '\n\n'), 'utf8');
  console.log('\x1b[34mRemoved legacy AUTH_SESSION.VERIFICATION_MODE; Proxy verification is now always getClaims().\x1b[0m');
  return ['AUTH_SESSION.VERIFICATION_MODE'];
}

async function assessRootDocumentConfig(rootDir) {
  const configPath = path.join(rootDir, 'src', 'supacharger.config.ts');
  let content;
  try {
    content = await fs.readFile(configPath, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return { content: '', missingKeys: [] };
    throw error;
  }

  return {
    content,
    missingKeys: ROOT_DOCUMENT_CONFIG_KEYS.filter(
      (key) => !new RegExp(`\\b${key}\\s*:`).test(content)
    ),
  };
}

async function hasStandardFaviconSet(rootDir) {
  const checks = await Promise.all(
    STANDARD_FAVICON_FILES.map(async (file) => {
      try {
        await fs.access(path.join(rootDir, 'public', file));
        return true;
      } catch {
        return false;
      }
    })
  );
  return checks.every(Boolean);
}

function escapeSingleQuotedString(value) {
  return value.replaceAll('\\', '\\\\').replaceAll("'", "\\'");
}

async function migrateRootDocumentConfig(rootDir, options = {}) {
  const assessment = await assessRootDocumentConfig(rootDir);
  if (assessment.missingKeys.length === 0 || options.plan === true) return assessment.missingKeys;

  const configPath = path.join(rootDir, 'src', 'supacharger.config.ts');
  if (options.backup !== false) {
    await backupConflicts(rootDir, rootDir, ['src/supacharger.config.ts']);
  }

  const siteTitleMatch = assessment.content.match(/\bSITE_TITLE\s*:\s*['"]([^'"]+)['"]/);
  const siteTitle = escapeSingleQuotedString(siteTitleMatch?.[1] ?? 'Supacharger');
  const faviconSetEnabled = await hasStandardFaviconSet(rootDir);
  const blocks = {
    METADATA: `  METADATA: {
    SITE_URL: process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000',
    TITLE_TEMPLATE: '%s | ${siteTitle}',
    INDEXING_ENABLED: process.env.VERCEL_ENV
      ? process.env.VERCEL_ENV === 'production'
      : process.env.NODE_ENV === 'production',
    FAVICON_SET_ENABLED: ${faviconSetEnabled},
    SOCIAL_IMAGE: null,
    COLOR_SCHEME: 'light dark',
    THEME_COLOR: null,
  },`,
    ROOT_PROVIDERS: `  ROOT_PROVIDERS: {
    INTERNATIONALISATION: true,
    THEME: true,
    TOASTS: true,
  },`,
    ANALYTICS: `  ANALYTICS: {
    GOOGLE_ANALYTICS_ID: process.env.NEXT_PUBLIC_GOOGLE_ANALYTICS_ID || null,
    VERCEL_ANALYTICS_ENABLED: true,
  },`,
  };
  const additions = assessment.missingKeys.map((key) => blocks[key]).join('\n');
  const migrated = assessment.content.replace(
    /(\bMARKETING_SITE_URL\s*:\s*[^\n]+,\n)/,
    `$1${additions}\n`
  );
  if (migrated === assessment.content) {
    throw new Error(
      'Could not find MARKETING_SITE_URL in src/supacharger.config.ts. Add METADATA, ROOT_PROVIDERS and ANALYTICS manually.'
    );
  }

  await fs.writeFile(configPath, migrated, 'utf8');
  console.log(
    `\x1b[34mAdded root document configuration in src/supacharger.config.ts: ${assessment.missingKeys.join(', ')}.\x1b[0m`
  );
  return assessment.missingKeys;
}

async function readProjectName(rootDir) {
  try {
    const packageJson = JSON.parse(await fs.readFile(path.join(rootDir, 'package.json'), 'utf8'));
    if (typeof packageJson.name === 'string' && packageJson.name.trim()) {
      return packageJson.name.trim();
    }
  } catch {
    // A package name is helpful metadata, not a prerequisite for migration.
  }
  return 'Add your project name';
}

async function migrateLegacyProjectStyles(rootDir) {
  const projectStylesPath = path.join(rootDir, PROJECT_STYLES_FILE);
  try {
    await fs.access(projectStylesPath);
    return;
  } catch {
    // Migrate a legacy developer stylesheet only when project.css does not exist.
  }

  for (const relativeLegacyPath of LEGACY_PROJECT_STYLE_FILES) {
    const legacyPath = path.join(rootDir, relativeLegacyPath);
    let content;
    try {
      content = await fs.readFile(legacyPath, 'utf8');
    } catch {
      continue;
    }

    if (relativeLegacyPath.endsWith('.scss')) {
      if (/(^|\n)\s*\$[\w-]+\s*:|@(?:mixin|include|extend)\b/.test(content)) {
        throw new Error(
          `${relativeLegacyPath} uses Sass-only syntax. Migrate it to ${PROJECT_STYLES_FILE} before updating the core.`
        );
      }
      content = content.replace(/^(\s*)\/\/\s?(.*)$/gm, '$1/* $2 */');
    }

    const projectName = await readProjectName(rootDir);
    const projectHeader = `/**\n * Project: ${projectName}\n *\n * Developer-owned. The Supacharger CLI preserves this file.\n */\n\n`;
    await fs.mkdir(path.dirname(projectStylesPath), { recursive: true });
    await fs.writeFile(projectStylesPath, `${projectHeader}${content}`, 'utf8');
    console.log(`\x1b[34mMoved application styles to ${PROJECT_STYLES_FILE}.\x1b[0m`);
    return;
  }
}

async function migrateLegacyPostcssConfig(rootDir, options = {}) {
  const legacyPath = path.join(rootDir, 'postcss.config.js');
  let content;
  try {
    content = await fs.readFile(legacyPath, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }

  if (content.replace(/\r\n/g, '\n').trim() !== LEGACY_POSTCSS_CONFIG) {
    throw new Error(
      'postcss.config.js contains application changes. Migrate them into postcss.config.mjs before updating the core.',
    );
  }

  if (options.plan === true) return true;
  await backupConflicts(rootDir, rootDir, ['postcss.config.js']);
  await fs.rm(legacyPath);
  console.log('\x1b[34mRemoved the superseded CommonJS postcss.config.js after backing it up.\x1b[0m');
  return true;
}

async function personaliseStarterProjectStyles(rootDir) {
  const projectStylesPath = path.join(rootDir, PROJECT_STYLES_FILE);
  let content;
  try {
    content = await fs.readFile(projectStylesPath, 'utf8');
  } catch {
    return;
  }

  if (!/^ \* Project: (?:Supacharger|Add your project name)$/m.test(content)) return;

  const projectName = await readProjectName(rootDir);
  const personalised = content.replace(
    /^ \* Project: (?:Supacharger|Add your project name)$/m,
    ` * Project: ${projectName}`
  );
  await fs.writeFile(projectStylesPath, personalised, 'utf8');
}

async function getRemoteMainHash(repository = CORE_REPOSITORY) {
  const repositoryUrl = `git@github.com:${repository}.git`;
  const { stdout } = await execCommand(`git ls-remote ${repositoryUrl} refs/heads/main`);
  const commit = stdout.trim().split(/\s+/)[0];
  if (!/^[a-f0-9]{40}$/.test(commit ?? '')) {
    throw new Error(`Could not resolve the main branch for ${repository}.`);
  }
  return commit;
}

async function removeGitDir(dir) {
  const gitPath = path.join(dir, '.git');
  try {
    const stat = await fs.stat(gitPath);
    if (stat.isDirectory()) {
      await fs.rm(gitPath, { recursive: true, force: true });
      console.log('\x1b[34mRemoved .git directory from cloned folder.\x1b[0m');
    }
  } catch {
    // .git does not exist, no action needed
  }
}

async function hashFile(filePath) {
  const hash = crypto.createHash('sha256');
  const data = await fs.readFile(filePath);
  hash.update(data);
  return hash.digest('hex');
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

function detectPackageManager(packageJson, files) {
  const declared = packageJson.packageManager?.split('@')[0];
  if (declared === 'npm' || declared === 'pnpm' || declared === 'yarn') return declared;
  if (files.includes('pnpm-lock.yaml')) return 'pnpm';
  if (files.includes('yarn.lock')) return 'yarn';
  return 'npm';
}

function dependencyContract(packageJson) {
  return JSON.stringify({
    packageManager: packageJson.packageManager ?? null,
    engines: packageJson.engines ?? null,
    dependencies: packageJson.dependencies ?? {},
    devDependencies: packageJson.devDependencies ?? {},
    optionalDependencies: packageJson.optionalDependencies ?? {},
    overrides: packageJson.overrides ?? {},
  });
}

const DEPENDENCY_OBJECT_KEYS = [
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'overrides',
];

function dependencyContractChanged(currentPackage, incomingPackage) {
  if (incomingPackage.packageManager && currentPackage.packageManager !== incomingPackage.packageManager) return true;
  if (
    Object.entries(incomingPackage.engines ?? {}).some(
      ([name, version]) => !isDeepStrictEqual(currentPackage.engines?.[name], version)
    )
  ) {
    return true;
  }

  return DEPENDENCY_OBJECT_KEYS.some((key) =>
    Object.entries(incomingPackage[key] ?? {}).some(
      ([name, version]) => !isDeepStrictEqual(currentPackage[key]?.[name], version)
    )
  );
}

function mergeContractValue(currentValue, incomingValue) {
  const currentIsObject = currentValue && typeof currentValue === 'object' && !Array.isArray(currentValue);
  const incomingIsObject = incomingValue && typeof incomingValue === 'object' && !Array.isArray(incomingValue);
  if (!currentIsObject || !incomingIsObject) return incomingValue;

  return Object.fromEntries(
    [...new Set([...Object.keys(currentValue), ...Object.keys(incomingValue)])].map((key) => [
      key,
      key in incomingValue
        ? mergeContractValue(currentValue[key], incomingValue[key])
        : currentValue[key],
    ])
  );
}

async function mergeDependencyContract(rootDir, incomingPackage) {
  const packagePath = path.join(rootDir, 'package.json');
  const currentPackage = await readJson(packagePath);
  const mergedPackage = { ...currentPackage };

  if (incomingPackage.packageManager) mergedPackage.packageManager = incomingPackage.packageManager;
  if (incomingPackage.engines) {
    mergedPackage.engines = { ...(currentPackage.engines ?? {}), ...incomingPackage.engines };
  }
  for (const key of DEPENDENCY_OBJECT_KEYS) {
    if (incomingPackage[key]) {
      mergedPackage[key] = mergeContractValue(currentPackage[key] ?? {}, incomingPackage[key]);
    }
  }

  if (JSON.stringify(currentPackage) !== JSON.stringify(mergedPackage)) {
    await fs.writeFile(packagePath, `${JSON.stringify(mergedPackage, null, 2)}\n`, 'utf8');
  }
}

function requiredPackageScripts(incomingPackage, postUpdateChecks = []) {
  return Object.fromEntries(
    postUpdateChecks
      .filter((check) => check !== 'typecheck')
      .map((check) => {
        const command = incomingPackage.scripts?.[check];
        if (typeof command !== 'string' || command.trim() === '') {
          throw new Error(`Core package.json does not define required post-update script: ${check}`);
        }
        return [check, command];
      })
  );
}

async function mergeRequiredPackageScripts(rootDir, requiredScripts) {
  const packagePath = path.join(rootDir, 'package.json');
  const currentPackage = await readJson(packagePath);
  const scripts = { ...(currentPackage.scripts ?? {}) };
  let changed = false;

  for (const [name, command] of Object.entries(requiredScripts)) {
    if (typeof scripts[name] === 'string' && scripts[name].trim() !== '') continue;
    scripts[name] = command;
    changed = true;
  }

  if (changed) {
    await fs.writeFile(
      packagePath,
      `${JSON.stringify({ ...currentPackage, scripts }, null, 2)}\n`,
      'utf8'
    );
  }
}

async function installForwardOnlyMigrations(rootDir, assessment) {
  for (const migration of assessment.changedMigrations) {
    const sourcePath = path.join(assessment.incomingRoot, migration.path);
    const destinationPath = path.join(rootDir, migration.path);

    try {
      const existingHash = await hashFile(destinationPath);
      if (existingHash === migration.hash) continue;
      throw new Error(
        `Forward-only migration collision at ${migration.path}. The existing migration was preserved; resolve the history manually.`,
      );
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }

    await fs.mkdir(path.dirname(destinationPath), { recursive: true });
    await fs.copyFile(sourcePath, destinationPath);
  }
}

async function migrationHashes(rootDir, migrationPaths = DEFAULT_MIGRATION_PATHS) {
  const files = await walkFiles(rootDir);
  const migrations = files.filter(
    (file) => pathMatchesManifest(file, migrationPaths) && file.endsWith('.sql'),
  );
  return new Map(
    await Promise.all(migrations.map(async (migration) => [migration, await hashFile(path.join(rootDir, migration))])),
  );
}

async function assessPostUpdateWork(rootDir, updateDir, options = {}) {
  const [currentPackage, incomingPackage, incomingFiles] = await Promise.all([
    readJson(path.join(rootDir, 'package.json')),
    readJson(path.join(updateDir, 'package.json')),
    walkFiles(updateDir),
  ]);
  const migrationPaths = options.forwardOnlyMigrationPaths ?? DEFAULT_MIGRATION_PATHS;
  const incomingMigrations = incomingFiles.filter(
    (file) => pathMatchesManifest(file, migrationPaths) && file.endsWith('.sql')
  );
  const changedMigrations = [];

  for (const migration of incomingMigrations) {
    const incomingHash = await hashFile(path.join(updateDir, migration));
    if (options.baselineMigrationHashes?.has(migration)) {
      if (options.baselineMigrationHashes.get(migration) !== incomingHash) {
        throw new Error(`Published migration changed after installation: ${migration}`);
      }
      continue;
    }
    try {
      const currentHash = await hashFile(path.join(rootDir, migration));
      if (currentHash !== incomingHash) changedMigrations.push({ path: migration, hash: incomingHash });
    } catch {
      changedMigrations.push({ path: migration, hash: incomingHash });
    }
  }

  const requiredScripts = requiredPackageScripts(incomingPackage, options.postUpdateChecks);
  const missingRequiredScripts = Object.keys(requiredScripts).filter(
    (name) => typeof currentPackage.scripts?.[name] !== 'string' || currentPackage.scripts[name].trim() === ''
  );

  return {
    dependencyChanged: dependencyContractChanged(currentPackage, incomingPackage),
    incomingPackage,
    incomingRoot: updateDir,
    incomingFiles,
    changedMigrations,
    requiredScripts,
    missingRequiredScripts,
  };
}

async function mergeManagedHashes(rootDir, manifest) {
  const mergePaths = (manifest?.mergeManagedPaths ?? []).filter(
    (mergePath) => !AUTOMATIC_MERGE_PATHS.has(mergePath)
  );
  const hashes = new Map();
  for (const mergePath of mergePaths) {
    try {
      hashes.set(mergePath, await hashFile(path.join(rootDir, mergePath)));
    } catch (error) {
      if (error?.code === 'ENOENT') hashes.set(mergePath, null);
      else throw error;
    }
  }
  return hashes;
}

async function changedManualMergePaths(baselineDir, latestDir, manifest) {
  const baselineHashes = await mergeManagedHashes(baselineDir, manifest);
  return changedManualMergePathsFromHashes(baselineHashes, latestDir, manifest);
}

async function changedManualMergePathsFromHashes(baselineHashes, latestDir, manifest) {
  const latestHashes = await mergeManagedHashes(latestDir, manifest);
  const changed = [];
  for (const [mergePath, latestHash] of latestHashes) {
    if (!baselineHashes.has(mergePath) || baselineHashes.get(mergePath) !== latestHash) changed.push(mergePath);
  }
  return changed;
}

async function managedFileHashes(rootDir, managedFilePaths) {
  return new Map(
    await Promise.all(
      managedFilePaths.map(async (relPath) => [relPath, await hashFile(path.join(rootDir, relPath))])
    )
  );
}

async function verifyManagedFiles(rootDir, expectedHashes) {
  const mismatches = [];
  for (const [relPath, expectedHash] of expectedHashes) {
    try {
      if ((await hashFile(path.join(rootDir, relPath))) !== expectedHash) mismatches.push(relPath);
    } catch {
      mismatches.push(relPath);
    }
  }
  if (mismatches.length > 0) {
    throw new Error(`Managed files do not match the target Core: ${mismatches.join(', ')}`);
  }
}

async function verifyPostUpdateFiles(rootDir, assessment) {
  const currentPackage = await readJson(path.join(rootDir, 'package.json'));
  if (dependencyContractChanged(currentPackage, assessment.incomingPackage)) {
    throw new Error('The incoming dependency contract was not merged into package.json.');
  }
  for (const name of Object.keys(assessment.requiredScripts ?? {})) {
    if (typeof currentPackage.scripts?.[name] !== 'string' || currentPackage.scripts[name].trim() === '') {
      throw new Error(`Required post-update package script was not installed: ${name}`);
    }
  }
  for (const migration of assessment.changedMigrations) {
    if ((await hashFile(path.join(rootDir, migration.path))) !== migration.hash) {
      throw new Error(`Required migration was not installed: ${migration.path}`);
    }
  }
}

async function runPostUpdateSteps(rootDir, assessment, options = {}) {
  const run = options.run ?? execCommand;
  const confirm = options.confirm ?? askYesNo;
  await mergeDependencyContract(rootDir, assessment.incomingPackage);
  await mergeRequiredPackageScripts(rootDir, assessment.requiredScripts ?? {});
  await installForwardOnlyMigrations(rootDir, assessment);
  await verifyPostUpdateFiles(rootDir, assessment);

  if (assessment.dependencyChanged) {
    const packageManager = detectPackageManager(assessment.incomingPackage, assessment.incomingFiles);
    const installCommand = packageManager === 'npm' ? 'npm install' : `${packageManager} install`;
    console.log(`\x1b[34mInstalling updated dependencies with ${packageManager}...\x1b[0m`);
    await run(installCommand, { cwd: rootDir });
  }

  if (assessment.changedMigrations.length === 0) return true;

  console.log('\x1b[33mThe core update adds these Supacharger migration files:\x1b[0m');
  assessment.changedMigrations.forEach((migration) => console.log(`  - ${migration.path}`));
  await run('npx supabase db push --linked --dry-run', { cwd: rootDir });
  const answer = await confirm(
    'Supabase will apply every pending local migration shown in the dry run, including consumer-owned migrations. Enter Y to apply that complete displayed set: '
  );
  if (answer.toLowerCase() !== 'y') {
    console.log('\x1b[33mCore files were copied, but the update is incomplete. The core lock was not advanced.\x1b[0m');
    return false;
  }
  await run('npx supabase db push --linked --yes', { cwd: rootDir });
  const migrationList = await run('npx supabase migration list --linked --output json', { cwd: rootDir });
  const linkedMigrations = JSON.parse(migrationList.stdout).migrations ?? [];
  for (const migration of assessment.changedMigrations) {
    const version = path.basename(migration.path).match(/^\d+/)?.[0];
    if (!version || !linkedMigrations.some((entry) => entry.remote === version)) {
      throw new Error(`Supabase did not report migration ${migration.path} in the linked migration ledger.`);
    }
  }
  return true;
}

async function runPostUpdateChecks(rootDir, manifest, options = {}) {
  const run = options.run ?? execCommand;
  const packageJson = await readJson(path.join(rootDir, 'package.json'));
  const scripts = packageJson.scripts ?? {};
  const requestedChecks = manifest?.postUpdateChecks ?? [];
  const packageManager = detectPackageManager(packageJson, await walkFiles(rootDir));

  for (const check of requestedChecks) {
    if (check === 'typecheck') {
      await run('npx tsc --noEmit', { cwd: rootDir });
    } else if (scripts[check]) {
      await run(`${packageManager} run ${check}`, { cwd: rootDir });
    } else {
      throw new Error(`Required post-update check is unavailable: ${check}`);
    }
  }
}

async function walkFiles(baseDir, currentDir = '') {
  const dirPath = path.join(baseDir, currentDir);
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  let files = [];

  for (const entry of entries) {
    const relPath = path.join(currentDir, entry.name);
    if (entry.isDirectory()) {
      const subFiles = await walkFiles(baseDir, relPath);
      files = files.concat(subFiles);
    } else if (entry.isFile()) {
      files.push(relPath);
    }
  }
  return files;
}

async function removeDirContents(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  await Promise.all(
    entries.map(async (entry) => {
      const fullPath = path.join(dir, entry.name);
      await fs.rm(fullPath, { recursive: true, force: true });
    })
  );
}

async function moveFileToRoot(updateDir, relPath, rootDir) {
  const destPath = path.join(rootDir, relPath);
  const destDir = path.dirname(destPath);
  await fs.mkdir(destDir, { recursive: true });
  await fs.rename(path.join(updateDir, relPath), destPath);
}

function matchingPreservedPath(relPath, preservedPaths) {
  return preservedPaths.find(
    (preservedPath) =>
      relPath === preservedPath || relPath.startsWith(`${preservedPath}${path.sep}`)
  );
}

async function backupConflicts(updateDir, rootDir, conflictFiles, backupRoot) {
  const resolvedBackupRoot = backupRoot ?? path.join(rootDir, '.supacharger', 'backups', new Date().toISOString().replace(/[:.]/g, '-'));
  for (const relPath of conflictFiles) {
    const localFile = path.join(rootDir, relPath);
    const backupFile = path.join(resolvedBackupRoot, relPath);

    try {
      await fs.mkdir(path.dirname(backupFile), { recursive: true });
      await fs.copyFile(localFile, backupFile);
      console.log(`\x1b[33mBacked up file:\x1b[0m ${relPath} -> ${backupFile}`);
    } catch (err) {
      if (err?.code === 'ENOENT') continue;
      throw new Error(`Failed to back up ${relPath}: ${err.message}`);
    }
  }
  return resolvedBackupRoot;
}

async function removeObsoleteManagedFiles(rootDir, baselineFiles, incomingFiles, preservedPaths = []) {
  const incoming = new Set(incomingFiles);
  const removed = [];
  for (const relPath of baselineFiles) {
    if (incoming.has(relPath) || matchingPreservedPath(relPath, preservedPaths)) continue;
    const target = path.join(rootDir, relPath);
    try {
      await fs.rm(target);
      removed.push(relPath);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }
  return removed;
}


// Clone latest main branch fully (used when no conflicts)
async function cloneLatestMain(updateDir) {
  await removeDirContents(updateDir);

  console.log('\x1b[34mProceeding to clone the main branch latest commit into the update directory.\x1b[0m');

  await execCommand(
    `git clone --depth 1 --branch main ${CORE_SSH_URL} "${updateDir}"`
  );
  const { stdout } = await execCommand('git rev-parse HEAD', { cwd: updateDir });
  console.log('\x1b[32mLatest main branch cloned.\x1b[0m');
  return stdout.trim();
}

async function cloneAndCheckout(updateDir, commitHash, repository = CORE_REPOSITORY) {
  await removeDirContents(updateDir);
  console.log('\x1b[34mCloning the installed core baseline commit...\x1b[0m');
  await execCommand(
    `git clone --no-checkout --branch main git@github.com:${repository}.git "${updateDir}"`
  );
  await execCommand(`git -C "${updateDir}" config advice.detachedHead false`);
  console.log(`\x1b[34mChecking out commit ${commitHash}...\x1b[0m`);
  await execCommand(`git -C "${updateDir}" checkout ${commitHash}`);
  await removeGitDir(updateDir);
}

async function moveFiles(updateDir, rootDir, preservedPaths = [], managedPaths = null) {
  const files = await walkFiles(updateDir);
  for (const relPath of files) {
    if (managedPaths && !pathMatchesManifest(relPath, managedPaths)) continue;
    const preservedPath = matchingPreservedPath(relPath, preservedPaths);
    if (preservedPath) {
      try {
        await fs.access(path.join(rootDir, preservedPath));
        continue;
      } catch {
        // Install starter content only when the developer-owned file or directory is absent.
      }
    }
    await moveFileToRoot(updateDir, relPath, rootDir);
  }
}

async function installMissingDeveloperStarters(updateDir, rootDir, relativePaths = AUTH_DEVELOPER_STARTERS) {
  const installed = [];
  for (const relPath of relativePaths) {
    const source = path.join(updateDir, relPath);
    const target = path.join(rootDir, relPath);
    try {
      await fs.access(target);
      continue;
    } catch {
      // A developer-owned starter is copied once, then preserved on later updates.
    }
    try {
      await fs.access(source);
    } catch (error) {
      if (error?.code === 'ENOENT') continue;
      throw error;
    }
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.copyFile(source, target);
    installed.push(relPath);
  }
  return installed;
}

async function migrateLegacyAuthRoutes(rootDir, baselineDir) {
  const removable = [];
  for (const relPath of LEGACY_AUTH_ROUTE_FILES) {
    const localPath = path.join(rootDir, relPath);
    const baselinePath = path.join(baselineDir, relPath);
    try {
      await fs.access(localPath);
    } catch (error) {
      if (error?.code === 'ENOENT') continue;
      throw error;
    }
    try {
      if ((await hashFile(localPath)) !== (await hashFile(baselinePath))) {
        throw new Error(
          `${relPath} contains application changes. Move them into the auth sidecar adapter before updating the core.`,
        );
      }
    } catch (error) {
      if (error?.code === 'ENOENT') {
        throw new Error(`${relPath} cannot be migrated because it is missing from the installed Core baseline.`);
      }
      throw error;
    }
    removable.push(relPath);
  }
  if (removable.length === 0) return [];
  await backupConflicts(rootDir, rootDir, removable);
  for (const relPath of removable) await fs.rm(path.join(rootDir, relPath));
  return removable;
}

async function buildUpdatePlan(rootDir, baselineDir, latestDir) {
  const [baselineManifest, latestManifest] = await Promise.all([
    readManagedManifest(baselineDir),
    readManagedManifest(latestDir),
  ]);
  const baselineMigrationHashes = await migrationHashes(
    baselineDir,
    baselineManifest?.forwardOnlyMigrationPaths ?? DEFAULT_MIGRATION_PATHS
  );
  const [
    baselineFiles,
    latestFiles,
    assessment,
    authProviderConfigMigration,
    legacyAuthSessionConfigMigration,
    rootDocumentConfigMigration,
  ] = await Promise.all([
    managedFiles(baselineDir, baselineManifest),
    managedFiles(latestDir, latestManifest),
    assessPostUpdateWork(rootDir, latestDir, {
      baselineMigrationHashes,
      forwardOnlyMigrationPaths: latestManifest?.forwardOnlyMigrationPaths,
      postUpdateChecks: latestManifest?.postUpdateChecks,
    }),
    migrateAuthProviderConfig(rootDir, { plan: true }),
    migrateLegacyAuthSessionConfig(rootDir, { plan: true }),
    migrateRootDocumentConfig(rootDir, { plan: true }),
  ]);
  const writes = [];
  for (const relPath of latestFiles) {
    try {
      if ((await hashFile(path.join(rootDir, relPath))) !== (await hashFile(path.join(latestDir, relPath)))) writes.push(relPath);
    } catch {
      writes.push(relPath);
    }
  }
  const latestSet = new Set(latestFiles);
  const removals = baselineFiles.filter(
    (file) => !latestSet.has(file) && !matchingPreservedPath(file, latestManifest?.developerOwnedPaths ?? DEVELOPER_OWNED_PATHS)
  );
  return {
    assessment,
    authProviderConfigMigration,
    baselineFiles,
    latestFiles,
    latestManifest,
    legacyAuthSessionConfigMigration,
    manualMergeChanges: await changedManualMergePaths(baselineDir, latestDir, latestManifest),
    removals,
    rootDocumentConfigMigration,
    writes,
  };
}

async function printPlan(rootDir, installState) {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'supacharger-core-plan-'));
  const baselineDir = path.join(tempRoot, 'baseline');
  const latestDir = path.join(tempRoot, 'latest');
  await fs.mkdir(baselineDir);
  await fs.mkdir(latestDir);
  try {
    await cloneAndCheckout(baselineDir, installState.commit, installState.repository);
    await cloneLatestMain(latestDir);
    const plan = await buildUpdatePlan(rootDir, baselineDir, latestDir);
    console.log('\nSupacharger core update plan (no project files or databases changed)');
    console.log(`Managed writes: ${plan.writes.length}`);
    plan.writes.forEach((file) => console.log(`  WRITE ${file}`));
    console.log(`Obsolete managed removals: ${plan.removals.length}`);
    plan.removals.forEach((file) => console.log(`  REMOVE ${file}`));
    console.log(`Dependency contract changed: ${plan.assessment.dependencyChanged ? 'yes' : 'no'}`);
    console.log(`Missing required package scripts: ${plan.assessment.missingRequiredScripts.length}`);
    plan.assessment.missingRequiredScripts.forEach((script) => console.log(`  SCRIPT ${script}`));
    console.log(`Changed migrations: ${plan.assessment.changedMigrations.length}`);
    plan.assessment.changedMigrations.forEach(({ path: migration }) => console.log(`  MIGRATION ${migration}`));
    console.log(`Manual merge-managed changes: ${plan.manualMergeChanges.length}`);
    plan.manualMergeChanges.forEach((file) => console.log(`  MANUAL MERGE ${file}`));
    console.log(
      `Developer config changes: ${plan.authProviderConfigMigration.length + plan.legacyAuthSessionConfigMigration.length + plan.rootDocumentConfigMigration.length}`
    );
    plan.authProviderConfigMigration.forEach((provider) => console.log(`  CONFIG AUTH_PROVDERS_ENABLED.${provider}=false`));
    plan.legacyAuthSessionConfigMigration.forEach((key) => console.log(`  CONFIG REMOVE ${key}`));
    plan.rootDocumentConfigMigration.forEach((key) => console.log(`  CONFIG ${key}`));
    console.log(`Post-update checks: ${(plan.latestManifest?.postUpdateChecks ?? []).join(', ') || 'none'}`);
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
}

async function coreupdate(options = {}) {
  const integrityIgnoredFiles = [
    ...DEVELOPER_OWNED_PATHS,
    ...LEGACY_PROJECT_STYLE_FILES,
    'src/supacharger/supacharger-config.ts',
  ];

  try {
    const cwd = process.cwd();
    const installState = await readInstallState(cwd);
    if (!installState) {
      console.error('\x1b[31mError: Supacharger installation metadata is missing. Aborting.\x1b[0m');
      process.exit(1);
    }

    if (options.plan === true) {
      await printPlan(cwd, installState);
      return;
    }

    const warningMessage = `
\u001b[37;41m
WARNING: THIS ACTION CAN SERIOUSLY DAMAGE YOUR APPLICATION!\u001b[0m\u001b[33m
I will pull the latest core files and install changed dependencies. If database migrations changed,
I will show a Supabase dry run and ask separately before applying them to the linked project.
Ensure you have committed any unsaved changes, are on an appropriate branch and are not making changes to a production database.
You have been warned!
Enter Y to continue: \u001b[0m`;

    const answer = await askYesNo(warningMessage);
    if (answer.toLowerCase() !== 'y') {
      console.log('\x1b[31mAborted by user. No changes were made.\x1b[0m');
      process.exit(0);
    }

    const updateDir = path.resolve(cwd, '.sc-core-update');

    await migrateLegacyConfig(cwd);
    await migrateLegacyProjectStyles(cwd);

    const localHash = installState.commit;
    console.log(`\x1b[34mCurrent core commit:\x1b[0m \x1b[32m${localHash}\x1b[0m`);

    let remoteHash = await getRemoteMainHash(installState.repository);
    console.log(`\x1b[34mLatest remote main branch commit hash:\x1b[0m \x1b[32m${remoteHash}\x1b[0m`);

    await fs.rm(updateDir, { recursive: true, force: true });
    await fs.mkdir(updateDir, { recursive: true });
    console.log(`\x1b[34mCreated or cleaned directory:\x1b[0m \x1b[32m${updateDir}\x1b[0m`);

    await cloneAndCheckout(updateDir, localHash, installState.repository);

    console.log('\x1b[34m\nChecking Core Integrity...\x1b[0m');

    const baselineManifest = await readManagedManifest(updateDir);
    const updateFiles = await managedFiles(updateDir, baselineManifest);
    const baselineManagedFiles = [...updateFiles];
    const baselineMigrationHashes = await migrationHashes(
      updateDir,
      baselineManifest?.forwardOnlyMigrationPaths ?? DEFAULT_MIGRATION_PATHS,
    );
    const baselineMergeHashes = await managedFileHashes(updateDir, await walkFiles(updateDir));

    const missingFiles = [];
    const differentFiles = [];

    for (const relPath of updateFiles) {
      if (matchingPreservedPath(relPath, integrityIgnoredFiles)) continue;

      const updateFilePath = path.join(updateDir, relPath);
      const localFilePath = path.join(cwd, relPath);

      try {
        await fs.access(localFilePath);
      } catch {
        missingFiles.push(relPath);
        continue;
      }

      const [hashUpdate, hashLocal] = await Promise.all([
        hashFile(updateFilePath),
        hashFile(localFilePath),
      ]);

      if (hashUpdate !== hashLocal) {
        differentFiles.push(relPath);
      }
    }

    if (missingFiles.length === 0 && differentFiles.length === 0) {
      console.log('\x1b[32m✓ Local files match the installed core baseline.\x1b[0m');
      await migrateLegacyAuthRoutes(cwd, updateDir);
      await removeDirContents(updateDir);
      remoteHash = await cloneLatestMain(updateDir);
      const latestManifest = await readManagedManifest(updateDir);
      const latestManagedFiles = await managedFiles(updateDir, latestManifest);
      const manualMergeChanges = await changedManualMergePathsFromHashes(
        baselineMergeHashes,
        updateDir,
        latestManifest,
      );
      if (manualMergeChanges.length > 0) {
        throw new Error(
          `Core changed merge-managed files that require an explicit merge strategy: ${manualMergeChanges.join(', ')}`,
        );
      }
      const assessment = await assessPostUpdateWork(cwd, updateDir, {
        baselineMigrationHashes,
        forwardOnlyMigrationPaths: latestManifest?.forwardOnlyMigrationPaths,
        postUpdateChecks: latestManifest?.postUpdateChecks,
      });
      const latestManagedHashes = await managedFileHashes(updateDir, latestManagedFiles);
      const preservedPaths = latestManifest?.developerOwnedPaths ?? DEVELOPER_OWNED_PATHS;
      const targetsToBackup = [...latestManagedFiles, ...baselineManagedFiles.filter((file) => !latestManagedFiles.includes(file))];
      await backupConflicts(cwd, cwd, targetsToBackup);
      await moveFiles(updateDir, cwd, preservedPaths, latestManifest?.managedPaths ?? null);
      await installMissingDeveloperStarters(updateDir, cwd);
      await removeObsoleteManagedFiles(cwd, baselineManagedFiles, latestManagedFiles, preservedPaths);
      await migrateLegacyAuthSessionConfig(cwd);
      await migrateAuthProviderConfig(cwd);
      await migrateRootDocumentConfig(cwd);
      await migrateLegacyPostcssConfig(cwd);
      await personaliseStarterProjectStyles(cwd);
      const postUpdateComplete = await runPostUpdateSteps(cwd, assessment);
      if (!postUpdateComplete) {
        await fs.rm(updateDir, { recursive: true, force: true });
        return;
      }
      await runPostUpdateChecks(cwd, latestManifest);
      await verifyManagedFiles(cwd, latestManagedHashes);
      await writeCoreLock(cwd, remoteHash);
      await fs.rm(updateDir, { recursive: true, force: true });
      console.log('\x1b[32mUpdate complete and .sc-core-update folder removed.\x1b[0m');
      return;
    }

    console.log(
      '\x1b[41m\x1b[97m CONFLICTS! \x1b[0m \x1b[34m\nThe following core files have been modified or are missing:\x1b[0m'
    );

    missingFiles.forEach((f) => console.log(`  - \x1b[33mMISSING\x1b[0m: ${f}`));
    differentFiles.forEach((f) => console.log(`  - \x1b[31mMODIFIED\x1b[0m: ${f}`));

    const prompt = `
\x1b[34mchoose action:
\x1b[31m(O)\x1b[34m overwrite all
\x1b[33m(S)\x1b[34m skip conflict files overwrite the rest
\x1b[36m(OB)\x1b[34m overwrite all with backup of conflict files
\x1b[35m(E)\x1b[0m exit
\x1b[34mYour choice: \x1b[0m`;

    const action = (await askYesNo(prompt)).toUpperCase();

    if (action === 'E') {
      console.log('\x1b[34mExiting without changes.\x1b[0m');
      process.exit(0);
    }

    if (action !== 'O' && action !== 'S' && action !== 'OB') {
      console.log('\x1b[31mInvalid choice. Exiting.\x1b[0m');
      process.exit(1);
    }

    await migrateLegacyAuthRoutes(cwd, updateDir);
    await fs.rm(updateDir, { recursive: true, force: true });
    await fs.mkdir(updateDir, { recursive: true });
    await cloneAndCheckout(updateDir, remoteHash);
    const latestManifest = await readManagedManifest(updateDir);
    const latestManagedFiles = await managedFiles(updateDir, latestManifest);
    const preservedPaths = latestManifest?.developerOwnedPaths ?? DEVELOPER_OWNED_PATHS;
    const manualMergeChanges = await changedManualMergePathsFromHashes(
      baselineMergeHashes,
      updateDir,
      latestManifest,
    );
    if (manualMergeChanges.length > 0) {
      throw new Error(
        `Core changed merge-managed files that require an explicit merge strategy: ${manualMergeChanges.join(', ')}`,
      );
    }
    const assessment = await assessPostUpdateWork(cwd, updateDir, {
      baselineMigrationHashes,
      forwardOnlyMigrationPaths: latestManifest?.forwardOnlyMigrationPaths,
      postUpdateChecks: latestManifest?.postUpdateChecks,
    });
    const latestManagedHashes = await managedFileHashes(updateDir, latestManagedFiles);

    if (action === 'OB') {
      // Backup conflicting files first
      await backupConflicts(cwd, cwd, [...differentFiles, ...missingFiles]);
      // Then move all files (including conflicts)
      await moveFiles(updateDir, cwd, preservedPaths, latestManifest?.managedPaths ?? null);
    } else if (action === 'O') {
      await backupConflicts(cwd, cwd, [
        ...latestManagedFiles,
        ...baselineManagedFiles.filter((file) => !latestManagedFiles.includes(file)),
      ]);
      await moveFiles(updateDir, cwd, preservedPaths, latestManifest?.managedPaths ?? null);
    } else if (action === 'S') {
      await moveFiles(updateDir, cwd, [
        ...preservedPaths,
        ...differentFiles,
        ...missingFiles,
      ], latestManifest?.managedPaths ?? null);
    }
    await installMissingDeveloperStarters(updateDir, cwd);

    await removeObsoleteManagedFiles(
      cwd,
      baselineManagedFiles,
      latestManagedFiles,
      action === 'S' ? [...preservedPaths, ...differentFiles, ...missingFiles] : preservedPaths
    );

    await migrateLegacyAuthSessionConfig(cwd);
    await migrateAuthProviderConfig(cwd);
    await migrateRootDocumentConfig(cwd);
    await migrateLegacyPostcssConfig(cwd);
    await personaliseStarterProjectStyles(cwd);
    const postUpdateComplete = await runPostUpdateSteps(cwd, assessment);
    if (!postUpdateComplete) {
      await fs.rm(updateDir, { recursive: true, force: true });
      return;
    }
    await runPostUpdateChecks(cwd, latestManifest);
    await verifyManagedFiles(cwd, latestManagedHashes);
    await writeCoreLock(cwd, remoteHash);

    await fs.rm(updateDir, { recursive: true, force: true });

    console.log('\x1b[32mUpdate complete and .sc-core-update folder removed.\x1b[0m');
  } catch (err) {
    console.error('Error during coreupdate:', err);
    process.exit(1);
  }
}

coreupdate.testHelpers = {
  assessPostUpdateWork,
  buildUpdatePlan,
  dependencyContract,
  dependencyContractChanged,
  detectPackageManager,
  changedManualMergePaths,
  matchingPreservedPath,
  migrateAuthProviderConfig,
  migrateLegacyAuthSessionConfig,
  migrateLegacyConfig,
  migrateLegacyPostcssConfig,
  migrateLegacyProjectStyles,
  migrateLegacyAuthRoutes,
  migrateRootDocumentConfig,
  installMissingDeveloperStarters,
  moveFiles,
  mergeDependencyContract,
  mergeRequiredPackageScripts,
  managedFiles,
  managedFileHashes,
  readManagedManifest,
  removeObsoleteManagedFiles,
  personaliseStarterProjectStyles,
  readInstallState,
  runPostUpdateSteps,
  runPostUpdateChecks,
  requiredPackageScripts,
  verifyManagedFiles,
  verifyPostUpdateFiles,
  writeCoreLock,
};

module.exports = coreupdate;
