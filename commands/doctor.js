const fs = require('fs/promises');
const path = require('path');

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readIfPresent(filePath) {
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch {
    return '';
  }
}

function parseJson(source) {
  try {
    return JSON.parse(source);
  } catch {
    return null;
  }
}

function readObjectBlock(source, objectName) {
  const match = new RegExp(`\\b${objectName}\\s*:`).exec(source);
  if (!match) return '';
  const openingBrace = source.indexOf('{', match.index + match[0].length);
  if (openingBrace === -1) return '';

  let depth = 0;
  for (let index = openingBrace; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') depth -= 1;
    if (depth === 0) return source.slice(openingBrace, index + 1);
  }
  return '';
}

function readRecoveryPolicy(source, objectName) {
  const block = readObjectBlock(source, objectName);
  const required = /\bREQUIRED\s*:\s*true\b/.test(block)
    ? true
    : /\bREQUIRED\s*:\s*false\b/.test(block)
      ? false
      : null;
  const redirectPath = block.match(/\bREDIRECT_PATH\s*:\s*['"]([^'"]+)['"]/)?.[1] ?? null;
  return { required, redirectPath };
}

async function walkRoutePages(directory) {
  let entries;
  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch {
    return [];
  }

  const pages = [];
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) pages.push(...await walkRoutePages(entryPath));
    else if (/^page\.(?:js|jsx|ts|tsx)$/.test(entry.name)) pages.push(entryPath);
  }
  return pages;
}

async function findRoutePage(rootDir, publicPath) {
  if (!publicPath?.startsWith('/')) return null;
  const appDirectory = path.join(rootDir, 'src', 'app');
  const expectedSegments = publicPath.split('?')[0].split('/').filter(Boolean);
  const pages = await walkRoutePages(appDirectory);

  return pages.find((pagePath) => {
    const routeSegments = path.relative(appDirectory, path.dirname(pagePath))
      .split(path.sep)
      .filter((segment) => segment && !(segment.startsWith('(') && segment.endsWith(')')));
    return routeSegments.length === expectedSegments.length &&
      routeSegments.every((segment, index) => segment === expectedSegments[index]);
  }) ?? null;
}

async function readAncestorLayouts(rootDir, pagePath) {
  const appDirectory = path.join(rootDir, 'src', 'app');
  const sources = [];
  let directory = path.dirname(pagePath);

  while (directory.startsWith(appDirectory)) {
    for (const extension of ['tsx', 'ts', 'jsx', 'js']) {
      const source = await readIfPresent(path.join(directory, `layout.${extension}`));
      if (source) sources.push(source);
    }
    if (directory === appDirectory) break;
    directory = path.dirname(directory);
  }
  return sources.join('\n');
}

async function inspectRecoveryRoute(rootDir, policy, incompatibleHelpers) {
  if (!policy.redirectPath) {
    return { exists: false, safe: false, detail: policy.required ? 'configured redirect path missing' : null };
  }

  const pagePath = await findRoutePage(rootDir, policy.redirectPath);
  if (!pagePath) {
    return { exists: false, safe: false, detail: `${policy.redirectPath} is missing` };
  }

  const layouts = await readAncestorLayouts(rootDir, pagePath);
  const incompatibleHelper = incompatibleHelpers.find((helper) => layouts.includes(helper));
  return {
    exists: true,
    safe: !incompatibleHelper,
    detail: incompatibleHelper
      ? `${policy.redirectPath} inherits ${incompatibleHelper}`
      : path.relative(rootDir, pagePath),
  };
}

async function findClaimsMigration(rootDir) {
  const migrationsDirectory = path.join(rootDir, 'supabase', 'migrations');
  let entries;
  try {
    entries = await fs.readdir(migrationsDirectory);
  } catch {
    return null;
  }

  for (const entry of entries.filter((name) => name.endsWith('.sql')).sort().reverse()) {
    const migrationPath = path.join(migrationsDirectory, entry);
    const source = await readIfPresent(migrationPath);
    if (source.includes('app.custom_access_token_hook') && source.includes('app.user_roles')) {
      return path.relative(rootDir, migrationPath);
    }
  }
  return null;
}

async function findOrganisationMigration(rootDir) {
  const migrationsDirectory = path.join(rootDir, 'supabase', 'migrations');
  let entries;
  try {
    entries = await fs.readdir(migrationsDirectory);
  } catch {
    return null;
  }

  for (const entry of entries.filter((name) => name.endsWith('.sql')).sort().reverse()) {
    const migrationPath = path.join(migrationsDirectory, entry);
    const source = await readIfPresent(migrationPath);
    if (source.includes('app.organisations') && source.includes('app.organisation_members')) {
      return path.relative(rootDir, migrationPath);
    }
  }
  return null;
}

async function findRpcArgumentMigration(rootDir) {
  const migrationsDirectory = path.join(rootDir, 'supabase', 'migrations');
  let entries;
  try {
    entries = await fs.readdir(migrationsDirectory);
  } catch {
    return null;
  }

  for (const entry of entries.filter((name) => name.endsWith('.sql')).sort().reverse()) {
    const migrationPath = path.join(migrationsDirectory, entry);
    const source = await readIfPresent(migrationPath);
    if (source.includes('remove_p_prefix_from_exposed_rpc_arguments') ||
        (source.includes('rpc_argument_rename_grants') && source.includes("'api_edge'"))) {
      return path.relative(rootDir, migrationPath);
    }
  }
  return null;
}

async function inspect(rootDir = process.cwd()) {
  const packageJson = JSON.parse(await fs.readFile(path.join(rootDir, 'package.json'), 'utf8'));
  const dependencies = { ...packageJson.dependencies, ...packageJson.devDependencies };
  const configSource = await readIfPresent(path.join(rootDir, 'supabase', 'config.toml'));
  const envExample = [
    await readIfPresent(path.join(rootDir, '.env.local.example')),
    await readIfPresent(path.join(rootDir, '.env.example')),
  ].join('\n');
  const applicationConfig = [
    await readIfPresent(path.join(rootDir, 'src', 'supacharger.config.ts')),
    await readIfPresent(path.join(rootDir, 'supacharger.config.ts')),
  ].join('\n');
  const obsoleteBillingGateProperties = [
    'ACCOUNT_FORCE_SUBSCRIPTION',
    'ACCOUNT_ENFORCE_SUBSCRIPTION_PATH',
  ].filter((property) => new RegExp(`\\b${property}\\b`).test(applicationConfig));
  const protectedProxySource = await readIfPresent(
    path.join(rootDir, 'src', 'lib', 'supabase', 'supacharger', 'proxy.ts')
  );
  const serverAccessSource = await readIfPresent(
    path.join(rootDir, 'src', 'supacharger', 'auth', 'server-access.ts')
  );
  const proxyExists =
    (await exists(path.join(rootDir, 'src', 'proxy.ts'))) ||
    (await exists(path.join(rootDir, 'proxy.ts')));
  const nextConfigExists = await Promise.all(
    ['next.config.js', 'next.config.mjs', 'next.config.ts'].map((name) => exists(path.join(rootDir, name)))
  ).then((results) => results.some(Boolean));
  const claimsMigration = await findClaimsMigration(rootDir);
  const organisationMigration = await findOrganisationMigration(rootDir);
  const rpcArgumentMigration = await findRpcArgumentMigration(rootDir);
  const managedManifestSource = await readIfPresent(path.join(rootDir, '.supacharger', 'managed-files.json'));
  const managedManifest = parseJson(managedManifestSource);
  const postUpdateChecks = managedManifest?.postUpdateChecks ?? [];
  const requiredPackageScripts = postUpdateChecks.filter((check) => check !== 'typecheck');
  const brunoCheckerPath = path.join('scripts', 'check-bruno-rpc-parity.mjs');
  const brunoCollectionPath = path.join('docs', 'bruno', 'supacharger-rpc');
  const managedPaths = managedManifest?.managedPaths ?? [];

  const onboardingPolicy = readRecoveryPolicy(applicationConfig, 'POST_SIGN_IN_ONBOARDING');
  const billingPolicy = readRecoveryPolicy(applicationConfig, 'BILLING_ACCESS');
  const [onboardingRoute, billingRoute] = await Promise.all([
    inspectRecoveryRoute(rootDir, onboardingPolicy, ['requireOnboardedUser', 'requireAppAccess']),
    inspectRecoveryRoute(rootDir, billingPolicy, ['requireAppAccess']),
  ]);

  return [
    { name: 'Next.js project', ok: Boolean(dependencies.next && nextConfigExists) },
    { name: '@supabase/ssr dependency', ok: typeof dependencies['@supabase/ssr'] === 'string' },
    { name: '@supabase/supabase-js dependency', ok: typeof dependencies['@supabase/supabase-js'] === 'string' },
    { name: 'Next.js Proxy entry point', ok: proxyExists },
    {
      name: 'Canonical claims-only Proxy helper',
      ok:
        protectedProxySource.includes('auth.getClaims()') &&
        !protectedProxySource.includes('auth.getUser()') &&
        !protectedProxySource.includes('.rpc('),
    },
    {
      name: 'Protected server-access boundary',
      ok:
        serverAccessSource.includes('requireVerifiedUser') &&
        serverAccessSource.includes('requireOnboardedUser') &&
        serverAccessSource.includes('requireAppAccess') &&
        serverAccessSource.includes('auth.getClaims()'),
    },
    {
      name: 'AUTH_SESSION configuration',
      ok:
        applicationConfig.includes('AUTH_SESSION') &&
        applicationConfig.includes('ALLOW_ANONYMOUS_USERS') &&
        !applicationConfig.includes('VERIFICATION_MODE'),
    },
    {
      name: 'PATH_AUTH_GUARD configuration',
      ok: applicationConfig.includes('PATH_AUTH_GUARD') && !applicationConfig.includes('PATH_AUTH_GARD'),
    },
    {
      name: 'Authentication journey configuration',
      ok:
        applicationConfig.includes('AUTHENTICATION') &&
        applicationConfig.includes('EMAIL_PASSWORD') &&
        applicationConfig.includes('PASSWORDLESS_EMAIL') &&
        applicationConfig.includes('OTP_LENGTH') &&
        applicationConfig.includes('SIGN_UP_EMAIL_VERIFICATION') &&
        applicationConfig.includes('MFA_TOTP'),
    },
    {
      name: 'Profile identity and onboarding configuration',
      ok:
        applicationConfig.includes('PROFILE_IDENTITY') &&
        applicationConfig.includes('POST_SIGN_IN_ONBOARDING'),
    },
    {
      name: 'Deprecated billing-gate configuration removed',
      ok: obsoleteBillingGateProperties.length === 0,
      detail: obsoleteBillingGateProperties.length > 0
        ? `${obsoleteBillingGateProperties.join(', ')}; back up src/supacharger.config.ts, remove these properties manually, then rerun supacharger doctor`
        : null,
    },
    {
      name: 'Onboarding recovery route',
      ok: onboardingPolicy.required !== true || onboardingRoute.exists,
      detail: onboardingPolicy.required === true ? onboardingRoute.detail : 'policy disabled',
    },
    {
      name: 'Onboarding recovery boundary',
      ok: onboardingPolicy.required !== true || onboardingRoute.safe,
      detail: onboardingPolicy.required === true ? onboardingRoute.detail : 'policy disabled',
    },
    {
      name: 'Billing recovery route',
      ok: billingPolicy.required !== true || billingRoute.exists,
      detail: billingPolicy.required === true ? billingRoute.detail : 'policy disabled',
    },
    {
      name: 'Billing recovery boundary',
      ok: billingPolicy.required !== true || billingRoute.safe,
      detail: billingPolicy.required === true ? billingRoute.detail : 'policy disabled',
    },
    {
      name: 'Organisation capability configuration',
      ok: applicationConfig.includes('ORGANISATIONS') && applicationConfig.includes('AUTHENTICATION_HANDLE'),
    },
    {
      name: 'Supabase custom access-token hook',
      ok:
        /\[auth\.hook\.custom_access_token\][\s\S]*?enabled\s*=\s*true/.test(configSource) &&
        configSource.includes('pg-functions://postgres/app/custom_access_token_hook'),
    },
    { name: 'Custom claims migration', ok: Boolean(claimsMigration), detail: claimsMigration },
    { name: 'Organisation foundation migration', ok: Boolean(organisationMigration), detail: organisationMigration },
    { name: 'Unprefixed exposed-RPC migration', ok: Boolean(rpcArgumentMigration), detail: rpcArgumentMigration },
    {
      name: 'Managed-file ownership manifest',
      ok:
        Array.isArray(managedManifest?.managedPaths) &&
        Array.isArray(managedManifest?.developerOwnedPaths) &&
        Array.isArray(managedManifest?.postUpdateChecks),
    },
    {
      name: 'Required post-update package scripts',
      ok: requiredPackageScripts.every(
        (script) => typeof packageJson.scripts?.[script] === 'string' && packageJson.scripts[script].trim() !== ''
      ),
      detail: requiredPackageScripts.join(', ') || 'none',
    },
    {
      name: 'Managed Bruno RPC parity assets',
      ok:
        postUpdateChecks.includes('check:bruno-rpcs') &&
        managedPaths.includes(brunoCheckerPath) &&
        managedPaths.includes(brunoCollectionPath) &&
        await exists(path.join(rootDir, brunoCheckerPath)) &&
        await exists(path.join(rootDir, brunoCollectionPath)) &&
        packageJson.scripts?.['check:bruno-rpcs'] === 'node scripts/check-bruno-rpc-parity.mjs',
    },
    {
      name: 'Public Supabase environment contract',
      ok:
        envExample.includes('NEXT_PUBLIC_SUPABASE_URL') &&
        envExample.includes('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'),
    },
  ];
}

async function doctor(rootDir = process.cwd(), options = {}) {
  const log = options.log ?? console.log;
  const checks = await inspect(rootDir);
  log('Supacharger authentication and Supabase doctor');
  for (const check of checks) {
    const suffix = check.detail ? ` (${check.detail})` : '';
    log(`${check.ok ? '✓' : '✗'} ${check.name}${suffix}`);
  }

  const passed = checks.every((check) => check.ok);
  if (!passed) process.exitCode = 1;
  return { checks, passed };
}

doctor.testHelpers = {
  findClaimsMigration,
  findOrganisationMigration,
  findRecoveryRoutePage: findRoutePage,
  findRpcArgumentMigration,
  inspect,
  inspectRecoveryRoute,
  readRecoveryPolicy,
};

module.exports = doctor;
