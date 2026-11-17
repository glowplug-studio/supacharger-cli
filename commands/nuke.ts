import fs from 'node:fs/promises';
import path from 'node:path';
import { parseEnv } from 'node:util';
import input from '@inquirer/input';

import english from '../messages/en.json';

const copy = english.NukeCli;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
interface NukeOptions { user: string; url?: string; confirm?: string }
type RecordValue = Record<string, unknown>;

function record(value: unknown): value is RecordValue {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function terminalText(value: string) { return value.replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, ''); }
function validString(value: unknown, maximum: number): value is string { return typeof value === 'string' && value.length > 0 && value.length <= maximum; }

export function nukeOrigin(value: string) {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error(copy.InvalidUrl); }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) || url.username || url.password || url.pathname !== '/' || url.search || url.hash)
    throw new Error(copy.InvalidUrl);
  return url.origin;
}

async function settings(options: NukeOptions) {
  let local: Record<string, string | undefined> = {};
  if (!(options.url || process.env.SUPACHARGER_APP_URL) || !process.env.ACCOUNT_DELETION_ADMIN_SECRET) {
    try { local = parseEnv(await fs.readFile(path.join(process.cwd(), '.env.local'), 'utf8')); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error(copy.EnvironmentUnreadable); }
  }
  const target = options.url || process.env.SUPACHARGER_APP_URL || local.SUPACHARGER_APP_URL;
  if (!target) throw new Error(copy.UrlRequired);
  const secret = process.env.ACCOUNT_DELETION_ADMIN_SECRET ?? local.ACCOUNT_DELETION_ADMIN_SECRET;
  if (!secret || secret.length < 32 || /[\r\n]/.test(secret)) throw new Error(copy.SecretRequired);
  return { origin: nukeOrigin(target), secret };
}

async function request(origin: string, secret: string, body: RecordValue) {
  let response: Response;
  try {
    response = await fetch(`${origin}/api/account/deletion/admin`, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(60000),
      headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch { throw new Error(copy.ConnectionFailed); }
  if (!response.ok) throw new Error(copy.RequestRejected.replace('{status}', String(response.status)));
  const text = await response.text();
  if (text.length > 65536) throw new Error(copy.InvalidResponse);
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new Error(copy.InvalidResponse); }
  if (!record(value) || value.ok !== true) throw new Error(copy.InvalidResponse);
  return value;
}

export async function runNuke(options: NukeOptions) {
  if (!uuidPattern.test(options.user)) throw new Error(copy.InvalidUser);
  const userId = options.user.toLowerCase();
  if (options.confirm !== undefined && options.confirm.toLowerCase() !== userId) throw new Error(copy.ConfirmationMismatch);
  if (options.confirm === undefined && !process.stdin.isTTY) throw new Error(copy.NonInteractive);
  const { origin, secret } = await settings(options);
  const result = await request(origin, secret, { action: 'preview', userId });
  const preview = result.preview;
  const target = result.target;
  if (!record(preview) || !record(target) || target.userId !== userId || !validString(target.projectRef, 255) || typeof target.namespace !== 'string'
    || !validString(preview.token, 4000) || !validString(preview.jobId, 36) || !uuidPattern.test(preview.jobId)
    || !validString(preview.summary, 4000) || !validString(preview.retention, 8000)
    || !Array.isArray(preview.blockers) || !preview.blockers.every(item => typeof item === 'string' && item.length <= 500))
    throw new Error(copy.InvalidResponse);
  console.log(copy.Target.replace('{origin}', origin).replace('{project}', terminalText(target.projectRef)).replace('{namespace}', terminalText(target.namespace || 'sc_')).replace('{user}', userId));
  console.log(copy.Policy.replace('{summary}', terminalText(preview.summary)));
  console.log(copy.Retention.replace('{retention}', terminalText(preview.retention)));
  if (preview.blockers.length) {
    console.log(copy.Blockers);
    for (const blocker of preview.blockers) console.log(`- ${terminalText(blocker)}`);
    throw new Error(copy.Blocked);
  }
  if (options.confirm === undefined) {
    const answer = await input({ message: `${copy.Confirmation.replace('{user}', userId)}\n` });
    if (answer.trim().toLowerCase() !== userId) throw new Error(copy.ConfirmationMismatch);
  }
  // Print only the reference, never the preview or private status capability.
  console.log(copy.JobReference.replace('{job}', preview.jobId));
  try {
    const accepted = await request(origin, secret, { action: 'confirm', userId, previewToken: preview.token, confirmation: userId });
    if (accepted.jobId !== preview.jobId) throw new Error(copy.InvalidResponse);
    console.log(copy.Accepted.replace('{job}', preview.jobId));
  } catch {
    // A timeout can occur after the server commits acceptance. Do not blindly resubmit.
    throw new Error(copy.OutcomeUnknown.replace('{job}', preview.jobId));
  }
}
