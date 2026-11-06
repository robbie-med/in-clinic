#!/usr/bin/env node
// Copies the clinic problem blocks (#abbr) from the dotphrase library (~/Projects/dot) into dotphrases.json, plus the
// named "#Problem" block in the Assessment and plan of the clinic visit notes ($wcc2m → "#Well child, 2 months"), so
// preventive visits can be added as problems too. Those have no status pills (they aren't MDM problems).
// Adding a problem fills it from the matching block: text lines become Notes, the ">item; reasoning" lines under
// "DDx:" become DDx items, and "- " lines become Plan lines. Only the # problem blocks for clinic settings are copied; the rest
// of the library (OB, inpatient, the Cerner dump) stays in ~/Projects/dot.
// The clinic $pi patient-instruction blocks are copied too, as "handouts" for the After Visit Summary. A problem block
// is paired with its handout by name ($pihtn ↔ #htn) or by PAIR below; adding the problem adds the handout.
// This repo is public. Clinic and personal phone numbers are listed only in the private library
// (build/clinic_phones.json); they're written here as {{label}} and the app fills them from Clinic phone numbers on the
// device. The import fails if any other local number, or IHI / In His Image / Sikora, would be published.
// The Tulsa counseling lists (.edtulsacounsel, .edtulsafaith) come along as "resources" for the mental health problems.
//   node tools/import-dot.mjs [path/to/dot]     (default ../dot), then: node tools/version-sw.mjs
// --private writes dotphrases.private.json instead: nothing scrubbed, gitignored, for a copy served on your own PC
// (the app prefers it when it exists; the public site never has it).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PRIV = process.argv.includes('--private');
const dot = path.resolve(root, process.argv.slice(2).find(a => !a.startsWith('--')) || '../dot');

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

/** Local numbers that are fine to publish (public health, crisis lines, community clinics); toll-free numbers always are. */
const PUBLIC = new Set(('405-426-8710 770-488-7100 918-710-4200 918-744-4800 918-921-3200 918-382-7300 918-392-4008 918-400-0571 918-491-3700 '
    + '918-492-2554 918-496-9588 918-517-8024 918-587-9471 918-594-8568 918-631-3342 918-745-0095 918-949-4673').split(' '));
const PHONE = /\(?\b(\d{3})\)?[-. ](\d{3})[-. ](\d{4})\b/g;
const TOLL_FREE = /^8(00|33|44|55|66|77|88)$/;
const IDENTIFYING = /\b(IHI|In His Image|Sikora)\b/;

/** Counseling resource lists, and the problems that show them. */
const RESOURCES = ['.edtulsacounsel', '.edtulsafaith'];
const RESOURCES_FOR = 'dep anx panic ptsd bipolar grief eatdis'.split(' ');

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

const PRIVATE = PRIV ? {} : JSON.parse(fs.readFileSync(path.join(dot, 'build', 'clinic_phones.json'), 'utf8'));   // fails without it: never import unscrubbed
delete PRIVATE._about;
const md = Object.entries(PRIVATE).reduce((s, [n, label]) => s.split(n).join(`{{${label}}}`), fs.readFileSync(path.join(dot, 'dotphrases.md'), 'utf8').replace(/\r\n/g, '\n'));
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

// Resources: physician-only lists, without their "not for the chart" first line
const resources = RESOURCES.map(abbr => {
    const b = [...md.matchAll(/^### (\.\w+) : (.+?)\n\n[\s\S]*?\n```\n([\s\S]*?)\n```/gm)].find(m => m[1] === abbr);
    if (!b) { console.error('Resource not found:', abbr); process.exit(1); }
    const text = b[3].replace(/^Physician reference, not for the chart\..*\n+/, '').trim();
    return { abbr, title: b[2], text: text.startsWith(b[2] + '\n') ? text.slice(b[2].length).trim() : text };   // title is shown above it
});
for (const p of phrases) if (RESOURCES_FOR.includes(p.abbr.slice(1))) p.res = RESOURCES;
const unknownRes = RESOURCES_FOR.filter(a => !phrases.some(p => p.abbr === '#' + a));
if (unknownRes.length) { console.error('RESOURCES_FOR names not found as clinic blocks:', unknownRes.join(', ')); process.exit(1); }

// HPIs: the clinic $h blocks, one sentence (or "- " bullet) per line, for the HPI's line list. The "***F here for" opener
// is cut (the one-liner says who and why; an opener with nothing left to fill is dropped), and the "Denies a, b, c."
// red-flag sentence becomes tappable items (denies / reports / not asked) instead of a line.
const hpis = [];
for (const [, abbr, title, body] of blocks.filter(m => m[1].startsWith('$h'))) {
    const row = index.get(abbr);
    if (row?.['Prefix group'] !== '$h' || !/^Clinic/.test(row.Setting)) continue;
    const lines = []; const denies = [];
    for (const raw of body.split('\n').map(s => s.trim()).filter(Boolean)) {
        for (let s of raw.startsWith('- ') ? [raw] : raw.split(/(?<=(?<!\bDr)\.)\s+(?=[A-Z*_])/)) {
            if (s === title) continue;   // "$heads" repeats its title as its first line
            if (/^Denies [^*_]+\.$/.test(s)) { denies.push(...s.slice(7, -1).split(/,\s*/).map(x => x.replace(/^(and|or) /, '').trim()).filter(Boolean)); continue; }
            if (!lines.length && !hpis.some(x => x.abbr === abbr)) {
                const o = s.replace(/^\*\*\*\s?(?:yo\s)?(?:\*\*\*|[FM])?\s?(?:yo\s)?here /, '');
                if (o !== s) {
                    s = o.startsWith('for ') ? o[4].toUpperCase() + o.slice(5) : 'Here ' + o;
                    if (!s.includes('***') && !s.includes(' _')) continue;   // "Hypertension follow-up.": the one-liner says it
                }
            }
            lines.push(s);
        }
    }
    hpis.push({ abbr, title: title.replace(/ HPI$/, ''), lines, ...(denies.length ? { denies } : {}) });
}
/** Problem block → its HPI, where "#x" ↔ "$hx" doesn't pair them. */
const HPI_PAIR = {
    '#dm2': '$hdm', '#hypothy': '$hthy', '#wucough': '$hcough', '#wufatigue': '$hfatigue', '#wuedema': '$hedema', '#uti': '$hdysuria',
    '#dep': '$hmood', '#anx': '$hmood', '#abdpain': '$habd', '#dyspnea': '$hsob', '#vertigo': '$hdizzy', '#polyarth': '$hjoint',
    '#wuneuro': '$hnumb', '#wuwtloss': '$hwt', '#osa': '$hsnore', '#pharyn': '$hthroat', '#aom': '$heark',
};
const hasHpi = new Set(hpis.map(x => x.abbr));
const badHpi = Object.entries(HPI_PAIR).filter(([a, x]) => !phrases.some(p => p.abbr === a) || !hasHpi.has(x));
if (badHpi.length) { console.error('HPI_PAIR entries not found:', badHpi.map(e => e.join(' → ')).join(', ')); process.exit(1); }
for (const p of phrases) {
    const x = HPI_PAIR[p.abbr] || (p.abbr.startsWith('#') && hasHpi.has('$h' + p.abbr.slice(1)) ? '$h' + p.abbr.slice(1) : '');
    if (x) p.hpi = x;
}

const body = { source: 'Projects/dot/dotphrases.md (# problem blocks, $h HPIs and $pi handouts, clinic settings)', phrases, hpis, handouts, resources };
body.phones = [...new Set(Object.values(PRIVATE))].filter(l => JSON.stringify(body).includes(`{{${l}}}`));
const out = JSON.stringify(body, null, 1) + '\n';
const leaks = [...out.matchAll(PHONE)].filter(m => !TOLL_FREE.test(m[1]) && !PUBLIC.has(`${m[1]}-${m[2]}-${m[3]}`)).map(m => m[0]);
if (!PRIV && (leaks.length || IDENTIFYING.test(out))) {
    console.error('Not written: would publish', [...new Set(leaks)].join(', ') || out.match(IDENTIFYING)[0],
        '\nAdd clinic numbers to build/clinic_phones.json in the library, public ones to PUBLIC here.');
    process.exit(1);
}
const file = PRIV ? 'dotphrases.private.json' : 'dotphrases.json';
fs.writeFileSync(path.join(root, file), out);
console.log(`${file}: ${phrases.length} problem blocks (${phrases.filter(p => p.abbr.startsWith('$')).length} from visit notes), ${phrases.filter(p => p.lib).length} mapped to library problems; `
    + `${hpis.length} HPIs, ${phrases.filter(p => p.hpi).length} problems with one; ${handouts.length} handouts, ${phrases.filter(p => p.pi).length} problems with one; ${resources.length} resource lists; phone labels: ${body.phones.join(', ') || 'none'}`);
