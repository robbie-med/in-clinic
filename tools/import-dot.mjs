#!/usr/bin/env node
// Copies the clinic problem blocks (#abbr) from the dotphrase library (~/Projects/dot) into dotphrases.json.
// Adding a problem fills its Notes and Plan from the matching block: the block's text lines become Notes
// and its "- " lines become Plan lines. Only the # problem blocks for clinic settings are copied; the rest
// of the library (OB, inpatient, patient instructions, the Cerner dump) stays in ~/Projects/dot.
//   node tools/import-dot.mjs [path/to/dot]     (default ../dot), then: node tools/version-sw.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const dot = path.resolve(root, process.argv[2] || '../dot');

/** library.json key → dotphrase abbreviation. Library problems without a clinic block are left out. */
const LIB = {
    htn: '#htn', dm2: '#dm2', prediabetes: '#prediab', hld: '#hld', hypothyroid: '#hypothy', ckd: '#ckd', obesity: '#obes',
    gerd: '#gerd', asthma: '#asthma', copd: '#copd', hf: '#chf', cad: '#cad', depression: '#dep', anxiety: '#anx',
    insomnia: '#insom', osa: '#osa', tobacco: '#tob', alcohol: '#aud', migraine: '#migraine', bph: '#bph',
    osteoporosis: '#osteop', gout: '#gout', rhinitis: '#rhinitis', oa: '#oa', anemia: '#anemia', fatigue: '#wufatigue',
    dyspnea: '#dyspnea', cough: '#wucough', uri: '#uri', abdpain: '#abdpain', dizziness: '#vertigo', headache: '#ha',
    wtloss: '#wuwtloss', lbp: '#lbp', numbness: '#wuneuro', uti: '#uti', hm: '#hm',
};

/** Minimal CSV reader (quoted fields, doubled quotes). */
function csv(text) {
    const rows = []; let row = []; let f = ''; let q = false;
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (q) { if (c === '"' && text[i + 1] === '"') { f += '"'; i++; } else if (c === '"') q = false; else f += c; }
        else if (c === '"') q = true;
        else if (c === ',') { row.push(f); f = ''; }
        else if (c === '\n') { row.push(f.replace(/\r$/, '')); rows.push(row); row = []; f = ''; }
        else f += c;
    }
    if (f || row.length) { row.push(f); rows.push(row); }
    const [head, ...body] = rows;
    return body.map(r => Object.fromEntries(head.map((k, i) => [k, r[i] ?? ''])));
}

const md = fs.readFileSync(path.join(dot, 'dotphrases.md'), 'utf8');
const index = new Map(csv(fs.readFileSync(path.join(dot, 'dotphrases_index.csv'), 'utf8')).map(r => [r.Abbreviation, r]));
const byLib = Object.fromEntries(Object.entries(LIB).map(([k, a]) => [a, k]));

const phrases = [];
for (const m of md.matchAll(/^### (#\w+) : (.+?)\n\n[\s\S]*?\n```\n([\s\S]*?)\n```/gm)) {
    const [, abbr, title, body] = m;
    const setting = index.get(abbr)?.Setting || '';
    if (!/^Clinic/.test(setting)) continue;
    const lines = body.split('\n').map(s => s.trim()).filter(Boolean);
    const name = (lines[0].startsWith('#') ? lines.shift() : '#' + title).slice(1).trim();
    const notes = []; const plan = [];
    for (const l of lines) (l.startsWith('- ') ? plan : notes).push(l.startsWith('- ') ? l.slice(2).trim() : l);
    phrases.push({ abbr, title, name, setting, ...(byLib[abbr] ? { lib: byLib[abbr] } : {}), notes, plan });
}

const missing = Object.values(LIB).filter(a => !phrases.some(p => p.abbr === a));
if (missing.length) { console.error('Mapped in LIB but not found as clinic blocks:', missing.join(', ')); process.exit(1); }

fs.writeFileSync(path.join(root, 'dotphrases.json'), JSON.stringify({
    source: 'Projects/dot/dotphrases.md (# problem blocks, clinic settings)', phrases,
}, null, 1) + '\n');
console.log(`dotphrases.json: ${phrases.length} problem blocks, ${phrases.filter(p => p.lib).length} mapped to library problems`);
