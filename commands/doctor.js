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
  const managedManifest = await readIfPresent(path.join(rootDir, '.supacharger', 'managed-files.json'));

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
      ok: serverAccessSource.includes('requireAppAccess') && serverAccessSource.includes('auth.getClaims()'),
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
        managedManifest.includes('managedPaths') &&
        managedManifest.includes('developerOwnedPaths') &&
        managedManifest.includes('postUpdateChecks'),
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

doctor.testHelpers = { findClaimsMigration, findOrganisationMigration, findRpcArgumentMigration, inspect };

module.exports = doctor;
