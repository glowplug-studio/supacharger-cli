import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import englishCopy from '../messages/en.json';

const english = englishCopy.CoreDevelopmentCli;

interface CoreDevelopmentOptions { cwd?: string; repository?: string; branch?: string; environment?: NodeJS.ProcessEnv }
interface GitOptions { allowFailure?: boolean; environment?: NodeJS.ProcessEnv }
type CliError = Error & { code?: string; stderr?: string };
const exec = promisify(execFile);

const CHECKOUT_PATH = '.agents/supacharger/core-development';
const CHECKOUT_URL = 'git@github.com:glowplug-studio/supacharger-development-agents.md.git';
const CHECKOUT_BRANCH = 'main';

function message(key: keyof typeof english, values: Record<string, unknown> = {}) {
  const template = english[key];
  if (typeof template !== 'string' || !template.trim()) throw new Error(`Missing English CLI message: ${key}`);
  return template.replace(/\{(\w+)\}/g, (_, name) => String(values[name] ?? `{${name}}`));
}

function git(root: string, args: string[], options: GitOptions & { allowFailure: true }): Promise<string | null>;
function git(root: string, args: string[], options?: GitOptions & { allowFailure?: false }): Promise<string>;
async function git(root: string, args: string[], { allowFailure = false, environment = {} }: GitOptions = {}) {
  try {
    const result = await exec('git', args, {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 4 * 1024 * 1024,
      timeout: 60000,
      env: { ...process.env, ...environment, GIT_TERMINAL_PROMPT: '0' },
    });
    return result.stdout.trim();
  } catch (caught) {
    const error = caught as CliError;
    if (allowFailure) return null;
    const detail = String(error.stderr || error.message).trim();
    throw new Error(message('GitFailed', { detail }));
  }
}

async function stat(file: string) {
  try {
    return await fs.lstat(file);
  } catch (caught) {
    const error = caught as CliError;
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function projectRoot(cwd: string, environment: NodeJS.ProcessEnv) {
  const root = await git(path.resolve(cwd), ['rev-parse', '--show-toplevel'], { environment });
  if (!await stat(path.join(root, '.supacharger', 'managed-files.json'))) {
    throw new Error(message('NotSupachargerProject'));
  }
  return root;
}

async function ensureLocalExclude(root: string, environment: NodeJS.ProcessEnv) {
  const configuredPath = await git(root, ['rev-parse', '--git-path', 'info/exclude'], { environment });
  const excludePath = path.isAbsolute(configuredPath) ? configuredPath : path.resolve(root, configuredPath);
  const line = `/${CHECKOUT_PATH}/`;
  const existing = await fs.readFile(excludePath, 'utf8').catch((caught: unknown) => {
    const error = caught as CliError;
    if (error.code === 'ENOENT') return '';
    throw error;
  });
  if (existing.split(/\r?\n/).includes(line)) return;
  const separator = existing && !existing.endsWith('\n') ? '\n' : '';
  await fs.mkdir(path.dirname(excludePath), { recursive: true });
  await fs.appendFile(excludePath, `${separator}${line}\n`);
}

async function assertExpectedCheckout(root: string, repository: string, environment: NodeJS.ProcessEnv) {
  const destination = path.join(root, CHECKOUT_PATH);
  if (!await stat(destination)) throw new Error(message('NotInstalled'));
  const checkoutRoot = await git(destination, ['rev-parse', '--show-toplevel'], { allowFailure: true, environment });
  if (!checkoutRoot || path.resolve(checkoutRoot) !== path.resolve(destination)) throw new Error(message('DestinationExists'));
  const origin = await git(destination, ['remote', 'get-url', 'origin'], { allowFailure: true, environment });
  if (origin !== repository) throw new Error(message('ConflictingCheckout', { url: origin || '(missing)' }));
  return destination;
}

async function installCoreDevelopment({ cwd = process.cwd(), repository = CHECKOUT_URL, branch = CHECKOUT_BRANCH, environment = {} }: CoreDevelopmentOptions = {}) {
  const root = await projectRoot(cwd, environment);
  const destination = path.join(root, CHECKOUT_PATH);
  if (await stat(destination)) {
    await assertExpectedCheckout(root, repository, environment);
    await ensureLocalExclude(root, environment);
    const commit = await git(destination, ['rev-parse', 'HEAD'], { environment });
    return { action: 'existing', root, commit };
  }
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await git(root, ['clone', '--branch', branch, '--single-branch', '--', repository, CHECKOUT_PATH], { environment });
  await ensureLocalExclude(root, environment);
  const commit = await git(destination, ['rev-parse', 'HEAD'], { environment });
  return { action: 'installed', root, commit };
}

async function updateCoreDevelopment({ cwd = process.cwd(), repository = CHECKOUT_URL, branch = CHECKOUT_BRANCH, environment = {} }: CoreDevelopmentOptions = {}) {
  const root = await projectRoot(cwd, environment);
  const destination = await assertExpectedCheckout(root, repository, environment);
  const changes = await git(destination, ['status', '--porcelain'], { environment });
  if (changes) throw new Error(message('LocalChanges'));
  await git(destination, ['fetch', '--prune', 'origin', branch], { environment });
  await git(destination, ['checkout', branch], { environment });
  await git(destination, ['merge', '--ff-only', `origin/${branch}`], { environment });
  await ensureLocalExclude(root, environment);
  const commit = await git(destination, ['rev-parse', 'HEAD'], { environment });
  return { action: 'updated', root, commit };
}

async function runCoreDevelopment(operation: string, options: CoreDevelopmentOptions = {}) {
  const result = operation === 'install'
    ? await installCoreDevelopment(options)
    : await updateCoreDevelopment(options);
  const resultKey = result.action === 'installed' ? 'Installed' : result.action === 'existing' ? 'Existing' : 'Updated';
  console.log(message(resultKey, { commit: result.commit }));
  return result;
}

export { CHECKOUT_PATH, CHECKOUT_URL, installCoreDevelopment, updateCoreDevelopment, runCoreDevelopment };
