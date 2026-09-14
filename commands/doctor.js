const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const ts = require('typescript');

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

function unwrapExpression(expression) {
  let current = expression;
  while (
    current &&
    (ts.isAsExpression(current) ||
      ts.isTypeAssertionExpression(current) ||
      ts.isParenthesizedExpression(current) ||
      ts.isSatisfiesExpression(current) ||
      ts.isNonNullExpression(current))
  ) {
    current = current.expression;
  }
  return current;
}

function propertyName(name) {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text;
  if (ts.isComputedPropertyName(name) && (ts.isStringLiteral(name.expression) || ts.isNumericLiteral(name.expression))) {
    return name.expression.text;
  }
  return null;
}

function configInspection(source) {
  const sourceFile = ts.createSourceFile(
    'supacharger.config.ts',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  if (sourceFile.parseDiagnostics.length > 0) {
    const detail = ts.flattenDiagnosticMessageText(sourceFile.parseDiagnostics[0].messageText, '\n');
    throw new Error(`Could not parse src/supacharger.config.ts: ${detail}`);
  }

  const bindings = new Map();
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name) && declaration.initializer) {
        bindings.set(declaration.name.text, declaration.initializer);
      }
    }
  }

  const root = bindings.get('SC_CONFIG');
  if (!root) throw new Error('Could not find the SC_CONFIG object in src/supacharger.config.ts.');

  const paths = new Set();
  const warnings = [];

  function collect(expression, prefix = '', seen = new Set(), objectRequired = false) {
    const value = unwrapExpression(expression);
    if (!value) return;
    if (ts.isIdentifier(value)) {
      if (seen.has(value.text)) {
        warnings.push(`Circular configuration reference: ${value.text}`);
        return;
      }
      const resolved = bindings.get(value.text);
      if (!resolved) {
        if (objectRequired) warnings.push(`Unresolved configuration reference: ${value.text}`);
        return;
      }
      collect(resolved, prefix, new Set([...seen, value.text]), objectRequired);
      return;
    }
    if (!ts.isObjectLiteralExpression(value)) {
      if (objectRequired) warnings.push(`Unresolved object expression under ${prefix || 'SC_CONFIG'}`);
      return;
    }

    for (const property of value.properties) {
      if (ts.isSpreadAssignment(property)) {
        const before = warnings.length;
        collect(property.expression, prefix, seen, true);
        if (warnings.length === before && !ts.isObjectLiteralExpression(unwrapExpression(property.expression)) && !ts.isIdentifier(unwrapExpression(property.expression))) {
          warnings.push(`Unresolved spread under ${prefix || 'SC_CONFIG'}`);
        }
        continue;
      }

      if (!property.name) {
        warnings.push(`Unresolved configuration member under ${prefix || 'SC_CONFIG'}`);
        continue;
      }
      const name = propertyName(property.name);
      if (name === null) {
        warnings.push(`Computed configuration key under ${prefix || 'SC_CONFIG'}`);
        continue;
      }
      const currentPath = prefix ? `${prefix}.${name}` : name;
      paths.add(currentPath);

      if (ts.isPropertyAssignment(property)) collect(property.initializer, currentPath, seen);
      else if (ts.isShorthandPropertyAssignment(property)) {
        const resolved = bindings.get(property.name.text);
        if (resolved) collect(resolved, currentPath, new Set([...seen, property.name.text]));
        else warnings.push(`Unresolved shorthand configuration value: ${currentPath}`);
      }
    }
  }

  collect(root, '', new Set(), true);
  return { paths, warnings: [...new Set(warnings)].sort() };
}

function configProperties(source) {
  try {
    const inspected = configInspection(source);
    if (inspected.paths.size > 0) {
      return new Set([...inspected.paths].map((propertyPath) => propertyPath.split('.').at(-1)));
    }
  } catch (error) {
    if (!error.message.includes('Could not find the SC_CONFIG object')) throw error;
  }

  const sourceFile = ts.createSourceFile('supacharger.config.ts', source, ts.ScriptTarget.Latest, true);
  const properties = new Set();
  const visit = (node) => {
    if ((ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node) || ts.isMethodDeclaration(node)) && node.name) {
      const name = propertyName(node.name);
      if (name !== null) properties.add(name);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return properties;
}

function compareConfigSources(localSource, latestSource) {
  const local = configInspection(localSource);
  const latest = configInspection(latestSource);
  if (latest.warnings.length > 0) {
    throw new Error(`Incoming Core configuration cannot be inspected reliably: ${latest.warnings.join('; ')}`);
  }
  return {
    missing: [...latest.paths].filter((propertyPath) => !local.paths.has(propertyPath)).sort(),
    warnings: local.warnings,
  };
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
    if (!await exists(localPath)) localDrift.push({ path: relativePath, status: 'MISSING' });
    else if (!await filesEqual(localPath, path.join(baselineDir, relativePath))) {
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

async function inspectConfigProperties(rootDir, latestDir) {
  const relativePath = path.join('src', 'supacharger.config.ts');
  const [localSource, latestSource] = await Promise.all([
    fs.readFile(path.join(rootDir, relativePath), 'utf8'),
    fs.readFile(path.join(latestDir, relativePath), 'utf8'),
  ]);
  return compareConfigSources(localSource, latestSource);
}

async function missingConfigProperties(rootDir, latestDir) {
  const result = await inspectConfigProperties(rootDir, latestDir);
  return result.missing.map((propertyPath) => propertyPath.split('.').at(-1)).sort();
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
    const [{ incomingChanges, localDrift }, config] = await Promise.all([
      compareManagedFiles(rootDir, baselineDir, latestDir),
      inspectConfigProperties(rootDir, latestDir),
    ]);
    return {
      installState,
      targetCommit,
      incomingChanges,
      localDrift,
      missingConfig: config.missing,
      configWarnings: config.warnings,
    };
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

    result.configWarnings.forEach((warning) => console.log(`CONFIG INSPECTION INCOMPLETE: ${warning}`));
    const passed = result.localDrift.length === 0 && result.missingConfig.length === 0 && result.configWarnings.length === 0;
    if (!passed) process.exitCode = 1;
    return { ...result, passed };
  } catch (error) {
    console.error(`Doctor failed: ${error.message}`);
    process.exitCode = 1;
    return { passed: false, error };
  }
}

doctor.testHelpers = {
  compareConfigSources,
  compareManagedFiles,
  configInspection,
  configProperties,
  inspect,
  inspectConfigProperties,
  missingConfigProperties,
};

module.exports = doctor;
