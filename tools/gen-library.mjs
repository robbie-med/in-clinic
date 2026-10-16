#!/usr/bin/env node
// library.json is the one source of the problem library. The web app fetches it; this script writes the
// Android copy (LibraryData.kt) from it.
//   node tools/gen-library.mjs          rewrite LibraryData.kt
//   node tools/gen-library.mjs --check  exit 1 if LibraryData.kt is out of date (run before committing)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const lib = JSON.parse(fs.readFileSync(path.join(root, 'library.json'), 'utf8'));
const out = path.join(root, 'android/app/src/main/java/org/robbiemed/clinic/LibraryData.kt');

const q = s => JSON.stringify(s).replace(/\$/g, '\\$');
const list = a => `listOf(${(a || []).map(q).join(', ')})`;

const problems = lib.problems.map(p => {
    const f = [`${q(p.key)}`, `${q(p.name)}`, `aliases = ${list(p.aliases)}`];
    if (p.novelty) f.push(`novelty = ${q(p.novelty)}`);
    if (p.course) f.push(`course = ${q(p.course)}`);
    if (p.noStatus) f.push('noStatus = true');
    for (const k of ['hpi', 'notes', 'plan', 'fu']) if (p[k]?.length) f.push(`${k} = ${list(p[k])}`);
    if (p.ddx?.length) f.push(`ddx = listOf(${p.ddx.map(d => `Ddx(${q(d.label)}, ${list(d.items)})`).join(', ')})`);
    return `        Lib(${f.join(', ')}),`;
}).join('\n');

const kt = `package org.robbiemed.clinic

// GENERATED from library.json by tools/gen-library.mjs. Edit library.json, then run the script.

internal object LibraryData {
    val medVerbs = ${list(lib.medVerbs)}
    val hpiGeneric = ${list(lib.hpiGeneric)}
    val fuWhen = ${list(lib.fuWhen)}
    val fuGeneric = ${list(lib.fuGeneric)}
    val vitals = ${list(lib.vitals)}
    val exam = listOf(
${lib.exam.map(x => `        ExamSystem(${q(x.name)}, ${q(x.normal)}, ${list(x.abnormal)}),`).join('\n')}
    )
    val problems = listOf(
${problems}
    )
}
`;

if (process.argv.includes('--check')) {
    const cur = fs.existsSync(out) ? fs.readFileSync(out, 'utf8') : '';
    if (cur !== kt) { console.error('LibraryData.kt is stale. Run: node tools/gen-library.mjs'); process.exit(1); }
    console.log('LibraryData.kt is current');
} else {
    fs.writeFileSync(out, kt);
    console.log(`Wrote ${path.relative(root, out)} (${lib.problems.length} problems)`);
}
