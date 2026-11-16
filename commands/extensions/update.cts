import { install, doctor, safePath, validateManifest } from './installer.cjs';
import { verifyRelease, withDownloadedRelease, type ExtensionManifest, type ReleaseVerification } from './registry.cjs';
import { checkDependencies } from './dependencies.cjs';
import fs from 'node:fs/promises';
import messages from '../../messages/en.json';
export interface ExtensionOptions { root?: string; source?: string; registry?: string; plan?: boolean }
function normaliseId(name: string) { return name.startsWith('supacharger-ext-') ? name.slice(16) : name; }
export type ExtensionResult = (Awaited<ReturnType<typeof install>> | Awaited<ReturnType<typeof doctor>>) & { registryRegistered: boolean; registryVerified: boolean };
type DoctorResult = Awaited<ReturnType<typeof doctor>> & { registryRegistered: boolean; registryVerified: boolean };
type InstallResult = Awaited<ReturnType<typeof install>> & { registryRegistered: boolean; registryVerified: boolean };
function runExtension(action: 'doctor', name: string, options?: ExtensionOptions): Promise<DoctorResult>;
function runExtension(action: 'install' | 'update', name: string, options?: ExtensionOptions): Promise<InstallResult>;
function runExtension(action: string, name: string, options?: ExtensionOptions): Promise<ExtensionResult>;
async function runExtension(action: string, name: string, options: ExtensionOptions = {}) {
  if (!['install', 'update', 'doctor'].includes(action)) throw new Error('Invalid extension action');
  const id = normaliseId(name), root = await fs.realpath(options.root || process.cwd());
  async function apply(source: string, manifest: ExtensionManifest, release: ReleaseVerification) {
    if (action !== 'doctor') await checkDependencies(root, release, { source, manifest });
    const result = await (action === 'doctor' ? doctor : install)(id, { ...options, root, source });
    return { ...result, registryRegistered: release.registered ?? release.verified, registryVerified: release.verified };
  }
  if (!options.source) return withDownloadedRelease(`supacharger-ext-${id}`, options.registry, apply);
  const source = await fs.realpath(options.source);
  const manifest = JSON.parse(await fs.readFile(await safePath(source, 'extension.json'), 'utf8')) as ExtensionManifest;
  validateManifest(manifest, id);
  const release = await verifyRelease(source, manifest, options.registry);
  return apply(source, manifest, release);
}
async function reportExtensionDoctor(name: string, options: ExtensionOptions = {}) {
  const result = await runExtension('doctor', name, options);
  const copy = messages.ExtensionsCli;
  console.log((result.matchesSource ? copy.DoctorMatched : copy.DoctorDifferences).replace('{name}', name));
  for (const file of result.differences) console.log(`  ${file}`);
  console.log(copy.DoctorScope);
  if (!result.matchesSource) process.exitCode = 1;
  return result;
}
export { runExtension, normaliseId, reportExtensionDoctor };
