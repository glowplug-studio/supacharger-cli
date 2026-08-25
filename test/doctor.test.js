const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const doctor = require('../commands/doctor');
const { inspect } = doctor.testHelpers;

test('recognises the canonical Supabase authentication contract', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'supacharger-doctor-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, 'src'), { recursive: true });
  await fs.mkdir(path.join(root, 'supabase', 'migrations'), { recursive: true });
  await fs.mkdir(path.join(root, '.supacharger'), { recursive: true });
  await fs.writeFile(
    path.join(root, 'package.json'),
    JSON.stringify({
      scripts: {
        'check:bruno-rpcs': 'node scripts/check-bruno-rpc-parity.mjs',
        'test:organisation-contract': 'node --test test/organisation-management-contract.test.mjs',
        'test:organisation-ui': 'node --test test/organisation-ui-contract.test.mjs',
      },
      dependencies: { next: '16.3.0', '@supabase/ssr': '0.12.4', '@supabase/supabase-js': '2.112.3' },
    })
  );
  await fs.writeFile(path.join(root, 'next.config.ts'), 'export default {};\n');
  await fs.writeFile(path.join(root, 'src', 'proxy.ts'), 'export function proxy() {}\n');
  await fs.mkdir(path.join(root, 'src', 'lib', 'supabase', 'supacharger'), { recursive: true });
  await fs.mkdir(path.join(root, 'src', 'supacharger', 'auth'), { recursive: true });
  await fs.mkdir(path.join(root, 'src', 'app', '(project)', '(verified)', 'account', 'setup-profile'), { recursive: true });
  await fs.mkdir(path.join(root, 'src', 'app', '(project)', '(onboarded)', 'account', 'billing', 'subscribe'), { recursive: true });
  await fs.writeFile(
    path.join(root, 'src', 'lib', 'supabase', 'supacharger', 'proxy.ts'),
    'export async function updateSession() { return supabase.auth.getClaims(); }\n'
  );
  await fs.writeFile(
    path.join(root, 'src', 'supacharger', 'auth', 'server-access.ts'),
    'export async function requireVerifiedUser() { return supabase.auth.getClaims(); }\nexport async function requireOnboardedUser() {}\nexport async function requireAppAccess() {}\n'
  );
  await fs.writeFile(
    path.join(root, 'src', 'supacharger.config.ts'),
    `AUTH_SESSION ALLOW_ANONYMOUS_USERS PATH_AUTH_GUARD AUTHENTICATION EMAIL_PASSWORD PASSWORDLESS_EMAIL OTP_LENGTH SIGN_UP_EMAIL_VERIFICATION PROFILE_IDENTITY AVATAR HEADER_IMAGE ACCOUNT_SETTINGS LANGUAGE CANCEL_ACCOUNT PRODUCT_PROFILE_PATH ORGANISATIONS AUTHENTICATION_HANDLE CHOOSER_PATH ROUTE_MODE PROFILE_MEDIA ACCOUNT_SUBJECTS PERSONAL ORGANISATION
MFA_TOTP: { REQUIRED_FOR_SIGN_IN: false }
POST_SIGN_IN_ONBOARDING: { REQUIRED: true, REDIRECT_PATH: '/account/setup-profile' }
BILLING_ACCESS: { REQUIRED: true, REDIRECT_PATH: '/account/billing/subscribe?full=1' }
`
  );
  await fs.writeFile(
    path.join(root, 'src', 'app', '(project)', '(verified)', 'layout.tsx'),
    'await requireVerifiedUser();\n'
  );
  for (const relativePath of [
    path.join('src', 'app', '(supacharger)', '(authenticated)', 'account', 'organisation', 'page.tsx'),
    path.join('src', 'app', '(supacharger)', '(authenticated)', '[handle]', 'settings', 'page.tsx'),
    path.join('src', 'app', '(supacharger)', '(authenticated)', '[handle]', 'settings', '[section]', 'page.tsx'),
    path.join('src', 'app', '(supacharger)', '(authenticated)', '[handle]', 'settings', 'team', 'page.tsx'),
    path.join('src', 'app', '(supacharger)', '(authenticated)', '[handle]', 'settings', 'team', '[teamTab]', 'page.tsx'),
    path.join('src', 'app', '(supacharger)', '(authenticated)', '[handle]', 'settings', 'billing', 'page.tsx'),
    path.join('src', 'app', '(supacharger)', 'api', 'organisations', 'route.ts'),
    path.join('src', 'supacharger.adapters', 'organisations', 'chrome.tsx'),
    path.join('src', 'supacharger.adapters', 'organisations', 'navigation.ts'),
    path.join('src', 'supacharger.adapters', 'organisations', 'pages.tsx'),
    path.join('src', 'supacharger.adapters', 'organisations', 'profile-extension.ts'),
    path.join('src', 'supacharger.adapters', 'organisations', 'profile-fields.tsx'),
  ]) {
    await fs.mkdir(path.dirname(path.join(root, relativePath)), { recursive: true });
    await fs.writeFile(path.join(root, relativePath), 'export {};\n');
  }
  await fs.mkdir(path.join(root, 'messages'), { recursive: true });
  await fs.writeFile(
    path.join(root, 'messages', 'en.json'),
    JSON.stringify({
      AccountSettings: { title: 'Settings' },
      AccountPreferences: { title: 'Preferences' },
      AccountSecurity: { title: 'Security' },
      Billing: { title: 'Billing' },
      Organisations: { title: 'Organisations' },
    }),
  );
  await fs.writeFile(
    path.join(root, 'src', 'app', '(project)', '(verified)', 'account', 'setup-profile', 'page.tsx'),
    'export default function Page() {}\n'
  );
  await fs.writeFile(
    path.join(root, 'src', 'app', '(project)', '(onboarded)', 'layout.tsx'),
    'await requireOnboardedUser();\n'
  );
  await fs.writeFile(
    path.join(root, 'src', 'app', '(project)', '(onboarded)', 'account', 'billing', 'subscribe', 'page.tsx'),
    'export default function Page() {}\n'
  );
  await fs.writeFile(
    path.join(root, 'supabase', 'config.toml'),
    '[auth.hook.custom_access_token]\nenabled = true\nuri = "pg-functions://postgres/app/custom_access_token_hook"\n\n[auth.mfa.totp]\nenroll_enabled = true\nverify_enabled = true\n'
  );
  await fs.writeFile(
    path.join(root, 'supabase', 'migrations', '20260813000000_claims.sql'),
    'create table app.user_roles(); create function app.custom_access_token_hook(); create table app.organisations(); create table app.organisation_members();\n'
  );
  await fs.writeFile(
    path.join(root, 'supabase', 'migrations', '20260822000000_remove_p_prefix_from_exposed_rpc_arguments.sql'),
    "-- remove_p_prefix_from_exposed_rpc_arguments\ncreate temporary table rpc_argument_rename_grants; select 'api_edge';\n"
  );
  await fs.writeFile(
    path.join(root, '.supacharger', 'managed-files.json'),
    JSON.stringify({
      managedPaths: [
        'docs/bruno/supacharger-rpc',
        'scripts/check-bruno-rpc-parity.mjs',
        'test/organisation-management-contract.test.mjs',
        'test/organisation-ui-contract.test.mjs',
      ],
      developerOwnedPaths: [],
      postUpdateChecks: ['check:bruno-rpcs', 'test:organisation-contract', 'test:organisation-ui'],
    })
  );
  await fs.mkdir(path.join(root, 'docs', 'bruno', 'supacharger-rpc'), { recursive: true });
  await fs.mkdir(path.join(root, 'scripts'), { recursive: true });
  await fs.writeFile(path.join(root, 'scripts', 'check-bruno-rpc-parity.mjs'), '// checker\n');
  await fs.writeFile(
    path.join(root, '.env.example'),
    'NEXT_PUBLIC_SUPABASE_URL=\nNEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=\n'
  );

  const checks = await inspect(root);
  assert.ok(checks.every((check) => check.ok), checks.filter((check) => !check.ok).map((check) => check.name).join(', '));
});

test('reports route-group pages that resolve to the same public path', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'supacharger-doctor-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ dependencies: {} }));
  const routes = [
    path.join('src', 'app', '(project)', '[handle]', 'settings', 'page.tsx'),
    path.join('src', 'app', '(supacharger)', '[handle]', 'settings', 'page.tsx'),
  ];
  for (const route of routes) {
    await fs.mkdir(path.dirname(path.join(root, route)), { recursive: true });
    await fs.writeFile(path.join(root, route), 'export default function Page() {}\n');
  }

  const checks = await inspect(root);
  const uniqueRoutes = checks.find((check) => check.name === 'Unique App Router pages');
  assert.equal(uniqueRoutes.ok, false);
  assert.match(uniqueRoutes.detail, /\/\[handle\]\/settings/);
  assert.match(uniqueRoutes.detail, /\(project\)/);
  assert.match(uniqueRoutes.detail, /\(supacharger\)/);
});

test('reports missing hook and claims migration without reading secret values', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'supacharger-doctor-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ dependencies: {} }));

  const checks = await inspect(root);
  assert.equal(checks.find((check) => check.name === 'Supabase custom access-token hook').ok, false);
  assert.equal(checks.find((check) => check.name === 'Custom claims migration').ok, false);
});

test('reports deprecated billing-gate properties without rewriting developer configuration', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'supacharger-doctor-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const configPath = path.join(root, 'src', 'supacharger.config.ts');
  const source = `export const config = {
  ACCOUNT_FORCE_SUBSCRIPTION: false,
  ACCOUNT_ENFORCE_SUBSCRIPTION_PATH: '/account/billing/subscribe?full=1',
};
`;

  await fs.mkdir(path.dirname(configPath), { recursive: true });
  await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ dependencies: {} }));
  await fs.writeFile(configPath, source);

  const checks = await inspect(root);
  const deprecatedCheck = checks.find((check) => check.name === 'Deprecated billing-gate configuration removed');

  assert.equal(deprecatedCheck.ok, false);
  assert.match(deprecatedCheck.detail, /ACCOUNT_FORCE_SUBSCRIPTION/);
  assert.match(deprecatedCheck.detail, /ACCOUNT_ENFORCE_SUBSCRIPTION_PATH/);
  assert.match(deprecatedCheck.detail, /back up src\/supacharger\.config\.ts/);
  assert.equal(await fs.readFile(configPath, 'utf8'), source);
});

test('reports obsolete MFA visibility config and disabled local TOTP APIs', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'supacharger-doctor-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, 'src'), { recursive: true });
  await fs.mkdir(path.join(root, 'supabase'), { recursive: true });
  await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ dependencies: {} }));
  await fs.writeFile(
    path.join(root, 'src', 'supacharger.config.ts'),
    'AUTHENTICATION EMAIL_PASSWORD PASSWORDLESS_EMAIL OTP_LENGTH SIGN_UP_EMAIL_VERIFICATION\nMFA_TOTP: { ENABLED: true, REQUIRED_FOR_SIGN_IN: true }\n',
  );
  await fs.writeFile(
    path.join(root, 'supabase', 'config.toml'),
    '[auth.mfa.totp]\nenroll_enabled = false\nverify_enabled = false\n',
  );

  const checks = await inspect(root);
  const journey = checks.find((check) => check.name === 'Authentication journey configuration');
  const localTotp = checks.find((check) => check.name === 'Local TOTP MFA APIs');
  assert.equal(journey.ok, false);
  assert.match(journey.detail, /MFA_TOTP\.ENABLED/);
  assert.equal(localTotp.ok, false);
  assert.match(localTotp.detail, /restart the local Supabase stack/);
});

test('reports a missing managed Bruno package script and assets', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'supacharger-doctor-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, '.supacharger'), { recursive: true });
  await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ dependencies: {}, scripts: {} }));
  await fs.writeFile(
    path.join(root, '.supacharger', 'managed-files.json'),
    JSON.stringify({
      managedPaths: ['docs/bruno/supacharger-rpc', 'scripts/check-bruno-rpc-parity.mjs'],
      developerOwnedPaths: [],
      postUpdateChecks: ['check:bruno-rpcs'],
    })
  );

  const checks = await inspect(root);
  assert.equal(checks.find((check) => check.name === 'Required post-update package scripts').ok, false);
  assert.equal(checks.find((check) => check.name === 'Managed Bruno RPC parity assets').ok, false);
});

test('reports a forward migration alias whose adapted migration is missing', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'supacharger-doctor-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, '.supacharger'), { recursive: true });
  await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ dependencies: {} }));
  await fs.writeFile(
    path.join(root, '.supacharger', 'migration-aliases.json'),
    JSON.stringify({
      'supabase/migrations/20260824100000_add_organisation_management.sql':
        'supabase/migrations/20260824100001_add_organisation_management.sql',
    }),
  );

  const checks = await inspect(root);
  const aliases = checks.find((check) => check.name === 'Forward migration aliases');
  assert.equal(aliases.ok, false);
  assert.match(aliases.detail, /missing/);
});

test('reports enabled recovery routes that are missing or inherit the full-app guard', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'supacharger-doctor-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(
    path.join(root, 'src', 'app', '(project)', '(authenticated)', 'account', 'setup-profile'),
    { recursive: true }
  );
  await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ dependencies: {} }));
  await fs.writeFile(
    path.join(root, 'src', 'supacharger.config.ts'),
    `POST_SIGN_IN_ONBOARDING: { REQUIRED: true, REDIRECT_PATH: '/account/setup-profile' }
BILLING_ACCESS: { REQUIRED: true, REDIRECT_PATH: '/account/billing/subscribe?full=1' }
`
  );
  await fs.writeFile(
    path.join(root, 'src', 'app', '(project)', '(authenticated)', 'layout.tsx'),
    'await requireAppAccess();\n'
  );
  await fs.writeFile(
    path.join(root, 'src', 'app', '(project)', '(authenticated)', 'account', 'setup-profile', 'page.tsx'),
    'export default function Page() {}\n'
  );

  const checks = await inspect(root);
  assert.equal(checks.find((check) => check.name === 'Onboarding recovery route').ok, true);
  assert.equal(checks.find((check) => check.name === 'Onboarding recovery boundary').ok, false);
  assert.match(
    checks.find((check) => check.name === 'Onboarding recovery boundary').detail,
    /inherits requireAppAccess/
  );
  assert.equal(checks.find((check) => check.name === 'Billing recovery route').ok, false);
});
