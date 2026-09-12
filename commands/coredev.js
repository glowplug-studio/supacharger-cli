const fs = require('node:fs/promises');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const { printGitHubDevelopmentWarning } = require('./common/github-development-warning');

const english = require('../messages/en.json').CoreDevelopmentCli;
const exec = promisify(execFile);

const SUBMODULE_PATH = '.agents/supacharger/core-development';
const SUBMODULE_URL = 'git@github.com:glowplug-studio/supacharger-development-agents.md.git';
const SUBMODULE_BRANCH = 'main';

function message(key, values = {}) {
  const template = english[key];
  if (typeof template !== 'string' || !template.trim()) throw new Error(`Missing English CLI message: ${key}`);
  return template.replace(/\{(\w+)\}/g, (_, name) => String(values[name] ?? `{${name}}`));
}

async function git(root, args, { allowFailure = false, environment = {} } = {}) {
  try {
    const result = await exec('git', args, {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 4 * 1024 * 1024,
      timeout: 60000,
      env: { ...process.env, ...environment, GIT_TERMINAL_PROMPT: '0' },
    });
    return result.stdout.trim();
  } catch (error) {
    if (allowFailure) return null;
    const detail = String(error.stderr || error.message).trim();
    throw new Error(message('GitFailed', { detail }));
  }
}

async function stat(file) {
  try { return await fs.lstat(file); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

async function projectRoot(cwd, environment) {
  const root = await git(path.resolve(cwd), ['rev-parse', '--show-toplevel'], { environment });
  if (!await stat(path.join(root, '.supacharger', 'managed-files.json'))) {
    throw new Error(message('NotSupachargerProject'));
  }
  return root;
}

async function registration(root, environment) {
  if (!await stat(path.join(root, '.gitmodules'))) return null;
  const output = await git(root, ['config', '--file', '.gitmodules', '--get-regexp', '^submodule\\..*\\.path$'], { allowFailure: true, environment });
  const matches = String(output || '').split('\n').filter(Boolean).map((line) => {
    const separator = line.indexOf(' ');
    const key = line.slice(0, separator);
    return { name: key.slice('submodule.'.length, -'.path'.length), path: line.slice(separator + 1) };
  }).filter((entry) => entry.path === SUBMODULE_PATH);
  if (matches.length > 1) throw new Error(message('DuplicateRegistration'));
  if (!matches.length) return null;
  const entry = matches[0];
  entry.url = await git(root, ['config', '--file', '.gitmodules', '--get', `submodule.${entry.name}.url`], { allowFailure: true, environment });
  return entry;
}

function assertExpectedRegistration(entry, repository) {
  if (entry.url !== repository) throw new Error(message('ConflictingRegistration', { url: entry.url || '(missing)' }));
}

async function installCoreDevelopment({ cwd = process.cwd(), repository = SUBMODULE_URL, branch = SUBMODULE_BRANCH, environment = {} } = {}) {
  const root = await projectRoot(cwd, environment);
  const entry = await registration(root, environment);
  if (entry) {
    assertExpectedRegistration(entry, repository);
    if (repository.includes('github.com')) printGitHubDevelopmentWarning();
    await git(root, ['submodule', 'update', '--init', '--recursive', '--', SUBMODULE_PATH], { environment });
    const commit = await git(root, ['-C', SUBMODULE_PATH, 'rev-parse', 'HEAD'], { environment });
    return { action: 'initialised', root, commit };
  }
  if (await stat(path.join(root, SUBMODULE_PATH))) throw new Error(message('DestinationExists'));
  if (repository.includes('github.com')) printGitHubDevelopmentWarning();
  await git(root, ['submodule', 'add', '--branch', branch, '--', repository, SUBMODULE_PATH], { environment });
  const commit = await git(root, ['-C', SUBMODULE_PATH, 'rev-parse', 'HEAD'], { environment });
  return { action: 'installed', root, commit };
}

async function updateCoreDevelopment({ cwd = process.cwd(), repository = SUBMODULE_URL, environment = {} } = {}) {
  const root = await projectRoot(cwd, environment);
  const entry = await registration(root, environment);
  if (!entry) throw new Error(message('NotInstalled'));
  assertExpectedRegistration(entry, repository);
  if (repository.includes('github.com')) printGitHubDevelopmentWarning();
  await git(root, ['submodule', 'update', '--init', '--recursive', '--', SUBMODULE_PATH], { environment });
  const changes = await git(root, ['-C', SUBMODULE_PATH, 'status', '--porcelain'], { environment });
  if (changes) throw new Error(message('LocalChanges'));
  await git(root, ['submodule', 'update', '--remote', '--checkout', '--recursive', '--', SUBMODULE_PATH], { environment });
  const commit = await git(root, ['-C', SUBMODULE_PATH, 'rev-parse', 'HEAD'], { environment });
  return { action: 'updated', root, commit };
}

async function runCoreDevelopment(operation, options = {}) {
  const result = operation === 'install'
    ? await installCoreDevelopment(options)
    : await updateCoreDevelopment(options);
  const resultKey = result.action === 'installed' ? 'Installed' : result.action === 'initialised' ? 'Initialised' : 'Updated';
  console.log(message(resultKey, { commit: result.commit }));
  return result;
}

module.exports = { SUBMODULE_PATH, SUBMODULE_URL, installCoreDevelopment, updateCoreDevelopment, runCoreDevelopment };
