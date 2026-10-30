const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const ts = require('typescript');

const copy = require('../messages/en.json').EnvironmentSetupCli;

const COLOURS = {
  lime: '\x1b[38;5;10m',
  purple: '\x1b[38;5;135m',
  cyan: '\x1b[36m',
  reset: '\x1b[0m',
};

function colour(text, name) {
  if (!process.stdout.isTTY || process.env.NO_COLOR) return text;
  return `${COLOURS[name]}${text}${COLOURS.reset}`;
}

function generateSecret() {
  return crypto.randomBytes(32).toString('hex');
}

function namespaceReplacement(source, namespace, configPath) {
  if (typeof namespace !== 'string' || (namespace !== '' && !/^[a-z][a-z0-9_]{0,5}$/.test(namespace))) throw new Error(copy.NamespaceInvalid);
  const sourceFile = ts.createSourceFile(configPath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const declaration = sourceFile.statements
    .filter(ts.isVariableStatement)
    .flatMap(statement => statement.declarationList.declarations)
    .find(item => ts.isIdentifier(item.name) && item.name.text === 'SC_CONFIG');
  if (!declaration || !declaration.initializer || !ts.isObjectLiteralExpression(declaration.initializer)) {
    const error = new Error(copy.NamespaceConfigMissing.replace('{path}', configPath));
    error.code = 'PROJECT_NAMESPACE_MISSING';
    throw error;
  }
  const properties = declaration.initializer.properties.filter(property =>
    ts.isPropertyAssignment(property) &&
    ((ts.isIdentifier(property.name) && property.name.text === 'PROJECT_NAMESPACE') ||
      (ts.isStringLiteral(property.name) && property.name.text === 'PROJECT_NAMESPACE'))
  );
  if (properties.length !== 1) {
    const error = new Error(copy.NamespaceConfigMissing.replace('{path}', configPath));
    error.code = 'PROJECT_NAMESPACE_MISSING';
    throw error;
  }
  const initializer = properties[0].initializer;
  const value = `'${namespace}'`;
  return `${source.slice(0, initializer.getStart(sourceFile))}${value}${source.slice(initializer.end)}`;
}

async function readProjectNamespace(root) {
  const configPath = path.join(root, 'src', 'supacharger.config.ts');
  const source = await fs.readFile(configPath, 'utf8');
  // Use the CLI's TypeScript dependency; a new application has no node_modules yet.
  const file = ts.createSourceFile(configPath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const declaration = file.statements.filter(ts.isVariableStatement)
    .flatMap(statement => statement.declarationList.declarations)
    .find(item => ts.isIdentifier(item.name) && item.name.text === 'SC_CONFIG');
  if (!declaration?.initializer || !ts.isObjectLiteralExpression(declaration.initializer)) throw new Error(copy.NamespaceConfigMissing.replace('{path}', configPath));
  const properties = declaration.initializer.properties.filter(property => ts.isPropertyAssignment(property) && property.name.getText(file).replace(/^['"]|['"]$/g, '') === 'PROJECT_NAMESPACE');
  if (properties.length !== 1 || !ts.isStringLiteral(properties[0].initializer)) throw new Error(copy.NamespaceConfigMissing.replace('{path}', configPath));
  const namespace = properties[0].initializer.text;
  namespaceReplacement(source, namespace, configPath);
  return namespace;
}

async function setProjectNamespace(root, namespace) {
  const configPath = path.join(root, 'src', 'supacharger.config.ts');
  const source = await fs.readFile(configPath, 'utf8');
  await fs.writeFile(configPath, namespaceReplacement(source, namespace, configPath), 'utf8');
  return namespace;
}

async function configureProjectNamespace(root, prompts) {
  console.log(`\n${colour(copy.NamespaceHeading, 'cyan')}`);
  const namespace = (await prompts.input({
    message: `${copy.NamespacePrompt}\n`,
    validate: answer => !answer.trim() || /^[a-z][a-z0-9_]{0,5}$/.test(answer.trim()) || copy.NamespaceInvalid,
  })).trim();
  await setProjectNamespace(root, namespace);
  console.log(namespace
    ? copy.NamespaceSet.replace('{namespace}', namespace)
    : copy.NamespaceSkipped);
  return namespace;
}

function replaceEnvironmentValue(source, name, value) {
  if (/[\r\n]/.test(value)) throw new Error(`${name} cannot contain a line break`);
  const line = `${name}=${value}`;
  const pattern = new RegExp(`^${name}=.*$`, 'm');
  if (pattern.test(source)) return source.replace(pattern, line);
  return `${source.replace(/\s*$/, '')}\n${line}\n`;
}

async function promptEnvironmentValues(prompts, imageSecretName = 'SC_IMAGE_UPLOAD_SIGNING_SECRET') {
  const values = {};

  console.log(`\n${colour(copy.SupabaseHeading, 'lime')}`);
  if (await prompts.confirm({ message: colour(copy.SupabaseConfirm, 'lime'), default: true })) {
    values.NEXT_PUBLIC_SUPABASE_URL = await prompts.input({
      message: copy.SupabaseUrl,
    });
    values.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = await prompts.password({
      message: copy.SupabasePublishableKey,
      mask: '*',
    });
    values.SUPABASE_SERVICE_ROLE_KEY = await prompts.password({
      message: copy.SupabaseServiceRoleKey,
      mask: '*',
    });
  }

  console.log(`\n${colour(copy.StripeHeading, 'purple')}`);
  if (await prompts.confirm({ message: colour(copy.StripeConfirm, 'purple'), default: true })) {
    values.STRIPE_SECRET_KEY = await prompts.password({
      message: copy.StripeSecretKey,
      mask: '*',
    });
    values.STRIPE_WEBHOOK_SECRET = await prompts.password({
      message: copy.StripeWebhookSecret,
      mask: '*',
    });
    values.STRIPE_EVENT_PROCESSOR_SECRET = generateSecret();
    values.STRIPE_RECONCILIATION_SECRET = generateSecret();
    console.log(copy.StripeGeneratedSecrets);
  }

  console.log(`\n${colour(copy.ApplicationHeading, 'cyan')}`);
  values.NEXT_PUBLIC_SITE_URL = await prompts.input({
    message: copy.SiteUrl,
    default: 'http://localhost:3000',
  });
  values.NEXT_PUBLIC_GOOGLE_ANALYTICS_ID = await prompts.input({
    message: copy.GoogleAnalyticsId,
    default: '',
  });
  values[imageSecretName] = generateSecret();
  console.log(copy.ImageSigningSecret);

  return values;
}

async function loadPrompts() {
  const [{ default: confirm }, { default: input }, { default: password }] = await Promise.all([
    import('@inquirer/confirm'),
    import('@inquirer/input'),
    import('@inquirer/password'),
  ]);
  return { confirm, input, password };
}

async function prepareDeclarativeStarter(root, namespace) {
  const helper = path.join(root, 'src/supacharger/declarative-namespace.cjs');
  if (await fs.stat(helper).then(() => true, error => { if (error.code === 'ENOENT') return false; throw error; })) {
    require(helper).prepareStarterSchemas(root, namespace === undefined ? await readProjectNamespace(root) : namespace);
  }
}

async function configureEnvironment(root, options = {}) {
  const examplePath = path.join(root, '.env.local.example');
  const destinationPath = path.join(root, '.env.local');
  let environmentExists = false;
  try {
    await fs.access(destinationPath);
    environmentExists = true;
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  if (environmentExists) {
    // Resumed installs retain their existing namespace and secrets, but still
    // render an unprepared starter using the configured PROJECT_NAMESPACE.
    await prepareDeclarativeStarter(root, options.namespace);
    console.log(copy.Existing.replace('{path}', destinationPath));
    return { created: false, path: destinationPath };
  }

  // Resolve the naming contract before saving a choice. Never create secrets
  // under a default prefix after namespace configuration has failed.
  const { resourceName } = require(path.join(root, 'src/supacharger/namespace.cjs'));
  const prompts = options.prompts ?? await loadPrompts();
  const namespace = options.namespace === undefined
    ? await configureProjectNamespace(root, prompts) : options.namespace;
  await prepareDeclarativeStarter(root, namespace);
  const imageSecretName = resourceName(namespace, 'image_upload_signing_secret', 'secret');

  let contents;
  try {
    contents = await fs.readFile(examplePath, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') throw new Error(copy.MissingExample.replace('{path}', examplePath));
    throw error;
  }

  contents = contents.replace(/^(?:SC_)?IMAGE_UPLOAD_SIGNING_SECRET=/m, `${imageSecretName}=`);
  const values = await promptEnvironmentValues(prompts, imageSecretName);
  for (const [name, value] of Object.entries(values)) {
    if (!value.trim()) continue;
    contents = replaceEnvironmentValue(contents, name, value.trim());
  }
  await fs.writeFile(destinationPath, contents, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  console.log(copy.Created.replace('{path}', destinationPath));
  return { created: true, path: destinationPath };
}

module.exports = {
  configureEnvironment,
  setProjectNamespace,
  readProjectNamespace,
  loadPrompts,
  configureProjectNamespace,
  generateSecret,
  namespaceReplacement,
  promptEnvironmentValues,
  replaceEnvironmentValue,
};
