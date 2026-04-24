// Packages dist/ into a Chrome-Web-Store-ready zip. Run after `npm run build`.
// Uses archiver so paths use forward slashes (PowerShell's Compress-Archive on
// Windows PS 5.1 emits backslashes, which is against the zip spec and can
// confuse strict validators).

import archiver from 'archiver';
import { createWriteStream, existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const distDir = resolve('dist');
if (!existsSync(distDir)) {
  console.error('dist/ not found — run `npm run build` first.');
  process.exit(1);
}

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const outPath = resolve(`cryptarch-ext-v${pkg.version}.zip`);

const output = createWriteStream(outPath);
const archive = archiver('zip', { zlib: { level: 9 } });

output.on('close', () => {
  console.log(`wrote ${outPath} (${archive.pointer()} bytes)`);
});
archive.on('error', (err) => {
  throw err;
});
archive.on('warning', (err) => {
  if (err.code !== 'ENOENT') throw err;
  console.warn('warning:', err);
});

archive.pipe(output);
archive.directory(distDir, false); // false = zip contents, not the dist/ folder itself
await archive.finalize();
