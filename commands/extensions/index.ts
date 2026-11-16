import fs from 'node:fs/promises';
import type { Command } from 'commander' with { 'resolution-mode': 'import' };
import { createInterface } from 'node:readline/promises';
import path from 'node:path';

import { safePath } from './installer.cjs';
import { runExtension, reportExtensionDoctor, normaliseId, type ExtensionOptions } from './update.cjs';
import { loadExtensionRegistry, REGISTRY_MANIFEST_URL, versionPattern } from './registry.cjs';
import messages from '../../messages/en.json';
const copy = messages.ExtensionsCli;
const DEFAULT_EXTENSION = 'supacharger-ext-transactional-email';

function extensionName(name: string) {
  return process.stdout.isTTY && !process.env.NO_COLOR
    ? `\x1b[93m${name}\x1b[0m`
    : name;
}

function installedLabel() {
  return process.stdout.isTTY && !process.env.NO_COLOR
    ? `\x1b[32m${copy.Installed}\x1b[0m`
    : copy.Installed;
}

async function installedExtensionsImpl(root: string, names: string[]) {
  const installed = new Set<string>();
  await Promise.all(names.map(async name => {
    const id = normaliseId(name);
    const base = `src/app/(project)/(extensions)/(sc_extensions)/(${id})`;
    const files = [`${base}/index.ts`, `${base}/${name}.config.ts`,
      `docs/extensions/${id}/INSTALL.md`, `docs/agents/extensions/${name}/AGENTS.md`];
    try {
      const states = await Promise.all(files.map(async file => (await fs.stat(await safePath(root, file))).isFile()));
      if (states.every(Boolean)) installed.add(name);
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') throw error;
    }
  }));
  return installed;
}

async function askAvailableExtension(names: string[]) {
  const readline = createInterface({ input: process.stdin, output: process.stdout });
  try { return (await readline.question(`\n${copy.InstallQuestion}\n`)).trim(); }
  finally { readline.close(); }
}

async function selectAvailableExtensionsImpl({ root = process.cwd(), registry = REGISTRY_MANIFEST_URL } = {}) {
  const { entries } = await loadExtensionRegistry(registry);
  const names = [...entries.keys()].filter(name => name === DEFAULT_EXTENSION);
  const installed = await installedExtensionsImpl(path.resolve(root), names);
  const { default: checkbox } = await import('@inquirer/checkbox');
  const selected = await checkbox({
    message: `${copy.InitialisePrompt}\n`,
    choices: names.map(name => ({
      name: `${extensionName(name)}${installed.has(name) ? ` ${installedLabel()}` : ''}`,
      value: name,
      checked: name === DEFAULT_EXTENSION,
    })),
    required: false,
  });
  for (const name of selected) {
    const result = await runExtension('install', name, { root, registry });
    console.log(copy.InitialiseInstalled.replace('{name}', name).replace('{guide}', result.guide));
  }
  return selected;
}

function registerExtensions(program: Command) {
  const extension = program.command('extension').description(copy.Description + '. ' + copy.Downloads);
  extension.command('available').alias('list').description(copy.Available)
    .option('--registry <location>', copy.Registry, REGISTRY_MANIFEST_URL).option('--root <path>', copy.Root)
    .action(async (options: ExtensionOptions) => {
      const { entries } = await loadExtensionRegistry(options.registry);
      const names = [...entries.keys()];
      const root = path.resolve(options.root || process.cwd());
      const installed = await installedExtensionsImpl(root, names);
      names.forEach((name, index) => {
        console.log(`[${index + 1}] ${extensionName(name)}${installed.has(name) ? ` ${installedLabel()}` : ''}`);
      });
      if (!process.stdin.isTTY || !process.stdout.isTTY || names.length === 0) return;

      const answer = await askAvailableExtension(names);
      if (!answer || /^n(?:o)?$/i.test(answer)) return;
      if (!/^\d+$/.test(answer) || Number(answer) < 1 || Number(answer) > names.length) {
        throw new Error(copy.InvalidSelection);
      }
      const name = names[Number(answer) - 1];
      if (installed.has(name)) {
        console.log(copy.AlreadyInstalled.replace('{name}', name));
        return;
      }
      const descriptor = entries.get(name);
      if (!versionPattern.test(descriptor!.version) || !/^[a-f0-9]{40}$/.test(descriptor!.source_commit)) {
        console.log(copy.NotPublished.replace('{name}', name));
        return;
      }
      console.log(JSON.stringify(await runExtension('install', name, { root, registry: options.registry }), null, 2));
    });
  for (const action of ['install', 'update']) {
    extension.command(`${action} <name>`).description(copy[action === 'install' ? 'Install' : 'Update'])
      .option('--source <path>', copy.Source)
      .option('--registry <location>', copy.Registry, REGISTRY_MANIFEST_URL)
      .option('--root <path>', copy.Root).option('--plan', copy.Plan)
      .action(async (name: string, options: ExtensionOptions) => {
        const result = await runExtension(action, name, options);
        console.log(JSON.stringify(result, null, 2));
      });
  }
  extension.command('doctor <name>').description(copy.Doctor).option('--root <path>', copy.Root)
    .option('--source <path>', copy.Source)
    .option('--registry <location>', copy.Registry, REGISTRY_MANIFEST_URL)
    .action(async (name: string, options: ExtensionOptions) => {
      await reportExtensionDoctor(name, options);
    });
}

namespace registerExtensions {
  export const selectAvailableExtensions = selectAvailableExtensionsImpl;
  export const installedExtensions = installedExtensionsImpl;
}
export = registerExtensions;
