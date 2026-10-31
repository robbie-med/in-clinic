#!/usr/bin/env node
// Copies the clinic problem blocks (#abbr) from the dotphrase library (~/Projects/dot) into dotphrases.json, plus the
// named "#Problem" block in the Assessment and plan of the clinic visit notes ($wcc2m → "#Well child, 2 months"), so
// preventive visits can be added as problems too. Those have no status pills (they aren't MDM problems).
// Adding a problem fills it from the matching block: text lines become Notes, the ">item; reasoning" lines under
// "DDx:" become DDx items, and "- " lines become Plan lines. Only the # problem blocks for clinic settings are copied; the rest
// of the library (OB, inpatient, the Cerner dump) stays in ~/Projects/dot.
// The clinic $pi patient-instruction blocks are copied too, as "handouts" for the After Visit Summary. A problem block
// is paired with its handout by name ($pihtn ↔ #htn) or by PAIR below; adding the problem adds the handout.
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
    wtloss: '#wuwtloss', lbp: '#lbp', numbness: '#wuneuro', uti: '#uti', hm: '#hm', palpitations: '#palp', edema: '#wuedema',
    rash: '#rash', jointpain: '#polyarth',
};

/** Problem block → handout, where the names don't pair by themselves. */
const PAIR = {
    '#dm2': '$pidm', '#pharyn': '$pithroat', '#gastro': '$pigi', '#bv': '$pivag', '#vvc': '$piyeast', '#aom': '$pieark',
    '#osteop': '$piosteo', '#hsvgen': '$pihsv', '#zoster': '$pishingles', '#cap': '$pipneumo', '#wuedema': '$piedema',
    '#thynod': '$pinodule', '#wuthynod': '$pinodule', '#endomet': '$piendo', '#wuinfert': '$piinfert', '#alopecia': '$pihair',
    '#ed': '$pisexm', '#fsd': '$pisexf', '#tendinopathy': '$pitendon', '#varicella': '$pichickenpox', '#statinint': '$pistatin',
    '#cpod': '$piopioid', '#wuobesk': '$piobesk', '#wubruise': '$pibruise', '#hypok': '$pihighk',
};

/**
 * What kind of problem a block is, for billing (js/billing.js autoCx): adding the problem sets its status pills from it.
 * threat: threat to life or bodily function · systemic: acute illness with systemic symptoms · acute · minor (self-limited)
 * workup: undiagnosed new problem (#wu… blocks, symptoms) · none: counseling / preventive, not an MDM problem ·
 * everything else is chronic.
 */
const KIND = {
    threat: 'dissection stemi nstemi pe meningitis thystorm myxedema htnemerg appy ahrf cholangitis stroke tia hepenceph rhabdo ams goo vt chb ssnhl padpain acidosis sicklecell',
    systemic: 'cap pid pidx divert divertx cdiff panc pertussis measles mumps mastoid febinf mono tick dvt hypercax',
    acute: 'sinus pharyn aom bronch fall angioedema covid covidx flu fever hypogly hypok hypomg abdpainx nv gastro contactderm otext zoster bv '
        + 'bronchio conj bite hfmd bell vvc epidid prostatitis stone croup abscess paronychia varicella utik uti uri rash lbp recluse ome '
        + 'tubeotorrhea tmperf impetigo scabies asb type2mi thyroiditis knee ankle hip neck elbow hand',
    minor: 'cerumen lice pinworm molluscum roseola fifth hsvlab warts skintear hematoma earfb',
    workup: 'jaundice dysphagia weakness breast nipdc seizurenew tremor dysgeusia devscreen abdpain ha palp vertigo dyspnea polyarth',
    none: 'precon nfp travel',
};
const kindOf = abbr => {
    const a = abbr.slice(1);
    const k = Object.keys(KIND).find(k => KIND[k].split(' ').includes(a));
    return k || (/^wu/.test(a) && !['wuobesk', 'wufrail', 'wuinsom'].includes(a) ? 'workup' : 'chronic');
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

/** Extra search words for visit-note blocks, by abbreviation prefix. */
const ALIASES = { $wcc: ['wcc', 'well child', 'well child check', 'wcv', 'well visit', 'well baby', 'checkup', 'physical'] };

/** Block lines → { notes, ddx, plan }: "- " lines are plan, ">" lines under "DDx:" are DDx items, the rest notes.
 *  An "If DMPA:" branch header goes into the plan, in place, ahead of the lines it groups. */
function split(lines) {
    const notes = []; const ddx = []; const plan = [];
    for (const l of lines) {
        if (l.startsWith('- ')) plan.push(l.slice(2).trim());
        else if (/^If\b.*:$/.test(l)) plan.push(l);
        else if (l.startsWith('>') && !l.startsWith('>>')) ddx.push(l.slice(1).trim());
        else if (!/^DDx:?$/i.test(l)) notes.push(l);
    }
    return { notes, ddx, plan };
}

const phrases = [];
const blocks = [...md.matchAll(/^### ([#$]\w+) : (.+?)\n\n[\s\S]*?\n```\n([\s\S]*?)\n```/gm)];
for (const [, abbr, title, body] of blocks.filter(m => m[1].startsWith('#'))) {
    const setting = index.get(abbr)?.Setting || '';
    if (!/^Clinic/.test(setting)) continue;
    const lines = body.split('\n').map(s => s.trim()).filter(Boolean);
    const name = (lines[0].startsWith('#') ? lines.shift() : '#' + title).slice(1).trim();
    phrases.push({ abbr, title, name, setting, kind: kindOf(abbr), ...(byLib[abbr] ? { lib: byLib[abbr] } : {}), ...split(lines) });
}

// Visit notes: the first named block of the A&P, up to the next "#" header or the F/u line. Skipped: placeholders
// ("#***"), empty blocks, and names a # block already has (e.g. $adhd's "#ADHD"). Two visit notes may share a name
// ("Adolescent well visit, *** years" for 11-14 and 15-17); the picker adds the one you tap.
const named = new Set(phrases.map(p => p.name.toLowerCase()));
for (const [, abbr, title, body] of blocks.filter(m => m[1].startsWith('$'))) {
    const setting = index.get(abbr)?.Setting || '';
    if (!/^Clinic/.test(setting)) continue;
    const lines = body.split('\n').map(s => s.trim());
    const ap = lines.findIndex(l => /^(assessment and plan|a&p)\s*:?$/i.test(l));
    const at = ap < 0 ? -1 : lines.findIndex((l, i) => i > ap && l.startsWith('#'));
    if (at < 0) continue;
    const name = lines[at].slice(1).trim();
    if (!name || name.startsWith('***') || /^deferred/i.test(name) || named.has(name.toLowerCase())) continue;
    const end = lines.findIndex((l, i) => i > at && (l.startsWith('#') || /^f\/u\b/i.test(l)));
    const aliases = Object.entries(ALIASES).filter(([k]) => abbr.startsWith(k)).flatMap(([, a]) => a);
    const parts = split(lines.slice(at + 1, end < 0 ? undefined : end).filter(Boolean));
    if (!parts.notes.length && !parts.plan.length && !parts.ddx.length) continue;
    phrases.push({ abbr, title, name, setting, noStatus: true, ...(aliases.length ? { aliases } : {}), ...parts });
}

// Handouts: the clinic $pi blocks, text as written (the first line is the handout's title).
const handouts = [];
for (const [, abbr, title, body] of blocks.filter(m => m[1].startsWith('$pi'))) {
    const row = index.get(abbr);
    if (row?.['Prefix group'] !== '$pi' || !/^Clinic/.test(row.Setting)) continue;
    handouts.push({ abbr, title, text: body.split('\n').map(l => l.trimEnd()).join('\n').trim() });
}
const hasHandout = new Set(handouts.map(x => x.abbr));
const badPair = Object.entries(PAIR).filter(([a, pi]) => !phrases.some(p => p.abbr === a) || !hasHandout.has(pi));
if (badPair.length) { console.error('PAIR entries not found:', badPair.map(e => e.join(' → ')).join(', ')); process.exit(1); }
for (const p of phrases) {
    const pi = PAIR[p.abbr] || (p.abbr.startsWith('#') && hasHandout.has('$pi' + p.abbr.slice(1)) ? '$pi' + p.abbr.slice(1) : '');
    if (pi) p.pi = pi;
}

const unknownKind = Object.values(KIND).flatMap(l => l.split(' ')).filter(a => !phrases.some(p => p.abbr === '#' + a));
if (unknownKind.length) { console.error('KIND names not found as clinic blocks:', unknownKind.join(', ')); process.exit(1); }

const missing = Object.values(LIB).filter(a => !phrases.some(p => p.abbr === a));
if (missing.length) { console.error('Mapped in LIB but not found as clinic blocks:', missing.join(', ')); process.exit(1); }

fs.writeFileSync(path.join(root, 'dotphrases.json'), JSON.stringify({
    source: 'Projects/dot/dotphrases.md (# problem blocks and $pi handouts, clinic settings)', phrases, handouts,
}, null, 1) + '\n');
console.log(`dotphrases.json: ${phrases.length} problem blocks (${phrases.filter(p => p.abbr.startsWith('$')).length} from visit notes), ${phrases.filter(p => p.lib).length} mapped to library problems; `
    + `${handouts.length} handouts, ${phrases.filter(p => p.pi).length} problems with one`);
