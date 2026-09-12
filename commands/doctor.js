const fs = require('fs/promises');
const os = require('os');
const path = require('path');

const coreupdate = require('./coreupdate');
const { printGitHubDevelopmentWarning } = require('./common/github-development-warning');

const {
  cloneAndCheckout,
  cloneLatestSource,
  filesEqual,
  managedFiles,
  readInstallState,
  readManagedManifest,
} = coreupdate.testHelpers;

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function configProperties(source) {
  const withoutComments = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  return new Set(
    [...withoutComments.matchAll(/\b([A-Za-z_$][A-Za-z0-9_$]*)\s*:/g)]
      .map((match) => match[1])
      .filter((name) => name !== 'SC_CONFIG'),
  );
}

async function compareManagedFiles(rootDir, baselineDir, latestDir) {
  const [baselineManifest, latestManifest] = await Promise.all([
    readManagedManifest(baselineDir),
    readManagedManifest(latestDir),
  ]);
  const [baselineFiles, latestFiles] = await Promise.all([
    managedFiles(baselineDir, baselineManifest),
    managedFiles(latestDir, latestManifest),
  ]);

  const localDrift = [];
  for (const relativePath of baselineFiles) {
    const localPath = path.join(rootDir, relativePath);
    if (!await exists(localPath)) {
      localDrift.push({ path: relativePath, status: 'MISSING' });
    } else if (!await filesEqual(localPath, path.join(baselineDir, relativePath))) {
      localDrift.push({ path: relativePath, status: 'MODIFIED' });
    }
  }

  const baselineSet = new Set(baselineFiles);
  const latestSet = new Set(latestFiles);
  const incomingChanges = [];
  for (const relativePath of [...new Set([...baselineFiles, ...latestFiles])].sort()) {
    if (!baselineSet.has(relativePath)) incomingChanges.push({ path: relativePath, status: 'ADD' });
    else if (!latestSet.has(relativePath)) incomingChanges.push({ path: relativePath, status: 'REMOVE' });
    else if (!await filesEqual(path.join(baselineDir, relativePath), path.join(latestDir, relativePath))) {
      incomingChanges.push({ path: relativePath, status: 'UPDATE' });
    }
  }

  return { incomingChanges, localDrift };
}

async function missingConfigProperties(rootDir, latestDir) {
  const relativePath = path.join('src', 'supacharger.config.ts');
  const [localSource, latestSource] = await Promise.all([
    fs.readFile(path.join(rootDir, relativePath), 'utf8'),
    fs.readFile(path.join(latestDir, relativePath), 'utf8'),
  ]);
  const local = configProperties(localSource);
  return [...configProperties(latestSource)].filter((property) => !local.has(property)).sort();
}

async function inspect(rootDir = process.cwd(), options = {}) {
  const installState = await readInstallState(rootDir);
  if (!installState) throw new Error('Supacharger installation metadata is missing or invalid.');

  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'supacharger-doctor-'));
  const baselineDir = path.join(temporaryRoot, 'baseline');
  const latestDir = path.join(temporaryRoot, 'latest');
  await Promise.all([fs.mkdir(baselineDir), fs.mkdir(latestDir)]);

  try {
    await cloneAndCheckout(baselineDir, installState.commit, installState.repository, options.source);
    const targetCommit = await cloneLatestSource(latestDir, {
      ref: options.ref ?? 'main',
      repository: installState.repository,
      source: options.source,
    });
    const [{ incomingChanges, localDrift }, missingConfig] = await Promise.all([
      compareManagedFiles(rootDir, baselineDir, latestDir),
      missingConfigProperties(rootDir, latestDir),
    ]);
    return { installState, targetCommit, incomingChanges, localDrift, missingConfig };
  } finally {
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  }
}

async function doctor(options = {}) {
  try {
    if (!options.source) printGitHubDevelopmentWarning();
    const result = await inspect(process.cwd(), options);
    console.log(`Installed Core commit: ${result.installState.commit}`);
    console.log(`Incoming Core commit:  ${result.targetCommit}`);

    if (result.localDrift.length === 0) console.log('✓ No local managed-file drift.');
    else result.localDrift.forEach((entry) => console.log(`LOCAL ${entry.status}: ${entry.path}`));

    if (result.incomingChanges.length === 0) console.log('✓ No Core update available.');
    else result.incomingChanges.forEach((entry) => console.log(`${entry.status}: ${entry.path}`));

    if (result.missingConfig.length === 0) console.log('✓ Configuration contains every incoming Core property.');
    else result.missingConfig.forEach((property) => console.log(`CONFIG MISSING: ${property}`));

    const passed = result.localDrift.length === 0 && result.missingConfig.length === 0;
    if (!passed) process.exitCode = 1;
    return { ...result, passed };
  } catch (error) {
    console.error(`Doctor failed: ${error.message}`);
    process.exitCode = 1;
    return { passed: false, error };
  }
}

doctor.testHelpers = { compareManagedFiles, configProperties, inspect, missingConfigProperties };

module.exports = doctor;
