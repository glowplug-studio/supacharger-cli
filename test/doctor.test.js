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
      scripts: { 'check:bruno-rpcs': 'node scripts/check-bruno-rpc-parity.mjs' },
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
    `AUTH_SESSION ALLOW_ANONYMOUS_USERS PATH_AUTH_GUARD AUTHENTICATION EMAIL_PASSWORD PASSWORDLESS_EMAIL OTP_LENGTH SIGN_UP_EMAIL_VERIFICATION MFA_TOTP PROFILE_IDENTITY ORGANISATIONS AUTHENTICATION_HANDLE
POST_SIGN_IN_ONBOARDING: { REQUIRED: true, REDIRECT_PATH: '/account/setup-profile' }
BILLING_ACCESS: { REQUIRED: true, REDIRECT_PATH: '/account/billing/subscribe?full=1' }
`
  );
  await fs.writeFile(
    path.join(root, 'src', 'app', '(project)', '(verified)', 'layout.tsx'),
    'await requireVerifiedUser();\n'
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
    '[auth.hook.custom_access_token]\nenabled = true\nuri = "pg-functions://postgres/app/custom_access_token_hook"\n'
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
      managedPaths: ['docs/bruno/supacharger-rpc', 'scripts/check-bruno-rpc-parity.mjs'],
      developerOwnedPaths: [],
      postUpdateChecks: ['check:bruno-rpcs'],
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
  assert.ok(checks.every((check) => check.ok));
});

test('reports missing hook and claims migration without reading secret values', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'supacharger-doctor-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ dependencies: {} }));

  const checks = await inspect(root);
  assert.equal(checks.find((check) => check.name === 'Supabase custom access-token hook').ok, false);
  assert.equal(checks.find((check) => check.name === 'Custom claims migration').ok, false);
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
