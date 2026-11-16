import fs from 'node:fs/promises';
import path from 'node:path';
import AdmZip from 'adm-zip';

function safeArchivePath(entryName: string, rootName: string) {
  if (!entryName || entryName.includes('\\') || entryName.includes('\0') || entryName.startsWith('/')) {
    throw new Error('Source ZIP contains an unsafe path');
  }
  const parts = entryName.replace(/\/$/, '').split('/');
  if (parts.some(part => !part || part === '.' || part === '..') || parts[0] !== rootName) {
    throw new Error('Source ZIP contains an unsafe path');
  }
  return parts.slice(1).join('/');
}

async function extractSourceZip(archiveBytes: Buffer, targetDir: string) {
  const archive = new AdmZip(archiveBytes);
  const entries = archive.getEntries();
  if (entries.length === 0 || entries.length > 25_000) throw new Error('Source ZIP has an invalid file count');
  const firstParts = entries.map(entry => entry.entryName.replace(/\/$/, '').split('/')[0]).filter(Boolean);
  const rootName = firstParts[0];
  if (!rootName || firstParts.some(name => name !== rootName)) throw new Error('Source ZIP must contain one root directory');

  const seen = new Set();
  let extractedBytes = 0;
  await fs.mkdir(targetDir, { recursive: true });
  for (const entry of entries) {
    const relativePath = safeArchivePath(entry.entryName, rootName);
    if (!relativePath) continue;
    const key = relativePath.toLowerCase();
    if (seen.has(key)) throw new Error(`Source ZIP contains a duplicate path: ${relativePath}`);
    seen.add(key);

    const mode = (entry.header.attr >>> 16) & 0xffff;
    if ((mode & 0o170000) === 0o120000) throw new Error(`Source ZIP contains a symbolic link: ${relativePath}`);
    const destination = path.resolve(targetDir, relativePath);
    if (destination !== targetDir && !destination.startsWith(`${targetDir}${path.sep}`)) throw new Error('Source ZIP path escapes its target');
    if (entry.isDirectory) {
      await fs.mkdir(destination, { recursive: true });
      continue;
    }

    const bytes = entry.getData();
    extractedBytes += bytes.length;
    if (extractedBytes > 512 * 1024 * 1024) throw new Error('Source ZIP expands beyond the supported size');
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(destination, bytes, { mode: mode & 0o111 ? 0o755 : 0o644 });
  }
}

export { extractSourceZip };
