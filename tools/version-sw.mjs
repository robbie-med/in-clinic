#!/usr/bin/env node
// Stamp sw.js with a hash of every file it caches, so installed copies update whenever anything changes.
// (Adapted from Koreancards/tools/version-sw.js.)
//   node tools/version-sw.mjs          write the new VERSION into sw.js
//   node tools/version-sw.mjs --check  exit 1 if sw.js is stale (run before committing)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const swPath = path.join(root, 'sw.js');
const sw = fs.readFileSync(swPath, 'utf8');
const shell = [...sw.matchAll(/^\s*'\.\/([^']*)',$/gm)].map(m => m[1] || 'index.html');

const missing = shell.filter(f => !fs.existsSync(path.join(root, f)));
if (missing.length) { console.error('sw.js caches files that do not exist:', missing.join(', ')); process.exit(1); }
const hash = crypto.createHash('sha256');
for (const f of [...new Set(shell)].sort()) hash.update(f).update(fs.readFileSync(path.join(root, f)));
const version = hash.digest('hex').slice(0, 12);
const current = (sw.match(/const VERSION = '([^']*)'/) || [])[1];

if (process.argv.includes('--check')) {
    if (current !== version) { console.error(`sw.js VERSION is stale (${current} != ${version}). Run: node tools/version-sw.mjs`); process.exit(1); }
    console.log(`sw.js VERSION ${version} is current`);
} else {
    fs.writeFileSync(swPath, sw.replace(/const VERSION = '[^']*'/, `const VERSION = '${version}'`));
    console.log(`sw.js VERSION ${current} -> ${version}`);
}
