const fs = require('node:fs/promises');
const path = require('node:path');

function isTestScript(name, command) {
  return /(^|:)test($|:)/.test(name) || name === 'check:bruno-rpcs' ||
    /(?:^|\s)--test(?:\s|$)|\b(?:vitest|jest|mocha|ava)\b|\b(?:supabase|deno|playwright)\s+test\b/.test(command);
}

function cleanScripts(scripts = {}) {
  return Object.fromEntries(Object.entries(scripts).filter(([name, command]) => !isTestScript(name, command)));
}

// Applied only to a newly cloned starter. Existing application files are never swept.
async function prepareStarter(root) {
  async function walk(directory, relative = '') {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const rel = path.join(relative, entry.name);
      const file = path.join(directory, entry.name);
      if (entry.isSymbolicLink() || entry.name === '.git' || entry.name === 'node_modules' || rel === path.join('.agents', 'skills')) continue;
      if (/^(?:test|tests|__tests__|fixtures|__fixtures__|coverage|test-results|playwright-report)$/.test(entry.name) ||
          /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(entry.name) || entry.name === 'check-bruno-rpc-parity.mjs') {
        await fs.rm(file, { recursive: true, force: true });
      } else if (entry.isDirectory()) {
        await walk(file, rel);
      } else if (entry.name === 'package.json') {
        const original = await fs.readFile(file, 'utf8');
        const pkg = JSON.parse(original);
        if (pkg.scripts) {
          const scripts = cleanScripts(pkg.scripts);
          if (JSON.stringify(scripts) !== JSON.stringify(pkg.scripts)) {
            pkg.scripts = scripts;
            await fs.writeFile(file, `${JSON.stringify(pkg, null, 2)}\n`);
          }
        }
      }
    }
  }
  await walk(root);
  const ignorePath = path.join(root, '.gitignore');
  try {
    const source = await fs.readFile(ignorePath, 'utf8');
    // This marked block applies only to the upstream Core repository.
    const cleaned = source.replace(/^# BEGIN SUPACHARGER CORE-ONLY SKILLS\r?\n[\s\S]*?^# END SUPACHARGER CORE-ONLY SKILLS(?:\r?\n|$)/m, '');
    if (cleaned !== source) await fs.writeFile(ignorePath, cleaned);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

module.exports = { cleanScripts, isTestScript, prepareStarter };
