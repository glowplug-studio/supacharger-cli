const { execFile } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const readline = require('readline');
const AdmZip = require('adm-zip');

const { prepareStarter } = require('./common/test-distribution');
const { assertSupportedCore } = require('./common/core-compatibility');
const { configureEnvironment, configureProjectNamespace, setProjectNamespace, loadPrompts } = require('./environment');
const { selectAvailableExtensions } = require('./extensions');
const { loadCoreDescriptor, readLocation, REGISTRY_MANIFEST_URL } = require('./extensions/registry.cjs');
const { runSetupPreview } = require('./setup-preview');

const INIT_BANNER_PRIMARY = [
  ' ▗▄▄▖▗▖ ▗▖▗▄▄▖  ▗▄▖  ▗▄▄▖▗▖ ▗▖ ▗▄▖ ▗▄▄▖  ▗▄▄▖▗▄▄▄▖▗▄▄▖',
  '▐▌   ▐▌ ▐▌▐▌ ▐▌▐▌ ▐▌▐▌   ▐▌ ▐▌▐▌ ▐▌▐▌ ▐▌▐▌   ▐▌   ▐▌ ▐▌',
  ' ▝▀▚▖▐▌ ▐▌▐▛▀▘ ▐▛▀▜▌▐▌   ▐▛▀▜▌▐▛▀▜▌▐▛▀▚▖▐▌▝▜▌▐▛▀▀▘▐▛▀▚▖',
  '▗▄▄▞▘▝▚▄▞▘▐▌   ▐▌ ▐▌▝▚▄▄▖▐▌ ▐▌▐▌ ▐▌▐▌ ▐▌▝▚▄▞▘▐▙▄▄▖▐▌ ▐▌',
];

const INIT_BANNER_CLI = [
  '  ▗▄▄▖▗▖   ▗▄▄▄▖',
  '▐▌   ▐▌     █',
  '▐▌   ▐▌     █',
  '▝▚▄▄▖▐▙▄▄▖▗▄█▄▖',
];

function printInitialiseBanner() {
  const colourEnabled = process.stdout.isTTY && !process.env.NO_COLOR;
  const lines = INIT_BANNER_PRIMARY.map((primary, index) => colourEnabled
    ? `\x1b[1;36m${primary}\x1b[0m \x1b[1;35m${INIT_BANNER_CLI[index]}\x1b[0m`
    : `${primary} ${INIT_BANNER_CLI[index]}`
  );
  console.log(`${lines.join('\n')}\n`);
}

function printInitialiseStep(number, message) {
  const line = `[${number}/7] ${message}`;
  console.log(process.stdout.isTTY && !process.env.NO_COLOR ? `\x1b[35m${line}\x1b[0m` : line);
}

function dependencyStatus(text, colourCode) {
  return process.stdout.isTTY && !process.env.NO_COLOR ? `\x1b[${colourCode}m${text}\x1b[0m` : text;
}

function execFileCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(command, args, { ...options, maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        error.stderr = stderr;
        reject(error);
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

async function inspectCommand(command, args = ['--version'], run = execFileCommand) {
  try {
    const { stdout, stderr } = await run(command, args);
    return { available: true, version: (stdout || stderr || '').trim().split(/\r?\n/, 1)[0] };
  } catch (error) {
    if (error?.code === 'ENOENT') return { available: false, version: '' };
    return { available: false, version: '', reason: error?.message };
  }
}

async function checkInitialiseDependencies(options = {}) {
  const copy = require('../messages/en.json').InitialiseCli;
  const run = options.run ?? execFileCommand;
  const [npm, npx, git, docker, supabase] = await Promise.all([
    inspectCommand('npm', ['--version'], run),
    inspectCommand('npx', ['--version'], run),
    inspectCommand('git', ['--version'], run),
    inspectCommand('docker', ['--version'], run),
    inspectCommand('supabase', ['--version'], run),
  ]);
  const dependencies = [
    { ...npm, label: copy.DependencyNpm, missing: copy.DependencyNpmMissing },
    { ...npx, label: copy.DependencyNpx, missing: copy.DependencyNpxMissing },
    { ...git, label: copy.DependencyGit, missing: copy.DependencyGitMissing },
    { ...docker, label: copy.DependencyDocker, missing: copy.DependencyDockerMissing },
    { ...supabase, label: copy.DependencySupabase, missing: copy.DependencySupabaseMissing },
  ];

  console.log(`\n${copy.DependencyHeading}`);
  console.log(`${dependencyStatus(copy.DependencyMet, '32')} ${copy.DependencyNode.replace('{version}', process.version)}`);
  for (const dependency of dependencies) {
    if (dependency.available) {
      console.log(`${dependencyStatus(copy.DependencyMet, '32')} ${dependency.label}${dependency.version ? ` ${dependency.version}` : ''}`);
    } else {
      console.log(`${dependencyStatus(copy.DependencyNotMet, '33')} ${dependency.missing}`);
    }
  }

  const missing = dependencies.filter(dependency => !dependency.available);
  if (missing.length && process.stdin.isTTY && process.stdout.isTTY) {
    const { default: confirm } = await import('@inquirer/confirm');
    const proceed = await confirm({ message: `${copy.DependencyContinue}\n`, default: true });
    if (!proceed) {
      const error = new Error('Cancelled by user');
      error.code = 'USER_CANCELLED';
      throw error;
    }
  }
  return { dependencies, missing };
}

function askQuestion(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    rl.question(question, answer => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function confirmReplacement(targetDir) {
  const copy = require('../messages/en.json').InitialiseCli;
  const warning = `\x1b[41m\x1b[97m ${copy.ReplacementWarning} \x1b[0m`;
  console.log(`\n${warning} ${copy.ReplacementIntroduction}`);
  console.log(`\x1b[33m${copy.ReplacementTarget.replace('{path}', targetDir)}\x1b[0m`);
  console.log(copy.ReplacementDetail);
  while (true) {
    const answer = await askQuestion(`${copy.ReplacementQuestion}\n`);
    if (/^y$/i.test(answer)) return;
    if (/^n$/i.test(answer)) {
      const error = new Error('Cancelled by user');
      error.code = 'USER_CANCELLED';
      throw error;
    }
    console.log(copy.ReplacementInvalid);
  }
}

function isPromptCancellation(error) {
  return error?.name === 'ExitPromptError' || error?.code === 'ABORT_ERR';
}

function initialiseFailureMessage(error, targetDir, coreInstalled) {
  const copy = require('../messages/en.json').InitialiseCli;
  if (error?.code === 'PROJECT_NAMESPACE_MISSING') {
    return copy.NamespaceUnsupported
      .replace('{path}', targetDir)
      .replace('{status}', coreInstalled ? copy.CoreInstalledStatus : copy.CoreNotInstalledStatus);
  }
  if (typeof error?.message === 'string' && error.message.trim()) {
    return copy.Failed.replace('{reason}', error.message.trim());
  }
  return copy.UnexpectedFailure;
}

async function removeGitDir(dir) {
  const gitPath = path.join(dir, '.git');
  try {
    const stat = await fs.stat(gitPath);
    if (stat.isDirectory()) {
      await fs.rm(gitPath, { recursive: true, force: true });
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}

async function writeCoreLock(rootDir, repository, commit, version) {
  const lockPath = path.join(rootDir, '.supacharger', 'core-lock.json');
  await fs.mkdir(path.dirname(lockPath), { recursive: true });
  await fs.writeFile(lockPath, `${JSON.stringify({ repository, version, commit }, null, 2)}\n`, 'utf8');
}

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function isCurrentDirTarget(target) {
  return !target || target === '.';
}

function assertSafeTargetDirectory(targetDir, cwd = process.cwd()) {
  const resolvedTarget = path.resolve(targetDir);
  const resolvedCwd = path.resolve(cwd);
  const filesystemRoot = path.parse(resolvedTarget).root;
  if (resolvedTarget === filesystemRoot || resolvedTarget === path.resolve(os.homedir())) {
    throw new Error(`Refusing to initialise into unsafe target directory: ${resolvedTarget}`);
  }

  const targetContainsCwd = path.relative(resolvedTarget, resolvedCwd);
  if (
    resolvedTarget !== resolvedCwd &&
    targetContainsCwd !== '..' &&
    !targetContainsCwd.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(targetContainsCwd)
  ) {
    throw new Error(`Refusing to initialise into a parent of the current working directory: ${resolvedTarget}`);
  }
}

function githubRepositorySlug(repositoryUrl) {
  const match = /^(?:https:\/\/github\.com\/|git@github\.com:)([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+?)(?:\.git)?$/.exec(repositoryUrl);
  if (!match) throw new Error('Core registry repository must be a GitHub repository');
  return match[1];
}

function gitRepositoryUrls(repositoryUrl) {
  const slug = githubRepositorySlug(repositoryUrl);
  return [...new Set([repositoryUrl, `git@github.com:${slug}.git`])];
}

async function gitAvailable(run = execFileCommand) {
  try {
    await run('git', ['--version']);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

async function checkoutCoreWithGit(descriptor, targetDir, run = execFileCommand) {
  let lastError;
  for (const repositoryUrl of gitRepositoryUrls(descriptor.github_repo_url)) {
    await fs.rm(targetDir, { recursive: true, force: true });
    await fs.mkdir(targetDir, { recursive: true });
    try {
      await run('git', ['init', '--quiet', targetDir]);
      await run('git', ['-C', targetDir, 'remote', 'add', 'origin', repositoryUrl]);
      await run('git', ['-C', targetDir, 'fetch', '--quiet', '--depth', '1', 'origin', descriptor.source_commit], {
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      });
      await run('git', ['-C', targetDir, 'checkout', '--quiet', '--detach', 'FETCH_HEAD']);
      const { stdout } = await run('git', ['-C', targetDir, 'rev-parse', 'HEAD']);
      const commit = stdout.trim();
      if (commit !== descriptor.source_commit) throw new Error('Git checkout does not match the registered Core commit');
      return commit;
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(`Git could not download the registered Core repository: ${lastError?.stderr?.trim() || lastError?.message}`);
}

function safeArchivePath(entryName, rootName) {
  if (!entryName || entryName.includes('\\') || entryName.includes('\0') || entryName.startsWith('/')) {
    throw new Error('Core ZIP contains an unsafe path');
  }
  const parts = entryName.replace(/\/$/, '').split('/');
  if (parts.some(part => !part || part === '.' || part === '..') || parts[0] !== rootName) {
    throw new Error('Core ZIP contains an unsafe path');
  }
  return parts.slice(1).join('/');
}

async function extractCoreZip(archiveBytes, targetDir) {
  const archive = new AdmZip(archiveBytes);
  const entries = archive.getEntries();
  if (entries.length === 0 || entries.length > 25_000) throw new Error('Core ZIP has an invalid file count');
  const firstParts = entries.map(entry => entry.entryName.replace(/\/$/, '').split('/')[0]).filter(Boolean);
  const rootName = firstParts[0];
  if (!rootName || firstParts.some(name => name !== rootName)) throw new Error('Core ZIP must contain one root directory');

  const seen = new Set();
  let extractedBytes = 0;
  await fs.mkdir(targetDir, { recursive: true });
  for (const entry of entries) {
    const relativePath = safeArchivePath(entry.entryName, rootName);
    if (!relativePath) continue;
    const key = relativePath.toLowerCase();
    if (seen.has(key)) throw new Error(`Core ZIP contains a duplicate path: ${relativePath}`);
    seen.add(key);

    const mode = (entry.header.attr >>> 16) & 0xffff;
    if ((mode & 0o170000) === 0o120000) throw new Error(`Core ZIP contains a symbolic link: ${relativePath}`);
    const destination = path.resolve(targetDir, relativePath);
    if (destination !== targetDir && !destination.startsWith(`${targetDir}${path.sep}`)) throw new Error('Core ZIP path escapes its target');
    if (entry.isDirectory) {
      await fs.mkdir(destination, { recursive: true });
      continue;
    }

    const bytes = entry.getData();
    extractedBytes += bytes.length;
    if (extractedBytes > 512 * 1024 * 1024) throw new Error('Core ZIP expands beyond the supported size');
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(destination, bytes, { mode: mode & 0o111 ? 0o755 : 0o644 });
  }
}

async function downloadCoreZip(descriptor, targetDir, options = {}) {
  const archiveBytes = await readLocation(descriptor.download_url, {
    fetch: options.fetch,
    maxBytes: 256 * 1024 * 1024,
    timeout: 60_000,
  });
  const checksum = crypto.createHash('sha256').update(archiveBytes).digest('hex');
  if (checksum !== descriptor.archive_checksum.value) throw new Error('Core ZIP checksum does not match the registry');
  await extractCoreZip(archiveBytes, targetDir);
  return descriptor.source_commit;
}

async function acquireCore(descriptor, targetDir, options = {}) {
  if (await (options.gitAvailable ?? gitAvailable)(options.run)) {
    return checkoutCoreWithGit(descriptor, targetDir, options.run);
  }
  return downloadCoreZip(descriptor, targetDir, options);
}

async function rollbackInitialise(targetDir, previousDir, installedNames, movedPrevious, targetExisted) {
  for (const name of [...installedNames].reverse()) {
    await fs.rm(path.join(targetDir, name), { recursive: true, force: true });
  }
  for (const name of [...movedPrevious].reverse()) {
    await fs.rename(path.join(previousDir, name), path.join(targetDir, name));
  }
  if (!targetExisted) {
    const remaining = await fs.readdir(targetDir);
    if (remaining.length === 0) await fs.rmdir(targetDir);
  }
}

async function installPreparedStarter(preparedDir, targetDir, previousDir, targetExisted) {
  await fs.mkdir(targetDir, { recursive: true });
  const movedPrevious = [];
  const installedNames = [];
  try {
    const existing = await fs.readdir(targetDir, { withFileTypes: true });
    for (const entry of existing) {
      if (entry.name === '.git') continue;
      await fs.rename(path.join(targetDir, entry.name), path.join(previousDir, entry.name));
      movedPrevious.push(entry.name);
    }

    const prepared = await fs.readdir(preparedDir, { withFileTypes: true });
    for (const entry of prepared) {
      if (entry.name === '.git') continue;
      await fs.rename(path.join(preparedDir, entry.name), path.join(targetDir, entry.name));
      installedNames.push(entry.name);
    }
  } catch (error) {
    try {
      await rollbackInitialise(targetDir, previousDir, installedNames, movedPrevious, targetExisted);
    } catch (rollbackError) {
      const failure = new Error(
        `Initialisation failed and automatic restoration was incomplete. Recovery files remain at ${previousDir}. ` +
        `Original error: ${error.message}. Restoration error: ${rollbackError.message}`,
      );
      failure.recoveryDirectory = previousDir;
      throw failure;
    }
    throw new Error(`Initialisation failed before completion; the original target contents were restored. ${error.message}`);
  }
}

async function initialise(target = '.', options = {}) {
  const cwd = process.cwd();
  const useCurrentDir = isCurrentDirTarget(target);
  const resolvedTargetDir = useCurrentDir ? cwd : path.resolve(cwd, target);
  let transactionRoot = null;
  let retainTransaction = false;
  let coreInstalled = false;

  try {
    if (options.namespace !== undefined && (typeof options.namespace !== 'string' || (options.namespace !== '' && !/^[a-z][a-z0-9_]{0,5}$/.test(options.namespace)))) {
      throw new Error(require('../messages/en.json').EnvironmentSetupCli.NamespaceInvalid);
    }
    printInitialiseBanner();
    assertSafeTargetDirectory(resolvedTargetDir, cwd);
    await checkInitialiseDependencies({ run: options.dependencyRun });

    const targetExisted = await pathExists(resolvedTargetDir);
    const targetEntries = targetExisted ? await fs.readdir(resolvedTargetDir, { withFileTypes: true }) : [];
    const hasContentToReplace = targetEntries.some(entry => entry.name !== '.git');

    if (hasContentToReplace) {
      await confirmReplacement(resolvedTargetDir);
    }

    const copy = require('../messages/en.json').InitialiseCli;
    printInitialiseStep(1, copy.StepRegistry);
    const descriptor = await loadCoreDescriptor(options.registry, { fetch: options.fetch });
    assertSupportedCore(descriptor.version);
    const repository = githubRepositorySlug(descriptor.github_repo_url);

    printInitialiseStep(2, copy.StepWorkspace);
    const parentDir = path.dirname(resolvedTargetDir);
    await fs.mkdir(parentDir, { recursive: true });
    transactionRoot = await fs.mkdtemp(path.join(parentDir, `.${path.basename(resolvedTargetDir)}.supacharger-init-`));
    const preparedDir = path.join(transactionRoot, 'prepared');
    const previousDir = path.join(transactionRoot, 'previous');
    await fs.mkdir(previousDir);

    printInitialiseStep(3, copy.StepDownload.replace('{version}', descriptor.version));
    const commitHash = await acquireCore(descriptor, preparedDir, options);

    printInitialiseStep(4, copy.StepPrepare);
    await prepareStarter(preparedDir);
    await removeGitDir(preparedDir);
    const namespace = options.namespace !== undefined
      ? await setProjectNamespace(preparedDir, options.namespace)
      : process.stdin.isTTY && process.stdout.isTTY
        ? await configureProjectNamespace(preparedDir, await loadPrompts())
        : await setProjectNamespace(preparedDir, '');
    const databaseStarter = path.join(preparedDir, 'src/supacharger/database-starter.cjs');
    if (!await pathExists(databaseStarter)) throw new Error(copy.DatabaseStarterMissing);
    require(databaseStarter).prepareFreshDatabase(preparedDir, namespace);

    printInitialiseStep(5, copy.StepLock.replace('{version}', descriptor.version));
    await writeCoreLock(preparedDir, repository, commitHash, descriptor.version);

    printInitialiseStep(6, copy.StepInstall.replace('{path}', resolvedTargetDir));
    try {
      await installPreparedStarter(preparedDir, resolvedTargetDir, previousDir, targetExisted);
      coreInstalled = true;
    } catch (error) {
      retainTransaction = Boolean(error.recoveryDirectory);
      throw error;
    }

    printInitialiseStep(7, copy.StepCleanup);
    await fs.rm(transactionRoot, { recursive: true, force: true });
    transactionRoot = null;

    if (process.stdin.isTTY && process.stdout.isTTY) {
      await configureEnvironment(resolvedTargetDir, { namespace });
      if (!options.skipSkills) {
        try {
          await require('./skills/installer.cjs').runSkills([], { root: resolvedTargetDir, throwOnCancel: true });
        } catch (error) {
          if (isPromptCancellation(error)) throw error;
          console.warn(require('./skills/installer.cjs').message('OptionalFailed', { reason: error.message }));
        }
      }
      try {
        await selectAvailableExtensions({ root: resolvedTargetDir, registry: options.registry });
      } catch (error) {
        if (isPromptCancellation(error)) throw error;
        console.warn(copyInitialiseExtensionFailure(error.message));
      }
      await runSetupPreview();
    }

    console.log('\x1b[32m✓ Initialise completed successfully. Review and commit the new application files.\x1b[0m');
  } catch (error) {
    if (transactionRoot && !retainTransaction) {
      await fs.rm(transactionRoot, { recursive: true, force: true }).catch(() => {});
    }
    if (error?.code === 'USER_CANCELLED' || isPromptCancellation(error)) {
      const cancellationCopy = require('../messages/en.json').InitialiseCli;
      const message = coreInstalled
        ? cancellationCopy.CancelledAfterInstall.replace('{path}', resolvedTargetDir)
        : cancellationCopy.CancelledBeforeInstall;
      console.log(`\n\x1b[34m${message}\x1b[0m`);
      process.exitCode = error?.code === 'USER_CANCELLED' ? 0 : 130;
      return;
    }
    console.error(`\x1b[31m${initialiseFailureMessage(error, resolvedTargetDir, coreInstalled)}\x1b[0m`);
    process.exitCode = 1;
    return;
  }
}

module.exports = initialise;
module.exports.testHelpers = {
  acquireCore,
  assertSafeTargetDirectory,
  checkoutCoreWithGit,
  confirmReplacement,
  checkInitialiseDependencies,
  downloadCoreZip,
  extractCoreZip,
  gitAvailable,
  githubRepositorySlug,
  installPreparedStarter,
  inspectCommand,
  initialiseFailureMessage,
  isPromptCancellation,
  isCurrentDirTarget,
  printInitialiseBanner,
  printInitialiseStep,
  rollbackInitialise,
};

function copyInitialiseExtensionFailure(reason) {
  return require('../messages/en.json').ExtensionsCli.InitialiseFailed.replace('{reason}', reason);
}
