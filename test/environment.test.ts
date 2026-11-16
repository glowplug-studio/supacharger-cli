import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  type Prompts,
  type CommandRunner,
  configureLocalSupabase,
  promptEnvironmentValues,
  selectSupabaseTargets,
} from '../commands/environment';

test('offers local and Cloud Supabase as independent checkbox choices', async () => {
  let question: Parameters<NonNullable<Prompts['checkbox']>>[0] | undefined;
  const selection = await selectSupabaseTargets({
    checkbox: async (options) => {
      question = options;
      return ['local', 'cloud'];
    },
  });
  assert.deepEqual(selection, ['local', 'cloud']);
  assert.ok(question);
  assert.deepEqual(question.choices.map(choice => choice.value), ['local', 'cloud']);
  assert.match(question.message, /Space selects/);
});

test('local-only selection does not request Cloud credentials', async () => {
  const inputs = ['http://localhost:3000', ''];
  const values = await promptEnvironmentValues({
    confirm: async () => false,
    input: async () => inputs.shift()!,
    password: async () => { throw new Error('Cloud credential prompt was not expected'); },
  }, 'SC_IMAGE_UPLOAD_SIGNING_SECRET', ['local']);
  assert.equal(values.NEXT_PUBLIC_SUPABASE_URL, undefined);
  assert.equal(values.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, undefined);
  assert.equal(values.NEXT_PUBLIC_SITE_URL, 'http://localhost:3000');
});

test('Cloud selection collects the hosted public connection values', async () => {
  const inputs = ['https://example.supabase.co', 'http://localhost:3000', ''];
  const passwords = ['sb_publishable_example'];
  const values = await promptEnvironmentValues({
    confirm: async () => false,
    input: async () => inputs.shift()!,
    password: async () => passwords.shift()!,
  }, 'SC_IMAGE_UPLOAD_SIGNING_SECRET', ['cloud']);
  assert.equal(values.NEXT_PUBLIC_SUPABASE_URL, 'https://example.supabase.co');
  assert.equal(values.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, 'sb_publishable_example');
});

test('local setup starts Supabase, applies migrations and writes development overrides', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'supacharger-local-supabase-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const calls: string[][] = [];
  const run: CommandRunner = async (_command, args) => {
    calls.push(args);
    if (args.includes('status')) {
      return {
        stdout: JSON.stringify({
          env: {
            API_URL: 'http://127.0.0.1:54321',
            PUBLISHABLE_KEY: 'sb_publishable_local',
            SECRET_KEY: 'sb_secret_local',
          },
        }),
        stderr: '',
      };
    }
    return { stdout: '', stderr: '' };
  };
  const result = await configureLocalSupabase(root, {
    dependenciesInstalled: true,
    run,
    supabaseTargets: ['local', 'cloud'],
  });
  assert.equal(result.configured, true);
  assert.deepEqual(calls[0], ['--no-install', 'supabase', 'start']);
  assert.deepEqual(calls[1], ['--no-install', 'supabase', 'db', 'push']);
  const contents = await fs.readFile(path.join(root, '.env.development.local'), 'utf8');
  assert.match(contents, /^NEXT_PUBLIC_SUPABASE_URL=http:\/\/127\.0\.0\.1:54321$/m);
  assert.match(contents, /^NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_local$/m);
  assert.match(contents, /^SUPABASE_BILLING_SECRET_KEY=sb_secret_local$/m);
});
