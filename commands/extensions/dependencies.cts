import fs from 'node:fs/promises';
import path from 'node:path';
import type { ExtensionManifest, ReleaseVerification } from './registry.cjs';
import { safePath } from './installer.cjs';
import { readConfig } from './config.cjs';
async function checkDependencies(root: string, release: Pick<ReleaseVerification, "entries">, incoming: { source: string; manifest: ExtensionManifest }) {
  const entries = release.entries ?? new Map();
  const checked = new Set<string>();
  async function check(name: string, chain: string[] = []): Promise<void> {
    if (!/^supacharger-ext-[a-z][a-z0-9-]{0,63}$/.test(name)) throw new Error('Invalid dependency');
    if (chain.includes(name)) throw new Error('Cyclic extension dependency');
    if (checked.has(name)) return;
    const id = name.slice(16), base = `src/app/(project)/(extensions)/(sc_extensions)/(${id})`;
    await fs.access(await safePath(root, `${base}/index.ts`));
    if (!readConfig(await safePath(root, `${base}/supacharger-ext-${id}.config.ts`)).enabled) throw new Error(`Required extension ${name} is disabled`);
    for (const child of entries.get(name)?.dependencies ?? []) await check(child, [...chain, name]);
    checked.add(name);
  }
  for (const name of incoming.manifest.dependencies ?? []) await check(name);
  for (const rule of Object.values(incoming.manifest.provider_dependencies ?? {})) {
    const file = incoming.manifest.files.find(file => file.kind === 'config');
    if (!file) throw new Error('Provider selection needs configuration');
    const installed = await safePath(root, file.target);
    const config = await fs.access(installed).then(() => readConfig(installed), async (error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
      return readConfig(await safePath(incoming.source, file.source));
    });
    const selected = config[rule.config_key] ?? rule.default;
    if (!Object.hasOwn(rule.providers, selected as string)) throw new Error('Unsupported provider');
    for (const name of rule.providers[selected as string]) await check(name);
  }
  if (incoming.manifest.core_services?.length) {
    (require(path.join(root, 'src/supacharger/extensions/services.cjs')) as { resolveCoreServices(root: string, services: string[]): unknown }).resolveCoreServices(root, incoming.manifest.core_services);
  }
  return [...checked];
}
export { checkDependencies };
