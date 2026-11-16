import { collectSchemas, planDatabaseUpdate, applyDatabaseUpdate, generateProjectMigration, completeDatabaseUpdate, type DatabaseUpdateOptions } from './common/declarative-database';
import { exec, type ExecOptions } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import readline from 'readline';
import os from 'os';
import { isDeepStrictEqual } from 'node:util';
import ts from 'typescript';


import { cleanScripts, isTestScript } from './common/test-distribution';
import { checkLocalCore, prepareCoreTarget } from './common/core-compatibility';
import messages from '../messages/en.json';
const cleanupMessages = messages.ApplicationCleanup;


type JsonValue = string | number | boolean | null | JsonValue[] | JsonObject;
interface JsonObject { [key: string]: JsonValue | undefined }
interface PackageJson extends JsonObject {
  packageManager?: string;
  scripts?: Record<string, string>;
  engines?: Record<string, string>;
  dependencies?: JsonObject;
  devDependencies?: JsonObject;
  optionalDependencies?: JsonObject;
  overrides?: JsonObject;
  allowScripts?: Record<string, boolean>;
}
interface ManagedManifest {
  version: 1 | 2;
  managedPaths: string[];
  mergeManagedPaths: string[];
  forwardOnlyMigrationPaths: string[];
  developerOwnedPaths: string[];
}
interface InstallState { commit: string; repository: string }
type FileContents = Map<string, Buffer | null>;
type CommandResult = { stdout: string; stderr?: string };
type CommandRunner = (command: string, options: ExecOptions) => Promise<CommandResult>;
interface UpdateOptions extends DatabaseUpdateOptions {
  plan?: boolean;
  backup?: boolean;
  quiet?: boolean;
  sourceRoot?: string;
  source?: string;
  ref?: string;
  coreVersion?: string;
  forwardOnlyMigrationPaths?: string[];
  run?: CommandRunner;
  confirm?: (question: string) => Promise<string>;
}
type PostUpdateAssessment = Awaited<ReturnType<typeof assessPostUpdateWork>>;
interface ParsedSourceFile extends ts.SourceFile { parseDiagnostics: readonly ts.DiagnosticWithLocation[] }

const CORE_REPOSITORY = 'glowplug-studio/supacharger';
const CORE_SSH_URL = `git@github.com:${CORE_REPOSITORY}.git`;
const CORE_LOCK_FILE = path.join('.supacharger', 'core-lock.json');
const MANAGED_FILES_MANIFEST = path.join('.supacharger', 'managed-files.json');
const MIGRATION_ALIASES_FILE = path.join('.supacharger', 'migration-aliases.json');
const AUTOMATIC_MERGE_PATHS = new Set(
  ['package.json', 'package-lock.json', 'supabase/config.toml'].map((entry) => path.normalize(entry))
);
const DEFAULT_MIGRATION_PATHS = [path.join('supabase', 'migrations')];
const PROJECT_STYLES_FILE = path.join('src', 'styles', 'project.css');
const UI_THEME_FILE = path.join('src', 'styles', 'ui-theme.ts');
const PROJECT_TAILWIND_CONFIG_FILE = 'tailwind.project.config.ts';
const AUTH_SIDECAR_FILE = path.join('src', 'supacharger.adapters', 'auth', 'auth-sidecar.tsx');
const ACCOUNT_ADAPTER_FILES = [
  'details-page.tsx',
  'navigation.ts',
  'notifications.ts',
  'presentation.ts',
  'privacy.ts',
  'profile-extension.ts',
  'profile-fields.tsx',
  'security-page.tsx',
  'chrome.tsx',
].map((file) => path.join('src', 'supacharger.adapters', 'account', file));
const BILLING_ADAPTER_FILES = ['acquisition.tsx', 'database.ts', 'organisation.ts']
  .map((file) => path.join('src', 'supacharger.adapters', 'billing', file));
const ORGANISATION_ADAPTER_FILES = [
  'chrome.tsx',
  'navigation.ts',
  'pages.tsx',
  'profile-extension.ts',
  'profile-fields.tsx',
]
  .map((file) => path.join('src', 'supacharger.adapters', 'organisations', file));
const IMAGE_LOADER_FILE = path.join('src', 'assets', 'svgr', 'ui', 'image-loader.svg');
const DEVELOPER_STARTERS = [
  UI_THEME_FILE,
  'AGENTS.md',
  '.agents/project/AGENTS.md',
  'CHANGELOG.project.md',
  IMAGE_LOADER_FILE,
  path.join('src', 'supacharger.adapters', 'media', 'image-targets.ts'),
  PROJECT_TAILWIND_CONFIG_FILE,
  path.join('src', 'supacharger.adapters', 'request-guard.ts'),
  AUTH_SIDECAR_FILE,
  ...ACCOUNT_ADAPTER_FILES,
  ...BILLING_ADAPTER_FILES,
  ...ORGANISATION_ADAPTER_FILES,
];
const LEGACY_POSTCSS_CONFIG = `module.exports = {
  plugins: {
    '@tailwindcss/postcss': {},
  },
};`;
const DEVELOPER_OWNED_FILES = [
  UI_THEME_FILE,
  IMAGE_LOADER_FILE,
  PROJECT_TAILWIND_CONFIG_FILE,
  'src/supacharger.config.ts',
  path.join('src', 'app', 'layout.tsx'),
  path.join('src', 'i18n', 'config.ts'),
  path.join('src', 'i18n', 'request.ts'),
  path.join('src', 'assets', 'svgr', 'ui', 'inline-loader-dark.svg'),
  path.join('src', 'assets', 'svgr', 'ui', 'inline-loader.svg'),
  AUTH_SIDECAR_FILE,
  PROJECT_STYLES_FILE,
  CORE_LOCK_FILE,
];
const DEVELOPER_OWNED_DIRECTORIES = ['messages', path.join('public', 'images', 'email-template')];
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
const ROOT_DOCUMENT_CONFIG_KEYS = ['METADATA', 'ROOT_PROVIDERS', 'ANALYTICS'] as const;
const STANDARD_FAVICON_FILES = [
  'favicon.ico',
  path.join('favicons', 'favicon.svg'),
  path.join('favicons', 'favicon-96x96.png'),
  path.join('favicons', 'apple-touch-icon.png'),
  path.join('favicons', 'web-app-manifest-192x192.png'),
  path.join('favicons', 'web-app-manifest-512x512.png'),
  path.join('favicons', 'site.webmanifest'),
];

async function readManagedManifest(rootDir: string) {
  try {
    const manifest = await readJson<ManagedManifest>(path.join(rootDir, MANAGED_FILES_MANIFEST));
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
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return null;
    throw error;
  }
}

function pathMatchesManifest(relPath: string, manifestPaths: string[]) {
  return manifestPaths.some(
    (manifestPath) => relPath === manifestPath || relPath.startsWith(`${manifestPath}${path.sep}`)
  );
}

async function managedFiles(rootDir: string, manifest: ManagedManifest | null) {
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

function execCommand(command: string, options: ExecOptions = {}): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = exec(command, options, (error, stdout, stderr) => {
      if (error) {
        reject(error);
        return;
      }
      resolve({ stdout, stderr } as CommandResult);
    });
    child.stdout?.pipe(process.stdout);
    child.stderr?.pipe(process.stderr);
  });
}

function askYesNo(question: string): Promise<string> {
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

async function readLegacyInstallHash(configPath: string) {
  try {
    const content = await fs.readFile(configPath, 'utf8');
    const match = content.match(/CLI_INSTALL_HASH\s*:\s*['"`]([a-f0-9]+)['"`]/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

async function readInstallState(rootDir: string) {
  const lockPath = path.join(rootDir, CORE_LOCK_FILE);
  try {
    const lock = JSON.parse(await fs.readFile(lockPath, 'utf8')) as Record<string, unknown>;
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
        repository: lock.repository as string,
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

async function writeCoreLock(rootDir: string, commit: string, version?: string) {
  const lockPath = path.join(rootDir, CORE_LOCK_FILE);
  await fs.mkdir(path.dirname(lockPath), { recursive: true });
  await fs.writeFile(
    lockPath,
    `${JSON.stringify({ repository: CORE_REPOSITORY, version, commit }, null, 2)}\n`,
    'utf8'
  );
}

async function migrateLegacyConfig(rootDir: string) {
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

async function assessAuthProviderConfig(rootDir: string) {
  const configPath = path.join(rootDir, 'src', 'supacharger.config.ts');
  let content;
  try {
    content = await fs.readFile(configPath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return { missingKeys: [], propertyIndent: '  ' };
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

async function migrateAuthProviderConfig(rootDir: string, options: UpdateOptions = {}) {
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

// Apply only to literal canonical settings: guessing through spreads, aliases or
// legacy layouts could change a security policy or corrupt developer config.
function signOutPolicyAssessment(source: string, { target = false }: { target?: boolean } = {}) {
  const file = ts.createSourceFile('supacharger.config.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  if ((file as ParsedSourceFile).parseDiagnostics.length) throw new Error('Cannot parse application configuration; migrate sign-out policy manually.');
  const bindings = file.statements.filter(ts.isVariableStatement).flatMap((s) => [...s.declarationList.declarations])
    .filter((d) => ts.isIdentifier(d.name) && d.name.text === 'SC_CONFIG');
  if (bindings.length !== 1) throw new Error('Cannot identify SC_CONFIG uniquely; migrate sign-out policy manually.');
  let object = bindings[0].initializer;
  while (object && (ts.isAsExpression(object) || ts.isSatisfiesExpression(object) || ts.isParenthesizedExpression(object))) object = object.expression;
  const find = (node: ts.Node | undefined, name: string): ts.PropertyAssignment | undefined => {
    if (!node || !ts.isObjectLiteralExpression(node) || node.properties.some((p) => ts.isSpreadAssignment(p) || (p.name && ts.isComputedPropertyName(p.name)))) {
      throw new Error(`Cannot safely inspect ${name}; migrate sign-out policy manually.`);
    }
    const props = node.properties.filter((p) => p.name && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) && p.name.text === name);
    if (props.length > 1 || (props.length && !ts.isPropertyAssignment(props[0]))) {
      throw new Error(`Ambiguous ${name} configuration; migrate sign-out policy manually.`);
    }
    return props[0] as ts.PropertyAssignment | undefined;
  };
  const auth = find(object, 'SUPABASE_AUTH');
  if (!auth) {
    if (target) return null;
    throw new Error('Legacy or missing SUPABASE_AUTH: migrate the complete authentication contract before adding the sign-out policy.');
  }
  const session = find(auth.initializer, 'SESSION');
  if (!session) {
    if (target) return null;
    throw new Error('Missing SUPABASE_AUTH.SESSION: migrate the complete authentication contract before adding the sign-out policy.');
  }
  const property = find(session.initializer, 'SIGN_OUT_ALL_DEVICES');
  if (property) {
    if (property.initializer.kind !== ts.SyntaxKind.TrueKeyword && property.initializer.kind !== ts.SyntaxKind.FalseKeyword) {
      throw new Error('SIGN_OUT_ALL_DEVICES must be a literal boolean; migrate sign-out policy manually.');
    }
    return { present: true };
  }
  if (target) return null;
  const sessionObject = session.initializer as ts.ObjectLiteralExpression;
  const close = sessionObject.getEnd() - 1;
  const properties = sessionObject.properties;
  const last = properties[properties.length - 1];
  const comma = last && !properties.hasTrailingComma ? ',' : '';
  return { present: false, close, comma };
}

async function migrateSignOutPolicyConfig(rootDir: string, options: UpdateOptions = {}) {
  if (!options.sourceRoot) throw new Error('A target Core source is required for sign-out policy migration.');
  const targetPath = path.join(options.sourceRoot, 'src', 'supacharger.config.ts');
  let targetSource;
  try {
    targetSource = await fs.readFile(targetPath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return [];
    throw error;
  }
  if (!signOutPolicyAssessment(targetSource, { target: true })) return [];
  const configPath = path.join(rootDir, 'src', 'supacharger.config.ts');
  const source = await fs.readFile(configPath, 'utf8');
  const assessment = signOutPolicyAssessment(source)!;
  if (assessment.present) return [];
  const changes = ['SUPABASE_AUTH.SESSION.SIGN_OUT_ALL_DEVICES'];
  if (options.plan === true) return changes;
  if (options.backup !== false) await backupConflicts(rootDir, rootDir, ['src/supacharger.config.ts']);
  // The comma is inserted after the final property, not after a trailing comment.
  const parsed = ts.createSourceFile('config.ts', source, ts.ScriptTarget.Latest, true);
  const authDecl = parsed.statements.filter(ts.isVariableStatement).flatMap((s) => [...s.declarationList.declarations]).find((d) => ts.isIdentifier(d.name) && d.name.text === 'SC_CONFIG');
  let root = authDecl!.initializer!;
  while (ts.isAsExpression(root) || ts.isSatisfiesExpression(root) || ts.isParenthesizedExpression(root)) root = root.expression;
  const auth = (root as ts.ObjectLiteralExpression).properties.find((p) => (p.name as ts.Identifier | undefined)?.text === 'SUPABASE_AUTH') as ts.PropertyAssignment;
  const session = ((auth.initializer as ts.ObjectLiteralExpression).properties.find((p) => (p.name as ts.Identifier | undefined)?.text === 'SESSION') as ts.PropertyAssignment).initializer as ts.ObjectLiteralExpression;
  const last = session.properties[session.properties.length - 1];
  const insertCommaAt = last && !session.properties.hasTrailingComma ? last.getEnd() : -1;
  let migrated = `${source.slice(0, assessment.close)}\n    SIGN_OUT_ALL_DEVICES: true,\n  ${source.slice(assessment.close)}`;
  if (insertCommaAt >= 0) migrated = `${migrated.slice(0, insertCommaAt)},${migrated.slice(insertCommaAt)}`;
  await fs.writeFile(configPath, migrated, 'utf8');
  console.log('Added SUPABASE_AUTH.SESSION.SIGN_OUT_ALL_DEVICES=true to preserve existing global sign-out behaviour.');
  return changes;
}

async function migrateLegacyAuthSessionConfig(rootDir: string, options: UpdateOptions = {}) {
  const configPath = path.join(rootDir, 'src', 'supacharger.config.ts');
  let content;
  try {
    content = await fs.readFile(configPath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return [];
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

async function migrateLegacyMfaConfig(rootDir: string, options: UpdateOptions = {}) {
  const configPath = path.join(rootDir, 'src', 'supacharger.config.ts');
  let source;
  try {
    source = await fs.readFile(configPath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return [];
    throw error;
  }

  const bounds = objectBlockBounds(source, 'MFA_TOTP');
  if (!bounds) return [];
  const block = source.slice(bounds.open, bounds.close + 1);
  const legacyProperty = /\bENABLED\s*:\s*(?:true|false),?\s*/;
  if (!legacyProperty.test(block)) return [];
  if (options.plan === true) return ['AUTHENTICATION.MFA_TOTP.ENABLED'];

  if (options.backup !== false) {
    await backupConflicts(rootDir, rootDir, ['src/supacharger.config.ts']);
  }
  const migratedBlock = block.replace(legacyProperty, '').replace(/\n{3,}/g, '\n\n');
  await fs.writeFile(
    configPath,
    `${source.slice(0, bounds.open)}${migratedBlock}${source.slice(bounds.close + 1)}`,
    'utf8',
  );
  console.log('\x1b[34mRemoved obsolete AUTHENTICATION.MFA_TOTP.ENABLED; factor management is always available.\x1b[0m');
  return ['AUTHENTICATION.MFA_TOTP.ENABLED'];
}

function tomlSectionBounds(source: string, sectionName: string) {
  const heading = new RegExp(`^\\[${sectionName.replaceAll('.', '\\.')}\\]\\s*$`, 'm').exec(source);
  if (!heading) return null;
  const nextHeading = /^\[[^\n]+\]\s*$/gm;
  nextHeading.lastIndex = heading.index + heading[0].length;
  const next = nextHeading.exec(source);
  return { start: heading.index, end: next?.index ?? source.length };
}

function migrateTotpConfigSource(source: string, keys = ['enroll_enabled', 'verify_enabled']) {
  const bounds = tomlSectionBounds(source, 'auth.mfa.totp');
  if (!bounds) {
    return `${source.replace(/\s*$/, '')}\n\n[auth.mfa.totp]\n${keys.map((key) => `${key} = true`).join('\n')}\n`;
  }

  let migratedSection = source.slice(bounds.start, bounds.end);
  for (const key of keys) {
    const property = new RegExp(`^${key}\\s*=.*$`, 'm');
    if (property.test(migratedSection)) migratedSection = migratedSection.replace(property, `${key} = true`);
    else migratedSection = `${migratedSection.replace(/\s*$/, '')}\n${key} = true\n`;
  }
  return `${source.slice(0, bounds.start)}${migratedSection}${source.slice(bounds.end)}`;
}

function migrateLocalSmtpConfigSource(source: string) {
  if (tomlSectionBounds(source, 'local_smtp')) return source;
  return source.replace(/^\[inbucket\]\s*$/m, '[local_smtp]');
}

async function migrateLocalSmtpConfig(rootDir: string, options: UpdateOptions = {}) {
  const configPath = path.join(rootDir, 'supabase', 'config.toml');
  let source;
  try {
    source = await fs.readFile(configPath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return [];
    throw error;
  }
  if (!tomlSectionBounds(source, 'inbucket')) return [];
  if (tomlSectionBounds(source, 'local_smtp')) {
    throw new Error('supabase/config.toml contains both [inbucket] and [local_smtp]; merge the email-testing settings manually.');
  }
  const changes = ['inbucket -> local_smtp'];
  if (options.plan === true) return changes;
  if (options.backup !== false) await backupConflicts(rootDir, rootDir, ['supabase/config.toml']);
  await fs.writeFile(configPath, migrateLocalSmtpConfigSource(source), 'utf8');
  if (!options.quiet) console.log('\x1b[34mRenamed local Supabase [inbucket] configuration to [local_smtp] for CLI v3.\x1b[0m');
  return changes;
}

async function migrateLocalTotpConfig(rootDir: string, options: UpdateOptions = {}) {
  const configPath = path.join(rootDir, 'supabase', 'config.toml');
  let source;
  try {
    source = await fs.readFile(configPath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return [];
    throw error;
  }

  const bounds = tomlSectionBounds(source, 'auth.mfa.totp');
  const section = bounds ? source.slice(bounds.start, bounds.end) : '';
  const changes = ['enroll_enabled', 'verify_enabled'].filter(
    (key) => !new RegExp(`^${key}\\s*=\\s*true\\s*$`, 'm').test(section),
  );
  if (changes.length === 0 || options.plan === true) return changes.map((key) => `auth.mfa.totp.${key}`);

  if (options.backup !== false) {
    await backupConflicts(rootDir, rootDir, ['supabase/config.toml']);
  }
  const migrated = migrateTotpConfigSource(source);
  await fs.writeFile(configPath, migrated, 'utf8');
  if (!options.quiet) {
    console.log('\x1b[34mEnabled local Supabase TOTP enrolment and verification APIs. Restart the local stack to apply them.\x1b[0m');
  }
  return changes.map((key) => `auth.mfa.totp.${key}`);
}

async function migrateImageFunctionConfig(rootDir: string, options: UpdateOptions = {}) {
  const configPath = path.join(rootDir, 'supabase', 'config.toml');
  let source;
  try {
    source = await fs.readFile(configPath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return [];
    throw error;
  }

  // Follow the requested Core revision, including when upgrading a legacy consumer.
  const targetConfig = options.sourceRoot
    ? await fs.readFile(path.join(options.sourceRoot, 'supabase', 'config.toml'), 'utf8')
    : source;
  const functionName = ['process_image_upload', 'process-image-upload-v2', 'process-image-upload']
    .find((name) => tomlSectionBounds(targetConfig, `functions.${name}`));
  if (!functionName) return [];
  const requiredAsset = `./functions/${functionName}/magick.wasm`;
  if (options.sourceRoot) {
    // Managed assets have already moved into the consumer during a real update.
    await fs.access(path.join(options.plan ? options.sourceRoot : rootDir, 'supabase', requiredAsset));
  }
  const setting = `functions.${functionName}.static_files`;
  const retiredSections = functionName === 'process_image_upload'
    ? ['process-image-upload-v2', 'process-image-upload'].filter((name) => tomlSectionBounds(source, `functions.${name}`))
    : [];
  let configSource = source;
  for (const name of retiredSections) {
    const retired = tomlSectionBounds(configSource, `functions.${name}`)!;
    configSource = `${configSource.slice(0, retired.start)}${configSource.slice(retired.end)}`;
  }
  const bounds = tomlSectionBounds(configSource, `functions.${functionName}`);
  const section = bounds ? configSource.slice(bounds.start, bounds.end) : '';
  const staticFiles = /^static_files\s*=\s*\[([^\]]*)\]\s*$/m.exec(section);
  const hasAsset = section.includes(`"${requiredAsset}"`);
  const changes = [...retiredSections.map((name) => `functions.${name} (remove)`), ...(!hasAsset ? [setting] : [])];
  if (changes.length === 0 || options.plan === true) return changes;

  if (options.backup !== false) {
    await backupConflicts(rootDir, rootDir, ['supabase/config.toml']);
  }

  let migrated;
  if (hasAsset) {
    migrated = configSource;
  } else if (!bounds) {
    migrated = `${configSource.replace(/\s*$/, '')}\n\n[functions.${functionName}]\nverify_jwt = true\nstatic_files = ["${requiredAsset}"]\n`;
  } else if (staticFiles) {
    const values = staticFiles[1].trim();
    const replacement = `static_files = [${values}${values ? ', ' : ''}"${requiredAsset}"]`;
    const migratedSection = section.replace(staticFiles[0], replacement);
    migrated = `${configSource.slice(0, bounds.start)}${migratedSection}${configSource.slice(bounds.end)}`;
  } else {
    const migratedSection = `${section.replace(/\s*$/, '')}\nstatic_files = ["${requiredAsset}"]\n`;
    migrated = `${configSource.slice(0, bounds.start)}${migratedSection}${configSource.slice(bounds.end)}`;
  }

  await fs.writeFile(configPath, migrated, 'utf8');
  if (!options.quiet) {
    console.log(`\x1b[34mBundled the ImageMagick WASM asset for ${functionName}.\x1b[0m`);
  }
  return changes;
}

async function migrateProfileMediaFunctionConfig(rootDir: string, options: UpdateOptions = {}) {
  const configPath = path.join(rootDir, 'supabase', 'config.toml');
  let source;
  try { source = await fs.readFile(configPath, 'utf8'); }
  catch (error) { if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return []; throw error; }
  const bounds = tomlSectionBounds(source, 'functions.profile-media');
  const section = bounds ? source.slice(bounds.start, bounds.end) : '';
  if (/^verify_jwt\s*=\s*false\s*$/m.test(section)) return [];
  const changes = ['functions.profile-media.verify_jwt'];
  if (options.plan === true) return changes;
  if (options.backup !== false) await backupConflicts(rootDir, rootDir, ['supabase/config.toml']);
  let migrated;
  if (!bounds) {
    migrated = `${source.replace(/\s*$/, '')}\n\n[functions.profile-media]\nverify_jwt = false\n`;
  } else {
    const next = /^verify_jwt\s*=.*$/m.test(section)
      ? section.replace(/^verify_jwt\s*=.*$/m, 'verify_jwt = false')
      : `${section.replace(/\s*$/, '')}\nverify_jwt = false\n`;
    migrated = `${source.slice(0, bounds.start)}${next}${source.slice(bounds.end)}`;
  }
  await fs.writeFile(configPath, migrated, 'utf8');
  if (!options.quiet) console.log('Configured public profile media; the function enforces caller-scoped Storage RLS.');
  return changes;
}

function objectBlockBounds(source: string, objectName: string) {
  const match = new RegExp(`\\b${objectName}\\s*:`).exec(source);
  if (!match) return null;
  const open = source.indexOf('{', match.index + match[0].length);
  if (open === -1) return null;
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') depth -= 1;
    if (depth === 0) {
      return {
        open,
        close: index,
        closeLineStart: source.lastIndexOf('\n', index) + 1,
      };
    }
  }
  return null;
}

function missingObjectKeys(source: string, objectName: string, keys: string[]) {
  const bounds = objectBlockBounds(source, objectName);
  if (!bounds) return keys;
  const block = source.slice(bounds.open, bounds.close + 1);
  return keys.filter((key) => !new RegExp(`\\b${key}\\s*:`).test(block));
}

function insertObjectEntries(source: string, objectName: string, entries: [string, string][]) {
  const bounds = objectBlockBounds(source, objectName);
  if (!bounds) throw new Error(`Could not find ${objectName} in src/supacharger.config.ts.`);
  const missing = entries.filter(([key]) => missingObjectKeys(source, objectName, [key]).length > 0);
  if (missing.length === 0) return source;
  const closingIndent = source.slice(bounds.closeLineStart, bounds.close);
  const propertyIndent = `${closingIndent}  `;
  const addition = missing
    .map(([, value]) => `${propertyIndent}${value.replaceAll('\n', `\n${propertyIndent}`)}`)
    .join('\n');
  return `${source.slice(0, bounds.closeLineStart)}${addition}\n${source.slice(bounds.closeLineStart)}`;
}

function insertTopLevelBlock(source: string, anchorName: string, block: string) {
  const anchor = new RegExp(`^([ \\t]*)${anchorName}\\s*:`, 'm').exec(source);
  if (!anchor) {
    throw new Error(`Could not find ${anchorName} in src/supacharger.config.ts; add the new account alignment options manually.`);
  }
  return `${source.slice(0, anchor.index)}${anchor[1]}${block.replaceAll('\n', `\n${anchor[1]}`)}\n\n${source.slice(anchor.index)}`;
}

async function assessAccountAlignmentConfig(rootDir: string) {
  const configPath = path.join(rootDir, 'src', 'supacharger.config.ts');
  let source;
  try {
    source = await fs.readFile(configPath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return [];
    throw error;
  }

  const missing = [];
  for (const key of missingObjectKeys(source, 'PROFILE_IDENTITY', ['AVATAR', 'HEADER_IMAGE'])) {
    missing.push(`PROFILE_IDENTITY.${key}`);
  }
  if (!objectBlockBounds(source, 'ACCOUNT_SETTINGS')) {
    missing.push('ACCOUNT_SETTINGS');
  } else {
    for (const key of missingObjectKeys(source, 'ACCOUNT_SETTINGS', ['LANGUAGE', 'CANCEL_ACCOUNT', 'PRODUCT_PROFILE_PATH'])) {
      missing.push(`ACCOUNT_SETTINGS.${key}`);
    }
  }
  if (!objectBlockBounds(source, 'ORGANISATIONS')) {
    missing.push('ORGANISATIONS');
  } else {
    for (const key of missingObjectKeys(source, 'ORGANISATIONS', ['ENABLED', 'AUTHENTICATION_HANDLE', 'CHOOSER_PATH', 'ROUTE_MODE', 'PROFILE_MEDIA'])) {
      missing.push(`ORGANISATIONS.${key}`);
    }
  }
  if (objectBlockBounds(source, 'ORGANISATIONS')) {
    const organisationBounds = objectBlockBounds(source, 'ORGANISATIONS')!;
    const organisationSource = source.slice(organisationBounds.open, organisationBounds.close + 1);
    if (/CHOOSER_PATH\s*:\s*(['"])\/account\/organisation\1/.test(organisationSource)) {
      missing.push('ORGANISATIONS.CHOOSER_PATH');
    }
    if (/ROUTE_MODE\s*:\s*(['"])root-handle\1/.test(organisationSource)) {
      missing.push('ORGANISATIONS.ROUTE_MODE');
    }
  }
  if (missingObjectKeys(source, 'BILLING', ['ACCOUNT_SUBJECTS']).length > 0) {
    missing.push('BILLING.ACCOUNT_SUBJECTS');
  }
  return missing;
}

async function migrateAccountAlignmentConfig(rootDir: string, options: UpdateOptions = {}) {
  const missing = await assessAccountAlignmentConfig(rootDir);
  if (missing.length === 0 || options.plan === true) return missing;
  if (options.backup !== false) {
    await backupConflicts(rootDir, rootDir, ['src/supacharger.config.ts']);
  }

  const configPath = path.join(rootDir, 'src', 'supacharger.config.ts');
  let source = await fs.readFile(configPath, 'utf8');
  source = insertObjectEntries(source, 'PROFILE_IDENTITY', [
    ['AVATAR', "AVATAR: 'optional',"],
    ['HEADER_IMAGE', "HEADER_IMAGE: 'optional',"],
  ]);
  if (!objectBlockBounds(source, 'ACCOUNT_SETTINGS')) {
    source = insertTopLevelBlock(source, 'POST_SIGN_IN_ONBOARDING', `ACCOUNT_SETTINGS: {
  LANGUAGE: true,
  CANCEL_ACCOUNT: 'disabled',
  PRODUCT_PROFILE_PATH: null,
},`);
  } else {
    source = insertObjectEntries(source, 'ACCOUNT_SETTINGS', [
      ['LANGUAGE', 'LANGUAGE: true,'],
      ['CANCEL_ACCOUNT', "CANCEL_ACCOUNT: 'disabled',"],
      ['PRODUCT_PROFILE_PATH', 'PRODUCT_PROFILE_PATH: null,'],
    ]);
  }
  if (!objectBlockBounds(source, 'ORGANISATIONS')) {
    source = insertTopLevelBlock(source, 'BILLING_ACCESS', `ORGANISATIONS: {
  ENABLED: false,
  AUTHENTICATION_HANDLE: 'disabled',
  CHOOSER_PATH: '/organisation/choose',
  ROUTE_MODE: 'organisation-handle',
  PROFILE_MEDIA: true,
},`);
  } else {
    source = insertObjectEntries(source, 'ORGANISATIONS', [
      ['ENABLED', 'ENABLED: false,'],
      ['AUTHENTICATION_HANDLE', "AUTHENTICATION_HANDLE: 'disabled',"],
      ['CHOOSER_PATH', "CHOOSER_PATH: '/organisation/choose',"],
      ['ROUTE_MODE', "ROUTE_MODE: 'organisation-handle',"],
      ['PROFILE_MEDIA', 'PROFILE_MEDIA: true,'],
    ]);
  }
  const organisationBounds = objectBlockBounds(source, 'ORGANISATIONS')!;
  const organisationSource = source.slice(organisationBounds.open, organisationBounds.close + 1)
    .replace(/(CHOOSER_PATH\s*:\s*)(['"])\/account\/organisation\2/g, "$1'/organisation/choose'")
    .replace(/(ROUTE_MODE\s*:\s*)(['"])root-handle\2/g, "$1'organisation-handle'");
  source = source.slice(0, organisationBounds.open) + organisationSource + source.slice(organisationBounds.close + 1);
  source = insertObjectEntries(source, 'BILLING', [
    ['ACCOUNT_SUBJECTS', `ACCOUNT_SUBJECTS: {
  PERSONAL: true,
  ORGANISATION: false,
},`],
  ]);
  await fs.writeFile(configPath, source, 'utf8');
  console.log(`\x1b[34mAligned account configuration: ${missing.join(', ')}.\x1b[0m`);
  return missing;
}

async function migrateSignUpTermsConfig(rootDir: string, options: UpdateOptions = {}) {
  const configPath = path.join(rootDir, 'src', 'supacharger.config.ts');
  let source;
  try { source = await fs.readFile(configPath, 'utf8'); }
  catch (error) { if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return []; throw error; }
  const missing = missingObjectKeys(source, 'AUTHENTICATION', ['SIGN_UP_TERMS_URL'])
    .map((key) => `AUTHENTICATION.${key}`);
  if (!missing.length || options.plan === true) return missing;
  if (options.backup !== false) await backupConflicts(rootDir, rootDir, ['src/supacharger.config.ts']);
  source = insertObjectEntries(source, 'AUTHENTICATION', [['SIGN_UP_TERMS_URL', 'SIGN_UP_TERMS_URL: null,']]);
  await fs.writeFile(configPath, source, 'utf8');
  return missing;
}

async function migrateSessionTransferConfig(rootDir: string, options: UpdateOptions = {}) {
  const configPath = path.join(rootDir, 'src', 'supacharger.config.ts');
  let source;
  try {
    source = await fs.readFile(configPath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return [];
    throw error;
  }

  const blockName = 'CROSS_DEVICE_SESSION_TRANSFER';
  const missing = !objectBlockBounds(source, blockName)
    ? [`AUTHENTICATION.${blockName}`]
    : missingObjectKeys(source, blockName, ['ENABLED', 'TOKEN_TTL_SECONDS']).map(
        (key) => `AUTHENTICATION.${blockName}.${key}`,
      );
  if (missing.length === 0 || options.plan === true) return missing;
  if (options.backup !== false) {
    await backupConflicts(rootDir, rootDir, ['src/supacharger.config.ts']);
  }

  if (!objectBlockBounds(source, blockName)) {
    source = insertObjectEntries(source, 'AUTHENTICATION', [
      [blockName, `${blockName}: {\n  ENABLED: false,\n  TOKEN_TTL_SECONDS: 120,\n},`],
    ]);
  } else {
    source = insertObjectEntries(source, blockName, [
      ['ENABLED', 'ENABLED: false,'],
      ['TOKEN_TTL_SECONDS', 'TOKEN_TTL_SECONDS: 120,'],
    ]);
  }
  await fs.writeFile(configPath, source, 'utf8');
  console.log(`\x1b[34mAdded disabled-safe session-transfer configuration defaults: ${missing.join(', ')}.\x1b[0m`);
  return missing;
}

function mergeMissingCatalogueValues(current: JsonObject, incoming: JsonObject, prefix = ''): { merged: JsonObject; added: string[] } {
  const merged = { ...current };
  const added = [];
  for (const [key, value] of Object.entries(incoming)) {
    const propertyPath = prefix ? `${prefix}.${key}` : key;
    if (!(key in merged) || (merged[key] === '' && typeof value === 'string' && value.trim() !== '')) {
      merged[key] = value;
      added.push(propertyPath);
      continue;
    }
    const currentIsObject = merged[key] && typeof merged[key] === 'object' && !Array.isArray(merged[key]);
    const incomingIsObject = value && typeof value === 'object' && !Array.isArray(value);
    if (currentIsObject && incomingIsObject) {
      const nested = mergeMissingCatalogueValues(merged[key] as JsonObject, value as JsonObject, propertyPath);
      merged[key] = nested.merged;
      added.push(...nested.added);
    }
  }
  return { merged, added };
}

async function mergeEnglishCatalogue(rootDir: string, incomingRoot: string, options: UpdateOptions = {}) {
  const relativePath = path.join('messages', 'en.json');
  let incoming;
  try {
    incoming = await readJson(path.join(incomingRoot, relativePath));
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return [];
    throw error;
  }
  let current;
  try {
    current = await readJson(path.join(rootDir, relativePath));
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') throw error;
    current = {};
  }
  const result = mergeMissingCatalogueValues(current, incoming);
  if (result.added.length === 0 || options.plan === true) return result.added;
  if (options.backup !== false) await backupConflicts(rootDir, rootDir, [relativePath]);
  await fs.mkdir(path.dirname(path.join(rootDir, relativePath)), { recursive: true });
  await fs.writeFile(path.join(rootDir, relativePath), `${JSON.stringify(result.merged, null, 2)}\n`, 'utf8');
  console.log(`\x1b[34mAdded ${result.added.length} missing canonical English message keys without changing existing application copy.\x1b[0m`);
  return result.added;
}

async function assessRootDocumentConfig(rootDir: string) {
  const configPath = path.join(rootDir, 'src', 'supacharger.config.ts');
  let content;
  try {
    content = await fs.readFile(configPath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return { content: '', missingKeys: [] };
    throw error;
  }

  return {
    content,
    missingKeys: ROOT_DOCUMENT_CONFIG_KEYS.filter(
      (key) => !new RegExp(`\\b${key}\\s*:`).test(content)
    ),
  };
}

async function hasStandardFaviconSet(rootDir: string) {
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

function escapeSingleQuotedString(value: string) {
  return value.replaceAll('\\', '\\\\').replaceAll("'", "\\'");
}

async function migrateRootDocumentConfig(rootDir: string, options: UpdateOptions = {}) {
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

async function readProjectName(rootDir: string) {
  try {
    const packageJson = JSON.parse(await fs.readFile(path.join(rootDir, 'package.json'), 'utf8')) as Record<string, unknown>;
    if (typeof packageJson.name === 'string' && packageJson.name.trim()) {
      return packageJson.name.trim();
    }
  } catch {
    // A package name is helpful metadata, not a prerequisite for migration.
  }
  return 'Add your project name';
}

async function migrateLegacyPostcssConfig(rootDir: string, options: UpdateOptions = {}) {
  const legacyPath = path.join(rootDir, 'postcss.config.js');
  let content;
  try {
    content = await fs.readFile(legacyPath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return false;
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

async function personaliseStarterProjectStyles(rootDir: string) {
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

function validateCoreRef(ref: string) {
  if (typeof ref !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(ref) || ref.includes('..')) {
    throw new Error('Core ref must be a tag, branch, or commit containing only safe Git ref characters.');
  }
  return ref;
}

async function getRemoteRefHash(repository = CORE_REPOSITORY, ref = 'main') {
  validateCoreRef(ref);
  const repositoryUrl = `git@github.com:${repository}.git`;
  const { stdout } = await execCommand(`git ls-remote ${repositoryUrl} "${ref}" "refs/heads/${ref}" "refs/tags/${ref}^{}"`);
  const commit = /^[a-f0-9]{40}$/.test(ref) ? ref : stdout.trim().split(/\s+/)[0];
  if (!/^[a-f0-9]{40}$/.test(commit ?? '')) {
    throw new Error(`Could not resolve Core ref ${ref} for ${repository}.`);
  }
  return commit;
}

async function removeGitDir(dir: string) {
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

async function filesEqual(firstPath: string, secondPath: string) {
  try {
    const [first, second] = await Promise.all([fs.readFile(firstPath), fs.readFile(secondPath)]);
    return first!.equals(second!);
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return false;
    throw error;
  }
}

function contentsEqual(first: Buffer | null | undefined, second: Buffer | null | undefined) {
  if (first === null || second === null) return first === second;
  return first!.equals(second!);
}

async function readFileContents(filePath: string) {
  try {
    return await fs.readFile(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return null;
    throw error;
  }
}

async function readJson<T = JsonObject>(filePath: string): Promise<T> {
  return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

function detectPackageManager(packageJson: PackageJson, files: string[]) {
  const declared = packageJson.packageManager?.split('@')[0];
  if (declared === 'npm' || declared === 'pnpm' || declared === 'yarn') return declared;
  if (files.includes('pnpm-lock.yaml')) return 'pnpm';
  if (files.includes('yarn.lock')) return 'yarn';
  return 'npm';
}

function dependencyContract(packageJson: PackageJson) {
  return JSON.stringify({
    packageManager: packageJson.packageManager ?? null,
    engines: packageJson.engines ?? null,
    dependencies: packageJson.dependencies ?? {},
    devDependencies: packageJson.devDependencies ?? {},
    optionalDependencies: packageJson.optionalDependencies ?? {},
    overrides: packageJson.overrides ?? {},
    allowScripts: packageJson.allowScripts ?? {},
  });
}

const DEPENDENCY_OBJECT_KEYS = [
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'overrides',
];

function dependencyContractChanged(currentPackage: PackageJson, incomingPackage: PackageJson) {
  if (incomingPackage.packageManager && currentPackage.packageManager !== incomingPackage.packageManager) return true;
  if (
    Object.entries(incomingPackage.engines ?? {}).some(
      ([name, version]) => !isDeepStrictEqual(currentPackage.engines?.[name], version)
    )
  ) {
    return true;
  }

  if (
    incomingPackage.allowScripts &&
    !isDeepStrictEqual(
      currentPackage.allowScripts ?? {},
      mergeInstallScriptPolicy(currentPackage.allowScripts ?? {}, incomingPackage.allowScripts)
    )
  ) {
    return true;
  }

  return DEPENDENCY_OBJECT_KEYS.some((key) =>
    Object.entries(incomingPackage[key] ?? {}).some(
      ([name, version]) => !isDeepStrictEqual((currentPackage[key] as JsonObject | undefined)?.[name], version)
    )
  );
}

function installScriptPackageName(approvalKey: string) {
  const versionSeparator = approvalKey.lastIndexOf('@');
  if (versionSeparator <= 0) return approvalKey;
  if (approvalKey.startsWith('@') && versionSeparator < approvalKey.indexOf('/')) return approvalKey;
  return approvalKey.slice(0, versionSeparator);
}

function mergeInstallScriptPolicy(currentPolicy: Record<string, boolean>, incomingPolicy: Record<string, boolean>) {
  const mergedPolicy = { ...currentPolicy };
  for (const [approvalKey, approved] of Object.entries(incomingPolicy)) {
    const packageName = installScriptPackageName(approvalKey);
    for (const currentKey of Object.keys(mergedPolicy)) {
      if (installScriptPackageName(currentKey) === packageName) delete mergedPolicy[currentKey];
    }
    mergedPolicy[approvalKey] = approved;
  }
  return mergedPolicy;
}

function mergeContractValue(currentValue: JsonValue | undefined, incomingValue: JsonValue | undefined): JsonValue | undefined {
  const currentIsObject = currentValue && typeof currentValue === 'object' && !Array.isArray(currentValue);
  const incomingIsObject = incomingValue && typeof incomingValue === 'object' && !Array.isArray(incomingValue);
  if (!currentIsObject || !incomingIsObject) return incomingValue;

  return Object.fromEntries(
    [...new Set([...Object.keys(currentValue as JsonObject), ...Object.keys(incomingValue as JsonObject)])].map((key) => [
      key,
      key in (incomingValue as JsonObject)
        ? mergeContractValue((currentValue as JsonObject)[key], (incomingValue as JsonObject)[key])
        : (currentValue as JsonObject)[key],
    ])
  );
}

async function mergeDependencyContract(rootDir: string, incomingPackage: PackageJson) {
  const packagePath = path.join(rootDir, 'package.json');
  const currentPackage = await readJson<PackageJson>(packagePath);
  const mergedPackage = { ...currentPackage };
  if (currentPackage.scripts) mergedPackage.scripts = cleanScripts(currentPackage.scripts);

  if (incomingPackage.packageManager) mergedPackage.packageManager = incomingPackage.packageManager;
  if (incomingPackage.engines) {
    mergedPackage.engines = { ...(currentPackage.engines ?? {}), ...incomingPackage.engines };
  }
  for (const key of DEPENDENCY_OBJECT_KEYS) {
    if (incomingPackage[key]) {
      mergedPackage[key] = mergeContractValue(currentPackage[key] ?? {}, incomingPackage[key]);
    }
  }
  if (incomingPackage.allowScripts) {
    mergedPackage.allowScripts = mergeInstallScriptPolicy(
      currentPackage.allowScripts ?? {},
      incomingPackage.allowScripts
    );
  }

  if (JSON.stringify(currentPackage) !== JSON.stringify(mergedPackage)) {
    await fs.writeFile(packagePath, `${JSON.stringify(mergedPackage, null, 2)}\n`, 'utf8');
  }
}

async function installForwardOnlyMigrations(rootDir: string, assessment: PostUpdateAssessment) {
  for (const migration of assessment.changedMigrations) {
    const sourcePath = path.join(assessment.incomingRoot, migration.path);
    const destinationPath = path.join(rootDir, migration.path);

    const existingContents = await readFileContents(destinationPath);
    if (existingContents !== null) {
      if (existingContents.equals(await fs.readFile(sourcePath))) continue;
      throw new Error(
        `Forward-only migration collision at ${migration.path}. The existing migration was preserved; resolve the history manually.`,
      );
    }

    await fs.mkdir(path.dirname(destinationPath), { recursive: true });
    await fs.copyFile(sourcePath, destinationPath);
  }
}

async function migrationContents(rootDir: string, migrationPaths = DEFAULT_MIGRATION_PATHS): Promise<Map<string, Buffer>> {
  const files = await walkFiles(rootDir);
  const migrations = files.filter(
    (file) => pathMatchesManifest(file, migrationPaths) && file.endsWith('.sql'),
  );
  return new Map(
    await Promise.all(migrations.map(async (migration) => [migration, await fs.readFile(path.join(rootDir, migration))] as const)),
  );
}

async function readMigrationAliases(rootDir: string) {
  try {
    const aliases = await readJson(path.join(rootDir, MIGRATION_ALIASES_FILE));
    if (!aliases || typeof aliases !== 'object' || Array.isArray(aliases)) {
      throw new Error(`${MIGRATION_ALIASES_FILE} must contain a JSON object.`);
    }
    return new Map(Object.entries(aliases).map(([canonical, replacement]) => {
      if (typeof replacement !== 'string' || !replacement.endsWith('.sql')) {
        throw new Error(`Invalid migration alias for ${canonical}.`);
      }
      return [path.normalize(canonical), path.normalize(replacement)];
    }));
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return new Map();
    throw error;
  }
}

async function assessPostUpdateWork(rootDir: string, updateDir: string, options: UpdateOptions = {}) {
  const [currentPackage, incomingPackage, incomingFiles, migrationAliases] = await Promise.all([
    readJson<PackageJson>(path.join(rootDir, 'package.json')),
    readJson<PackageJson>(path.join(updateDir, 'package.json')),
    walkFiles(updateDir),
    readMigrationAliases(rootDir),
  ]);
  const migrationPaths = options.forwardOnlyMigrationPaths ?? DEFAULT_MIGRATION_PATHS;
  const incomingMigrations = incomingFiles.filter(
    (file) => pathMatchesManifest(file, migrationPaths) && file.endsWith('.sql')
  );
  const changedMigrations = [];
  const satisfiedMigrationAliases = [];

  const declarative = await planDatabaseUpdate(rootDir, updateDir, options);
  for (const migration of declarative ? [] : incomingMigrations) {
    const incomingContents = await fs.readFile(path.join(updateDir, migration));
    if (options.baselineMigrationContents?.has(migration)) {
      if (!options.baselineMigrationContents.get(migration)!.equals(incomingContents)) {
        throw new Error(`Published migration changed after installation: ${migration}`);
      }
      continue;
    }
    const replacement = migrationAliases.get(path.normalize(migration));
    if (replacement) {
      try {
        await fs.access(path.join(rootDir, replacement));
        satisfiedMigrationAliases.push({ canonical: migration, replacement });
        continue;
      } catch (error) {
        if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') throw error;
        throw new Error(`Migration alias target is missing: ${replacement} (for ${migration}).`);
      }
    }
    try {
      const currentContents = await fs.readFile(path.join(rootDir, migration));
      if (!currentContents.equals(incomingContents)) changedMigrations.push({ path: migration });
    } catch {
      changedMigrations.push({ path: migration });
    }
  }

  return {
    dependencyChanged: dependencyContractChanged(currentPackage, incomingPackage),
    removedTestScripts: Object.entries(currentPackage.scripts ?? {}).filter(([name, command]) => isTestScript(name, command)).map(([name]) => name),
    incomingPackage,
    incomingRoot: updateDir,
    incomingFiles,
    changedMigrations,
    satisfiedMigrationAliases,
    declarative,
  };
}

async function mergeManagedContents(rootDir: string, manifest: Pick<ManagedManifest, 'mergeManagedPaths'> | null) {
  const mergePaths = (manifest?.mergeManagedPaths ?? []).filter(
    (mergePath) => !AUTOMATIC_MERGE_PATHS.has(mergePath)
  );
  const contents: FileContents = new Map();
  for (const mergePath of mergePaths) {
    contents.set(mergePath, await readFileContents(path.join(rootDir, mergePath)));
  }
  return contents;
}

async function allMergeManagedContents(rootDir: string, manifest: ManagedManifest | null) {
  const contents: FileContents = new Map();
  for (const mergePath of manifest?.mergeManagedPaths ?? []) {
    contents.set(mergePath, await readFileContents(path.join(rootDir, mergePath)));
  }
  return contents;
}

const APPLICATION_PACKAGE_KEYS = new Set([
  'name',
  'version',
  'private',
  'description',
  'keywords',
  'author',
  'license',
  'repository',
  'bugs',
  'homepage',
]);
const AUTOMATIC_PACKAGE_KEYS = new Set([
  'packageManager',
  'engines',
  'allowScripts',
  ...DEPENDENCY_OBJECT_KEYS,
]);

function packageJsonNeedsManualMerge(baselinePackage: PackageJson, latestPackage: PackageJson) {
  if (!isDeepStrictEqual(cleanScripts(baselinePackage.scripts), cleanScripts(latestPackage.scripts))) return true;
  const keys = new Set([...Object.keys(baselinePackage), ...Object.keys(latestPackage)]);
  for (const key of keys) {
    if (key === 'scripts' || APPLICATION_PACKAGE_KEYS.has(key) || AUTOMATIC_PACKAGE_KEYS.has(key)) continue;
    if (!isDeepStrictEqual(baselinePackage[key], latestPackage[key])) return true;
  }
  return false;
}

async function matchesSupportedSupabaseConfigChange(baselineContent: Buffer | null, latestContent: Buffer | null) {
  if (contentsEqual(baselineContent, latestContent)) return true;
  if (baselineContent === null || latestContent === null) return false;

  const baselineSource = baselineContent.toString('utf8');
  const totpVariants = [
    baselineSource,
    migrateTotpConfigSource(baselineSource, ['enroll_enabled']),
    migrateTotpConfigSource(baselineSource, ['verify_enabled']),
    migrateTotpConfigSource(baselineSource),
  ];
  const variants = [...new Set(totpVariants.flatMap((source) => [source, migrateLocalSmtpConfigSource(source)]))];
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'supacharger-config-merge-'));
  try {
    for (const source of variants) {
      if (Buffer.from(source).equals(latestContent)) return true;
      await fs.rm(path.join(tempRoot, 'supabase'), { recursive: true, force: true });
      await fs.mkdir(path.join(tempRoot, 'supabase'), { recursive: true });
      await fs.writeFile(path.join(tempRoot, 'supabase', 'config.toml'), source);
      await migrateProfileMediaFunctionConfig(tempRoot, { backup: false, quiet: true });
      if ((await fs.readFile(path.join(tempRoot, 'supabase', 'config.toml'))).equals(latestContent)) return true;
      await fs.writeFile(path.join(tempRoot, 'supabase', 'config.toml'), source);
      await migrateImageFunctionConfig(tempRoot, { backup: false, quiet: true });
      if ((await fs.readFile(path.join(tempRoot, 'supabase', 'config.toml'))).equals(latestContent)) return true;
      await migrateProfileMediaFunctionConfig(tempRoot, { backup: false, quiet: true });
      const migrated = await fs.readFile(path.join(tempRoot, 'supabase', 'config.toml'));
      if (migrated.equals(latestContent)) return true;
    }
    return false;
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
}

async function changedAutomaticMergePathsFromContents(baselineContents: FileContents, latestDir: string, manifest: Pick<ManagedManifest, 'mergeManagedPaths'> | null) {
  const automaticPaths = (manifest?.mergeManagedPaths ?? []).filter((mergePath) =>
    AUTOMATIC_MERGE_PATHS.has(mergePath)
  );
  const changed = [];
  const readLatest = (mergePath: string) => readFileContents(path.join(latestDir, mergePath));

  if (automaticPaths.includes('package.json')) {
    const [baselineContent, latestContent] = [baselineContents.get('package.json'), await readLatest('package.json')];
    if (baselineContent === undefined || baselineContent === null || latestContent === null) changed.push('package.json');
    else if (packageJsonNeedsManualMerge(JSON.parse(baselineContent.toString('utf8')), JSON.parse(latestContent.toString('utf8')))) changed.push('package.json');
  }

  if (automaticPaths.includes('package-lock.json')) {
    const [baselineLock, latestLock] = [baselineContents.get('package-lock.json'), await readLatest('package-lock.json')];
    if (baselineLock === undefined || baselineLock === null || latestLock === null) changed.push('package-lock.json');
    else if (!baselineLock.equals(latestLock)) {
      const baselinePackage = baselineContents.get('package.json');
      const latestPackage = await readLatest('package.json');
      if (
        baselinePackage === undefined || baselinePackage === null || latestPackage === null ||
        dependencyContract(JSON.parse(baselinePackage.toString('utf8'))) === dependencyContract(JSON.parse(latestPackage.toString('utf8')))
      ) changed.push('package-lock.json');
    }
  }

  if (automaticPaths.includes(path.normalize('supabase/config.toml'))) {
    const configPath = path.normalize('supabase/config.toml');
    const baselineConfig = baselineContents.get(configPath);
    const latestConfig = await readLatest(configPath);
    if (baselineConfig === undefined || !await matchesSupportedSupabaseConfigChange(baselineConfig, latestConfig)) {
      changed.push(configPath);
    }
  }

  return changed;
}

async function changedManualMergePaths(baselineDir: string, latestDir: string, manifest: Pick<ManagedManifest, 'mergeManagedPaths'> | null) {
  const baselineContents = await managedFileContents(baselineDir, await walkFiles(baselineDir));
  return changedManualMergePathsFromContents(baselineContents, latestDir, manifest);
}

async function changedManualMergePathsFromContents(baselineContents: FileContents, latestDir: string, manifest: Pick<ManagedManifest, 'mergeManagedPaths'> | null) {
  const latestContents = await mergeManagedContents(latestDir, manifest);
  const changed = [];
  for (const [mergePath, latestContent] of latestContents) {
    if (!baselineContents.has(mergePath) || !contentsEqual(baselineContents.get(mergePath), latestContent)) changed.push(mergePath);
  }
  changed.push(...await changedAutomaticMergePathsFromContents(baselineContents, latestDir, manifest));
  return [...new Set(changed)];
}

async function changedOwnershipTransitionPathsFromContents(rootDir: string, baselineMergeContents: FileContents, latestDir: string, latestManifest: Pick<ManagedManifest, 'managedPaths'> | null) {
  const transitionedPaths = [...baselineMergeContents.keys()].filter((relPath) =>
    pathMatchesManifest(relPath, latestManifest?.managedPaths ?? [])
  );
  const changed = [];
  for (const relPath of transitionedPaths) {
    const [localContent, latestContent] = await Promise.all([
      readFileContents(path.join(rootDir, relPath)),
      readFileContents(path.join(latestDir, relPath)),
    ]);
    if (localContent === null) continue;
    const baselineContent = baselineMergeContents.get(relPath);
    if (!contentsEqual(localContent, baselineContent) && !contentsEqual(localContent, latestContent)) changed.push(relPath);
  }
  return changed;
}

async function managedFileContents(rootDir: string, managedFilePaths: string[]): Promise<Map<string, Buffer>> {
  return new Map(
    await Promise.all(
      managedFilePaths.map(async (relPath) => [relPath, await fs.readFile(path.join(rootDir, relPath))] as const)
    )
  );
}

async function verifyManagedFiles(rootDir: string, expectedContents: FileContents) {
  const mismatches = [];
  for (const [relPath, expectedContent] of expectedContents) {
    const actualContent = await readFileContents(path.join(rootDir, relPath));
    if (!contentsEqual(actualContent, expectedContent)) mismatches.push(relPath);
  }
  if (mismatches.length > 0) {
    throw new Error(`Managed files do not match the target Core: ${mismatches.join(', ')}`);
  }
}

async function verifyPostUpdateFiles(rootDir: string, assessment: PostUpdateAssessment) {
  const currentPackage = await readJson<PackageJson>(path.join(rootDir, 'package.json'));
  if (dependencyContractChanged(currentPackage, assessment.incomingPackage)) {
    throw new Error('The incoming dependency contract was not merged into package.json.');
  }
  for (const migration of assessment.changedMigrations) {
    if (!await filesEqual(path.join(rootDir, migration.path), path.join(assessment.incomingRoot, migration.path))) {
      throw new Error(`Required migration was not installed: ${migration.path}`);
    }
  }
}

async function runPostUpdateSteps(rootDir: string, assessment: PostUpdateAssessment, options: UpdateOptions = {}) {
  const run = options.run ?? execCommand;
  const confirm = options.confirm ?? askYesNo;
  await mergeDependencyContract(rootDir, assessment.incomingPackage);
  if (assessment.declarative) await applyDatabaseUpdate(rootDir, assessment.declarative);
  else await installForwardOnlyMigrations(rootDir, assessment);
  await verifyPostUpdateFiles(rootDir, assessment);

  if (assessment.dependencyChanged) {
    const packageManager = detectPackageManager(assessment.incomingPackage, assessment.incomingFiles);
    const installCommand = packageManager === 'npm' ? 'npm install' : `${packageManager} install`;
    console.log(`\x1b[34mInstalling updated dependencies with ${packageManager}...\x1b[0m`);
    await run(installCommand, { cwd: rootDir });
  }

  if (assessment.declarative) {
    assessment.changedMigrations = await generateProjectMigration(rootDir, assessment.declarative, run);
    if (assessment.changedMigrations.length) console.log(messages.DeclarativeDatabaseCli.Review);
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
  let linkedMigrations: { remote?: string }[];
  try {
    linkedMigrations = JSON.parse(migrationList.stdout).migrations ?? [];
  } catch {
    linkedMigrations = migrationList.stdout
      .split('\n')
      .map((line) => line.match(/^\s*`?(\d+)`?\s*\|\s*`?(\d+)`?\s*\|/)?.[2])
      .filter(Boolean)
      .map((remote) => ({ remote }));
  }
  for (const migration of assessment.changedMigrations) {
    const version = path.basename(migration.path).match(/^\d+/)?.[0];
    if (!version || !linkedMigrations.some((entry) => entry.remote === version)) {
      throw new Error(`Supabase did not report migration ${migration.path} in the linked migration ledger.`);
    }
  }
  if (assessment.declarative) await completeDatabaseUpdate(rootDir);
  return true;
}

async function walkFiles(baseDir: string, currentDir = '') {
  const dirPath = path.join(baseDir, currentDir);
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  let files: string[] = [];

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

async function removeDirContents(dir: string) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  await Promise.all(
    entries.map(async (entry) => {
      const fullPath = path.join(dir, entry.name);
      await fs.rm(fullPath, { recursive: true, force: true });
    })
  );
}

async function moveFileToRoot(updateDir: string, relPath: string, rootDir: string) {
  const destPath = path.join(rootDir, relPath);
  const destDir = path.dirname(destPath);
  await fs.mkdir(destDir, { recursive: true });
  await fs.rename(path.join(updateDir, relPath), destPath);
}

function matchingPreservedPath(relPath: string, preservedPaths: string[]) {
  return preservedPaths.find(
    (preservedPath) =>
      relPath === preservedPath || relPath.startsWith(`${preservedPath}${path.sep}`)
  );
}

async function ensureLocalBackupIgnored(rootDir: string) {
  const dotGit = path.join(rootDir, '.git');
  let gitDir = dotGit;
  try {
    const stat = await fs.lstat(dotGit);
    if (stat.isFile()) {
      const pointer = await fs.readFile(dotGit, 'utf8');
      const match = /^gitdir:\s*(.+)\s*$/m.exec(pointer);
      if (!match) return;
      gitDir = path.resolve(rootDir, match[1]);
    } else if (!stat.isDirectory()) {
      return;
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return;
    throw error;
  }

  try {
    const commonDir = (await fs.readFile(path.join(gitDir, 'commondir'), 'utf8')).trim();
    if (commonDir) gitDir = path.resolve(gitDir, commonDir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') throw error;
  }

  const excludePath = path.join(gitDir, 'info', 'exclude');
  let contents = '';
  try {
    contents = await fs.readFile(excludePath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') throw error;
  }
  const rule = '/.supacharger/backups/';
  if (contents.split(/\r?\n/).includes(rule)) return;
  await fs.mkdir(path.dirname(excludePath), { recursive: true });
  const separator = contents && !contents.endsWith('\n') ? '\n' : '';
  await fs.writeFile(excludePath, `${contents}${separator}# Supacharger local recovery copies\n${rule}\n`, 'utf8');
}

async function findNewManagedPathCollisions(rootDir: string, baselineFiles: string[], incomingFiles: string[], incomingRoot: string) {
  const baseline = new Set(baselineFiles);
  const collisions = [];
  for (const relPath of incomingFiles) {
    if (baseline.has(relPath)) continue;
    const localPath = path.join(rootDir, relPath);
    let stat;
    try {
      stat = await fs.lstat(localPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === 'ENOENT' || (error as NodeJS.ErrnoException)?.code === 'ENOTDIR') continue;
      throw error;
    }
    if (!stat.isFile() || !await filesEqual(localPath, path.join(incomingRoot, relPath))) {
      collisions.push(relPath);
    }
  }
  return collisions.sort();
}

async function backupConflicts(updateDir: string, rootDir: string, conflictFiles: string[], backupRoot?: string) {
  await ensureLocalBackupIgnored(rootDir);
  const resolvedBackupRoot = backupRoot ?? path.join(rootDir, '.supacharger', 'backups', new Date().toISOString().replace(/[:.]/g, '-'));
  for (const relPath of conflictFiles) {
    const localFile = path.join(rootDir, relPath);
    const backupFile = path.join(resolvedBackupRoot, relPath);

    try {
      await fs.mkdir(path.dirname(backupFile), { recursive: true });
      await fs.copyFile(localFile, backupFile);
      console.log(`\x1b[33mBacked up file:\x1b[0m ${relPath} -> ${backupFile}`);
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') continue;
      throw new Error(`Failed to back up ${relPath}: ${(err as Error).message}`);
    }
  }
  return resolvedBackupRoot;
}

async function removeObsoleteManagedFiles(rootDir: string, baselineFiles: string[], incomingFiles: string[], preservedPaths: string[] = []) {
  const incoming = new Set(incomingFiles);
  const removed = [];
  for (const relPath of baselineFiles) {
    if (incoming.has(relPath) || matchingPreservedPath(relPath, preservedPaths)) continue;
    const target = path.join(rootDir, relPath);
    try {
      await fs.rm(target);
      removed.push(relPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') throw error;
    }
  }
  return removed;
}


// Clone latest main branch fully (used when no conflicts)
async function cloneLatestSource(updateDir: string, { ref = 'main', repository = CORE_REPOSITORY, source = null }: { ref?: string; repository?: string; source?: string | null } = {}) {
  await removeDirContents(updateDir);
  if (source) {
    const resolvedSource = path.resolve(source);
    const { stdout: status } = await execCommand('git status --porcelain', { cwd: resolvedSource });
    if (status.trim()) throw new Error('The local Core source must be committed and clean before it can be installed.');
    await fs.cp(resolvedSource, updateDir, {
      recursive: true,
      filter: (entry) => !entry.split(path.sep).some((part) => part === '.git' || part === 'node_modules' || part === '.next'),
    });
    const { stdout } = await execCommand('git rev-parse HEAD', { cwd: resolvedSource });
    return stdout.trim();
  }

  validateCoreRef(ref);
  const repositoryUrl = `git@github.com:${repository}.git`;
  console.log(`\x1b[34mCloning Core ref ${ref} into the update directory.\x1b[0m`);
  await execCommand(`git clone --no-checkout ${repositoryUrl} "${updateDir}"`);
  await execCommand(`git -C "${updateDir}" fetch --depth 1 origin "${ref}"`);
  await execCommand(`git -C "${updateDir}" checkout --detach FETCH_HEAD`);
  const { stdout } = await execCommand('git rev-parse HEAD', { cwd: updateDir });
  await removeGitDir(updateDir);
  console.log('\x1b[32mRequested Core ref cloned.\x1b[0m');
  return stdout.trim();
}

async function cloneAndCheckout(updateDir: string, commitHash: string, repository = CORE_REPOSITORY, source: string | null = null) {
  await removeDirContents(updateDir);
  console.log('\x1b[34mCloning the installed core baseline commit...\x1b[0m');
  if (source) {
    const resolvedSource = path.resolve(source);
    await execCommand(`git cat-file -e "${commitHash}^{commit}"`, { cwd: resolvedSource });
    await execCommand(`git clone --no-checkout "${resolvedSource}" "${updateDir}"`);
  } else {
    await execCommand(
      `git clone --no-checkout --branch main git@github.com:${repository}.git "${updateDir}"`
    );
  }
  await execCommand(`git -C "${updateDir}" config advice.detachedHead false`);
  console.log(`\x1b[34mChecking out commit ${commitHash}...\x1b[0m`);
  await execCommand(`git -C "${updateDir}" checkout ${commitHash}`);
  await removeGitDir(updateDir);
}

async function moveFiles(updateDir: string, rootDir: string, preservedPaths: string[] = [], managedPaths: string[] | null = null) {
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

async function installMissingDeveloperStarters(updateDir: string, rootDir: string, relativePaths = DEVELOPER_STARTERS) {
  // Preserve customised image policies when upgrading to server-authorised uploads.
  const policyPath = path.join('src', 'supacharger.adapters', 'media', 'image-targets.ts');
  const sourcePolicy = path.join(updateDir, policyPath);
  const targetPolicy = path.join(rootDir, policyPath);
  const legacyPolicy = path.join(rootDir, 'supabase', 'functions', '_shared', 'image-targets.ts');
  if (await fs.stat(sourcePolicy).then(() => true, () => false) &&
      !await fs.stat(targetPolicy).then(() => true, () => false) &&
      await fs.stat(legacyPolicy).then(() => true, () => false)) {
    const policy = await fs.readFile(legacyPolicy, 'utf8');
    const migrated = policy.replace(/(['"])\.\/image-target-contract\.ts\1/g, "'../../../supabase/functions/_shared/image-target-contract'");
    await fs.mkdir(path.dirname(targetPolicy), { recursive: true });
    await fs.writeFile(targetPolicy, "import 'server-only';\n\n" + migrated);
    // Retain the original developer-owned file for review; the new processor does not import it.
  }
  const installed = [];
  const references = relativePaths === DEVELOPER_STARTERS
    ? (await walkFiles(updateDir)).filter((file) => file.startsWith(`docs${path.sep}agents${path.sep}`) && file.endsWith('.md'))
    : [];
  for (const relPath of [...relativePaths, ...references]) {
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
      if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') continue;
      throw error;
    }
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.copyFile(source, target);
    installed.push(relPath);
  }
  return installed;
}

async function buildUpdatePlan(rootDir: string, baselineDir: string, latestDir: string) {
  const [baselineManifest, latestManifest] = await Promise.all([
    readManagedManifest(baselineDir),
    readManagedManifest(latestDir),
  ]);
  const baselineMigrationContents = await migrationContents(
    baselineDir,
    baselineManifest?.forwardOnlyMigrationPaths ?? DEFAULT_MIGRATION_PATHS
  );
  const baselineSchemaContents = await collectSchemas(baselineDir);
  const baselineBootstrap = await readFileContents(path.join(baselineDir, 'src/supacharger/database-starter/bootstrap.sql'));
  const [
    baselineFiles,
    latestFiles,
    assessment,
    accountAlignmentConfigMigration,
    authProviderConfigMigration,
    englishCatalogueAdditions,
    legacyAuthSessionConfigMigration,
    legacyMfaConfigMigration,
    localSmtpConfigMigration,
    localTotpConfigMigration,
    imageFunctionConfigMigration,
    profileMediaFunctionConfigMigration,
    rootDocumentConfigMigration,
    sessionTransferConfigMigration,
    signUpTermsConfigMigration,
    signOutPolicyConfigMigration,
  ] = await Promise.all([
    managedFiles(baselineDir, baselineManifest),
    managedFiles(latestDir, latestManifest),
    assessPostUpdateWork(rootDir, latestDir, {
      baselineMigrationContents,
      baselineSchemaContents,
      baselineBootstrap: baselineBootstrap?.toString(),
      forwardOnlyMigrationPaths: latestManifest?.forwardOnlyMigrationPaths,
    }),
    migrateAccountAlignmentConfig(rootDir, { plan: true }),
    migrateAuthProviderConfig(rootDir, { plan: true }),
    mergeEnglishCatalogue(rootDir, latestDir, { plan: true }),
    migrateLegacyAuthSessionConfig(rootDir, { plan: true }),
    migrateLegacyMfaConfig(rootDir, { plan: true }),
    migrateLocalSmtpConfig(rootDir, { plan: true }),
    migrateLocalTotpConfig(rootDir, { plan: true }),
    migrateImageFunctionConfig(rootDir, { plan: true, sourceRoot: latestDir }),
    migrateProfileMediaFunctionConfig(rootDir, { plan: true }),
    migrateRootDocumentConfig(rootDir, { plan: true }),
    migrateSessionTransferConfig(rootDir, { plan: true }),
    migrateSignUpTermsConfig(rootDir, { plan: true }),
    migrateSignOutPolicyConfig(rootDir, { plan: true, sourceRoot: latestDir }),
  ]);
  const writes = [];
  for (const relPath of latestFiles) {
    try {
      if (!await filesEqual(path.join(rootDir, relPath), path.join(latestDir, relPath))) writes.push(relPath);
    } catch {
      writes.push(relPath);
    }
  }
  const newManagedPathCollisions = await findNewManagedPathCollisions(
    rootDir,
    baselineFiles,
    latestFiles,
    latestDir,
  );
  const latestSet = new Set(latestFiles);
  const removals = baselineFiles.filter(
    (file) => !latestSet.has(file) && !matchingPreservedPath(file, latestManifest?.developerOwnedPaths ?? DEVELOPER_OWNED_PATHS)
  );
  const baselineMergeContents = await allMergeManagedContents(baselineDir, baselineManifest);
  return {
    assessment,
    accountAlignmentConfigMigration,
    authProviderConfigMigration,
    baselineFiles,
    englishCatalogueAdditions,
    latestFiles,
    latestManifest,
    legacyAuthSessionConfigMigration,
    legacyMfaConfigMigration,
    localSmtpConfigMigration,
    localTotpConfigMigration,
    imageFunctionConfigMigration,
    profileMediaFunctionConfigMigration,
    manualMergeChanges: await changedManualMergePaths(baselineDir, latestDir, latestManifest),
    newManagedPathCollisions,
    ownershipTransitionChanges: await changedOwnershipTransitionPathsFromContents(
      rootDir,
      baselineMergeContents,
      latestDir,
      latestManifest,
    ),
    removals,
    rootDocumentConfigMigration,
    sessionTransferConfigMigration,
    signUpTermsConfigMigration,
    signOutPolicyConfigMigration,
    writes,
  };
}

async function printPlan(rootDir: string, installState: InstallState, options: UpdateOptions = {}) {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'supacharger-core-plan-'));
  const baselineDir = path.join(tempRoot, 'baseline');
  const latestDir = path.join(tempRoot, 'latest');
  await fs.mkdir(baselineDir);
  await fs.mkdir(latestDir);
  try {
    await cloneAndCheckout(baselineDir, installState.commit, installState.repository, options.source);
    await cloneLatestSource(latestDir, { ref: options.ref, repository: installState.repository, source: options.source });
    const plan = await buildUpdatePlan(rootDir, baselineDir, latestDir);
    console.log('\nSupacharger core update plan (no project files or databases changed)');
    console.log(`Managed writes: ${plan.writes.length}`);
    plan.writes.forEach((file) => console.log(`  WRITE ${file}`));
    console.log(`New managed-path collisions: ${plan.newManagedPathCollisions.length}`);
    plan.newManagedPathCollisions.forEach((file) => console.log(`  COLLISION ${file}`));
    console.log(`Obsolete managed removals: ${plan.removals.length}`);
    plan.removals.forEach((file) => console.log(`  REMOVE ${file}`));
    console.log(`Dependency contract changed: ${plan.assessment.dependencyChanged ? 'yes' : 'no'}`);
    plan.assessment.removedTestScripts.forEach((name) => console.log(cleanupMessages.RemovedTestScript.replace('{name}', name)));
    if (plan.assessment.declarative) {
      console.log(messages.DeclarativeDatabaseCli.Plan.replace('{count}', String(plan.assessment.declarative.changes.length)));
      plan.assessment.declarative.changes.forEach(item => console.log(`  SCHEMA ${item.path}`));
    }
    console.log(`Changed migrations: ${plan.assessment.changedMigrations.length}`);
    plan.assessment.changedMigrations.forEach(({ path: migration }) => console.log(`  MIGRATION ${migration}`));
    console.log(`Satisfied migration aliases: ${plan.assessment.satisfiedMigrationAliases.length}`);
    plan.assessment.satisfiedMigrationAliases.forEach(({ canonical, replacement }) =>
      console.log(`  MIGRATION ALIAS ${canonical} -> ${replacement}`)
    );
    console.log(`Manual merge-managed changes: ${plan.manualMergeChanges.length}`);
    plan.manualMergeChanges.forEach((file) => console.log(`  MANUAL MERGE ${file}`));
    console.log(`Manual ownership migrations: ${plan.ownershipTransitionChanges.length}`);
    plan.ownershipTransitionChanges.forEach((file) => console.log(`  MOVE PROJECT CONFIG ${file}`));
    console.log(
      `Developer config changes: ${plan.accountAlignmentConfigMigration.length + plan.authProviderConfigMigration.length + plan.legacyAuthSessionConfigMigration.length + plan.legacyMfaConfigMigration.length + plan.rootDocumentConfigMigration.length + plan.sessionTransferConfigMigration.length + plan.signUpTermsConfigMigration.length + plan.signOutPolicyConfigMigration.length}`
    );
    plan.accountAlignmentConfigMigration.forEach((key) => console.log(`  CONFIG ${key}`));
    plan.authProviderConfigMigration.forEach((provider) => console.log(`  CONFIG AUTH_PROVDERS_ENABLED.${provider}=false`));
    plan.legacyAuthSessionConfigMigration.forEach((key) => console.log(`  CONFIG REMOVE ${key}`));
    plan.legacyMfaConfigMigration.forEach((key) => console.log(`  CONFIG REMOVE ${key}`));
    plan.rootDocumentConfigMigration.forEach((key) => console.log(`  CONFIG ${key}`));
    plan.signUpTermsConfigMigration.forEach((key) => console.log(`  CONFIG ${key}`));
    plan.sessionTransferConfigMigration.forEach((key) => console.log(`  CONFIG ${key}`));
    plan.signOutPolicyConfigMigration.forEach((key) => console.log(`  CONFIG ${key}=true`));
    console.log(`Local Supabase TOTP changes: ${plan.localTotpConfigMigration.length}`);
    plan.localTotpConfigMigration.forEach((key) => console.log(`  SUPABASE ${key}=true`));
    console.log(`Local Supabase mail changes: ${plan.localSmtpConfigMigration.length}`);
    plan.localSmtpConfigMigration.forEach((key) => console.log(`  SUPABASE ${key}`));
    console.log(`Image function bundle changes: ${plan.imageFunctionConfigMigration.length}`);
    plan.imageFunctionConfigMigration.forEach((key) => console.log(`  SUPABASE ${key}`));
    console.log(`Profile media function changes: ${plan.profileMediaFunctionConfigMigration.length}`);
    plan.profileMediaFunctionConfigMigration.forEach((key) => console.log(`  SUPABASE ${key}=false`));
    console.log(`Canonical English message additions: ${plan.englishCatalogueAdditions.length}`);
    plan.englishCatalogueAdditions.forEach((key) => console.log(`  MESSAGE ${key}`));
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
}

async function coreupdate(options: UpdateOptions = {}) {
  const integrityIgnoredFiles = [
    ...DEVELOPER_OWNED_PATHS,
    'src/supacharger/supacharger-config.ts',
  ];

  try {
    const cwd = process.cwd();
    await checkLocalCore(cwd);
    options = await prepareCoreTarget(options);
    const installState = await readInstallState(cwd);
    if (!installState) {
      console.error('\x1b[31mError: Supacharger installation metadata is missing. Aborting.\x1b[0m');
      process.exit(1);
    }


    if (options.plan === true) {
      await printPlan(cwd, installState, options);
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

    const installedCommit = installState.commit;
    console.log(`\x1b[34mCurrent core commit:\x1b[0m \x1b[32m${installedCommit}\x1b[0m`);

    let targetCommit = options.source
      ? (await execCommand('git rev-parse HEAD', { cwd: path.resolve(options.source) })).stdout.trim()
      : await getRemoteRefHash(installState.repository, options.ref);
    console.log(`\x1b[34mRequested Core commit:\x1b[0m \x1b[32m${targetCommit}\x1b[0m`);

    await fs.rm(updateDir, { recursive: true, force: true });
    await fs.mkdir(updateDir, { recursive: true });
    console.log(`\x1b[34mCreated or cleaned directory:\x1b[0m \x1b[32m${updateDir}\x1b[0m`);

    await cloneAndCheckout(updateDir, installedCommit, installState.repository, options.source);

    console.log('\x1b[34m\nChecking Core Integrity...\x1b[0m');

    const baselineManifest = await readManagedManifest(updateDir);
    const updateFiles = await managedFiles(updateDir, baselineManifest);
    const baselineManagedFiles = [...updateFiles];
    const baselineMigrationContents = await migrationContents(
      updateDir,
      baselineManifest?.forwardOnlyMigrationPaths ?? DEFAULT_MIGRATION_PATHS,
    );
    const baselineSchemaContents = await collectSchemas(updateDir);
    const baselineBootstrap = await readFileContents(path.join(updateDir, 'src/supacharger/database-starter/bootstrap.sql'));
    const baselineMergeContents = await managedFileContents(updateDir, await walkFiles(updateDir));
    const baselineOwnershipTransitionContents = await allMergeManagedContents(updateDir, baselineManifest);

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

      if (!await filesEqual(updateFilePath, localFilePath)) {
        differentFiles.push(relPath);
      }
    }

    if (missingFiles.length === 0 && differentFiles.length === 0) {
      console.log('\x1b[32m✓ Local files match the installed core baseline.\x1b[0m');
      await removeDirContents(updateDir);
      targetCommit = await cloneLatestSource(updateDir, { ref: options.source ? options.ref : targetCommit, repository: installState.repository, source: options.source });
      const latestManifest = await readManagedManifest(updateDir);
      const latestManagedFiles = await managedFiles(updateDir, latestManifest);
      const newManagedPathCollisions = await findNewManagedPathCollisions(
        cwd,
        baselineManagedFiles,
        latestManagedFiles,
        updateDir,
      );
      if (newManagedPathCollisions.length > 0) {
        throw new Error(
          `Core introduces managed paths that collide with existing project files: ${newManagedPathCollisions.join(', ')}. Move or reconcile those files before updating.`,
        );
      }
      const manualMergeChanges = await changedManualMergePathsFromContents(
        baselineMergeContents,
        updateDir,
        latestManifest,
      );
      if (manualMergeChanges.length > 0) {
        throw new Error(
          `Core changed merge-managed files that require an explicit merge strategy: ${manualMergeChanges.join(', ')}`,
        );
      }
      const ownershipTransitionChanges = await changedOwnershipTransitionPathsFromContents(
        cwd,
        baselineOwnershipTransitionContents,
        updateDir,
        latestManifest,
      );
      if (ownershipTransitionChanges.length > 0) {
        throw new Error(
          `Former merge-managed files contain project changes that must move to a developer-owned extension before Core can replace them: ${ownershipTransitionChanges.join(', ')}`,
        );
      }
      const assessment = await assessPostUpdateWork(cwd, updateDir, {
        baselineMigrationContents,
        baselineSchemaContents,
        baselineBootstrap: baselineBootstrap?.toString(),
        forwardOnlyMigrationPaths: latestManifest?.forwardOnlyMigrationPaths,
      });
      const latestManagedContents = await managedFileContents(updateDir, latestManagedFiles);
      const preservedPaths = latestManifest?.developerOwnedPaths ?? DEVELOPER_OWNED_PATHS;
      const targetsToBackup = [...latestManagedFiles, ...baselineManagedFiles.filter((file) => !latestManagedFiles.includes(file))];
      await migrateSignOutPolicyConfig(cwd, { plan: true, sourceRoot: updateDir });
      await backupConflicts(cwd, cwd, targetsToBackup);
      await moveFiles(updateDir, cwd, preservedPaths, latestManifest?.managedPaths ?? null);
      await installMissingDeveloperStarters(updateDir, cwd);
      await removeObsoleteManagedFiles(cwd, baselineManagedFiles, latestManagedFiles, preservedPaths);
      await migrateLegacyAuthSessionConfig(cwd);
      await migrateLegacyMfaConfig(cwd);
      await migrateLocalSmtpConfig(cwd);
      await migrateLocalTotpConfig(cwd);
      await migrateImageFunctionConfig(cwd, { sourceRoot: updateDir });
      await migrateProfileMediaFunctionConfig(cwd);
      await migrateAuthProviderConfig(cwd);
      await migrateRootDocumentConfig(cwd);
      await migrateAccountAlignmentConfig(cwd);
      await migrateSessionTransferConfig(cwd);
      await migrateSignUpTermsConfig(cwd);
      await migrateSignOutPolicyConfig(cwd, { sourceRoot: updateDir });
      await mergeEnglishCatalogue(cwd, updateDir);
      await migrateLegacyPostcssConfig(cwd);
      await personaliseStarterProjectStyles(cwd);
      const postUpdateComplete = await runPostUpdateSteps(cwd, assessment);
      if (!postUpdateComplete) {
        await fs.rm(updateDir, { recursive: true, force: true });
        return;
      }
      await fs.rm(updateDir, { recursive: true, force: true });
      await verifyManagedFiles(cwd, latestManagedContents);
      await writeCoreLock(cwd, targetCommit, options.coreVersion);
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
\x1b[34mChoose action:
\x1b[31m(O/OB)\x1b[34m overwrite all managed conflicts after creating recovery copies
\x1b[35m(E)\x1b[0m exit without changing Core files
\x1b[34mYour choice: \x1b[0m`;

    const action = (await askYesNo(prompt)).toUpperCase();

    if (action === 'E') {
      console.log('\x1b[34mExiting without changes.\x1b[0m');
      process.exit(0);
    }

    if (!['O', 'OB'].includes(action)) {
      console.log('\x1b[31mInvalid choice. Enter O or OB to overwrite after backup, or E to exit.\x1b[0m');
      process.exit(1);
    }

    await fs.rm(updateDir, { recursive: true, force: true });
    await fs.mkdir(updateDir, { recursive: true });
    targetCommit = await cloneLatestSource(updateDir, {
      ref: options.source ? options.ref : targetCommit,
      repository: installState.repository,
      source: options.source,
    });
    const latestManifest = await readManagedManifest(updateDir);
    const latestManagedFiles = await managedFiles(updateDir, latestManifest);
    const newManagedPathCollisions = await findNewManagedPathCollisions(
      cwd,
      baselineManagedFiles,
      latestManagedFiles,
      updateDir,
    );
    if (newManagedPathCollisions.length > 0) {
      throw new Error(
        `Core introduces managed paths that collide with existing project files: ${newManagedPathCollisions.join(', ')}. Move or reconcile those files before updating.`,
      );
    }
    const preservedPaths = latestManifest?.developerOwnedPaths ?? DEVELOPER_OWNED_PATHS;
    const manualMergeChanges = await changedManualMergePathsFromContents(
      baselineMergeContents,
      updateDir,
      latestManifest,
    );
    if (manualMergeChanges.length > 0) {
      throw new Error(
        `Core changed merge-managed files that require an explicit merge strategy: ${manualMergeChanges.join(', ')}`,
      );
    }
    const ownershipTransitionChanges = await changedOwnershipTransitionPathsFromContents(
      cwd,
      baselineOwnershipTransitionContents,
      updateDir,
      latestManifest,
    );
    if (ownershipTransitionChanges.length > 0) {
      throw new Error(
        `Former merge-managed files contain project changes that must move to a developer-owned extension before Core can replace them: ${ownershipTransitionChanges.join(', ')}`,
      );
    }
    const assessment = await assessPostUpdateWork(cwd, updateDir, {
      baselineMigrationContents,
      baselineSchemaContents,
      baselineBootstrap: baselineBootstrap?.toString(),
      forwardOnlyMigrationPaths: latestManifest?.forwardOnlyMigrationPaths,
    });
    const latestManagedContents = await managedFileContents(updateDir, latestManagedFiles);

    await migrateSignOutPolicyConfig(cwd, { plan: true, sourceRoot: updateDir });
    await backupConflicts(cwd, cwd, [
      ...latestManagedFiles,
      ...baselineManagedFiles.filter((file) => !latestManagedFiles.includes(file)),
    ]);
    await moveFiles(updateDir, cwd, preservedPaths, latestManifest?.managedPaths ?? null);
    await installMissingDeveloperStarters(updateDir, cwd);

    await removeObsoleteManagedFiles(
      cwd,
      baselineManagedFiles,
      latestManagedFiles,
      preservedPaths,
    );

    await migrateLegacyAuthSessionConfig(cwd);
    await migrateLegacyMfaConfig(cwd);
    await migrateLocalSmtpConfig(cwd);
    await migrateLocalTotpConfig(cwd);
    await migrateImageFunctionConfig(cwd, { sourceRoot: updateDir });
    await migrateProfileMediaFunctionConfig(cwd);
    await migrateAuthProviderConfig(cwd);
    await migrateRootDocumentConfig(cwd);
    await migrateAccountAlignmentConfig(cwd);
    await migrateSessionTransferConfig(cwd);
    await migrateSignUpTermsConfig(cwd);
    await migrateSignOutPolicyConfig(cwd, { sourceRoot: updateDir });
    await mergeEnglishCatalogue(cwd, updateDir);
    await migrateLegacyPostcssConfig(cwd);
    await personaliseStarterProjectStyles(cwd);
    const postUpdateComplete = await runPostUpdateSteps(cwd, assessment);
    if (!postUpdateComplete) {
      await fs.rm(updateDir, { recursive: true, force: true });
      return;
    }
    await fs.rm(updateDir, { recursive: true, force: true });
    await verifyManagedFiles(cwd, latestManagedContents);
    await writeCoreLock(cwd, targetCommit, options.coreVersion);

    await fs.rm(updateDir, { recursive: true, force: true });

    console.log('\x1b[32mUpdate complete and .sc-core-update folder removed.\x1b[0m');
  } catch (err) {
    console.error('Error during coreupdate:', err);
    console.error(
      'Recovery: the Core lock was not advanced. Inspect the Git diff and .supacharger/backups before retrying. ' +
      'Restore application files from Git or the recovery copies as appropriate. Applied database migrations are forward-only and are not rolled back by file restoration.',
    );
    process.exit(1);
  }
}

const command = Object.assign(coreupdate, { testHelpers: {
  assessPostUpdateWork,
  buildUpdatePlan,
  dependencyContract,
  dependencyContractChanged,
  detectPackageManager,
  changedManualMergePaths,
  changedOwnershipTransitionPathsFromContents,
  matchingPreservedPath,
  migrateAuthProviderConfig,
  migrateAccountAlignmentConfig,
  migrateSessionTransferConfig,
  migrateSignOutPolicyConfig,
  migrateSignUpTermsConfig,
  migrateLegacyAuthSessionConfig,
  migrateLegacyMfaConfig,
  migrateLocalSmtpConfig,
  migrateLocalSmtpConfigSource,
  migrateLocalTotpConfig,
  migrateImageFunctionConfig,
  migrateProfileMediaFunctionConfig,
  migrateLegacyConfig,
  migrateLegacyPostcssConfig,
  migrateRootDocumentConfig,
  mergeEnglishCatalogue,
  installMissingDeveloperStarters,
  moveFiles,
  mergeDependencyContract,
  managedFiles,
  managedFileContents,
  readManagedManifest,
  removeObsoleteManagedFiles,
  personaliseStarterProjectStyles,
  readInstallState,
  readMigrationAliases,
  runPostUpdateSteps,
  verifyManagedFiles,
  verifyPostUpdateFiles,
  writeCoreLock,
  cloneAndCheckout,
  cloneLatestSource,
  filesEqual,
  findNewManagedPathCollisions,
  ensureLocalBackupIgnored,
} });

export = command;
