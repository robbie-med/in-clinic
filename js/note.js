// The note, in the clinic's template (same rules as android/.../Note.kt; tools/test.mjs pins both to the same sample).
// Each section is copied on its own into the EMR's matching section, so the section titles are not part of the text:
//
//   Chief Complaint            fatigue
//   History of Present Illness 52F known to me presents for follow-up of fatigue.
//                              <HPI lines>
//   Physical Exam              General: No acute distress, ...   (examined systems only; nL + findings append)
//   Assessment/Plan            1. Fatigue
//                              New / Chronic / Worsening        (one per line; unpicked = ***)
//                              <supporting lines>
//                              DDx: ...
//
//                              - plan item
//
//                              F/u w Dr. X in 2 wk to review labs
//   Signature                  <signature from settings> + the teaching-physician attestation for the billed level
//
// The status lines also drive the billing level (billing.js).
import { Library } from './library.js';
import { attestation, emptyData } from './billing.js';

export const NOVELTY = ['New', 'Known'];
export const COURSE = ['Acute', 'Subacute', 'Chronic'];
export const TREND = ['Worsening', 'Stable', 'Improving', 'Resolved'];
export const RELATIONS = ['known to me', 'new to me', 'new to clinic'];

/** Visit type → chip label, one-liner with a chief complaint (%s), one-liner without. */
export const TYPES = [
    { key: 'follow-up', label: 'Follow-up', withCc: 'presents for follow-up of %s', bare: 'presents for follow-up' },
    { key: 'acute', label: 'Acute', withCc: 'presents for %s', bare: 'presents for an acute visit' },
    { key: 'hospital', label: 'Hospital f/u', withCc: 'presents for hospital follow-up of %s', bare: 'presents for hospital follow-up' },
    { key: 'ed', label: 'ED f/u', withCc: 'presents for ED follow-up of %s', bare: 'presents for ED follow-up' },
    { key: 'establish', label: 'Establish care', withCc: 'presents to establish care and discuss %s', bare: 'presents to establish care' },
    { key: 'annual', label: 'Annual', withCc: 'presents for annual exam and %s', bare: 'presents for annual exam' },
    { key: 'preop', label: 'Pre-op', withCc: 'presents for pre-op evaluation before %s', bare: 'presents for pre-op evaluation' },
    { key: 'labs', label: 'Lab review', withCc: 'presents to review labs for %s', bare: 'presents to review labs' },
];
export const type = key => TYPES.find(t => t.key === key);

/** "New to me" prints this line under the one-liner instead of the words "new to me". */
export const RECORDS = 'This was my first time seeing this patient, but records were available for review and the patient is well-known to our clinic.';

export const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));

export function newVisit(fields = {}) {
    return {
        id: uid(), created: Date.now(), slot: '', age: '', sex: '', relation: 'known to me', type: 'follow-up', cc: '',
        oneLiner: '', hpi: [], vitals: {}, exam: {}, problems: [], fuWith: '', fuWhen: '', fuWhy: [],
        data: emptyData(), risk: '', sdoh: false, code: '', copied: {}, copiedAt: 0, ...fields,
    };
}

export function newProblem(fields = {}) {
    return { id: uid(), name: '', lib: '', novelty: '', course: '', trend: '', noStatus: false, cx: '', notes: [], ddx: [], plan: [], ...fields };
}

export const ddxItems = (p, label) => (p.ddx.find(g => g.label === label) || { items: [] }).items;

/** Sets one DDx group's items (empty removes the group), keeping group order. Returns a new problem. */
export function withDdx(p, label, items) {
    const rest = p.ddx.filter(g => g.label !== label);
    if (!items.length) return { ...p, ddx: rest };
    const i = p.ddx.findIndex(g => g.label === label);
    return { ...p, ddx: i < 0 ? [...p.ddx, { label, items }] : p.ddx.map(g => (g.label === label ? { label, items } : g)) };
}

/** Key for learned chips: the library entry, else the problem's own name. */
export const learnKey = p => p.lib || 'name:' + p.name.trim().toLowerCase();

/** "a", "a and b", "a, b and c". */
export function join(xs) {
    if (xs.length <= 1) return xs[0] || '';
    return xs.slice(0, -1).join(', ') + ' and ' + xs[xs.length - 1];
}

/** ASCII-safe so it pastes anywhere. */
export const plain = s => s.replace(/→/g, '->').replace(/≥/g, '>=').replace(/≤/g, '<=').replace(/°/g, '').replace(/[–—]/g, '-');

export function oneLiner(v) {
    if (v.oneLiner.trim()) return v.oneLiner.trim();
    const who = (v.age.trim() + v.sex.trim()) || '***';
    const t = type(v.type);
    const cc = v.cc.trim().replace(/\.+$/, '');
    let here;
    if (!t) here = cc ? 'here for ' + cc : 'here for ***';
    else if (!cc) here = t.bare;
    else here = t.withCc.replace('%s', cc);
    const rel = v.relation.trim() === 'new to me' ? '' : v.relation.trim();
    return [who, rel, here].filter(Boolean).join(' ') + '.';
}

/** "1. Fatigue", status lines (unpicked = ***), supporting lines, DDx, then a blank line and the "- " plan items. n is 1-based. */
export function problemLines(p, n = 1) {
    const out = [`${n}. ${p.name.trim()}`];
    if (!p.noStatus) for (const s of [p.novelty, p.course, p.trend]) out.push(s || '***');
    out.push(...p.notes.map(s => s.trim()).filter(Boolean));
    const groups = p.ddx.filter(g => g.items.length);
    if (groups.length === 1 && !groups[0].label) out.push('DDx: ' + groups[0].items.join(', '));
    else if (groups.length) {
        out.push('DDx:');
        for (const g of groups) out.push('>' + (g.label ? g.label + ': ' : '') + g.items.join(', '));
    }
    const plan = p.plan.map(s => s.trim()).filter(Boolean);
    if (plan.length) out.push(...(out.length > 1 ? [''] : []), ...plan.map(s => '- ' + s));
    return out;
}

// A typed reason that already starts with its own connector ("after OSU visit") doesn't get "to" in front.
const CONNECTOR = /^(to|after|for|before|once|when|if|in|at|with|w\/|re:?|;)(\s|$)/i;

/** "F/u w Dr. Richard in 2 mo to review labs and reassess symptoms". Nothing picked at all → "F/u ***". */
export function followUp(v) {
    const why = v.fuWhy.map(s => s.trim().replace(/\.+$/, '')).filter(Boolean);
    const who = (v.fuWith || '').trim(); const when = v.fuWhen.trim();
    const out = ['F/u'];
    if (who) out.push('w ' + who);
    if (when) out.push(/^(prn|as needed)$/i.test(when) ? 'PRN' : 'in ' + when);
    if (why.length) out.push((CONNECTOR.test(why[0]) ? '' : 'to ') + join(why));
    if (out.length === 1) out.push('***');
    return out.join(' ');
}

export const SECTIONS = [
    { key: 'cc', title: 'Chief Complaint', short: 'CC' },
    { key: 'hpi', title: 'History of Present Illness', short: 'HPI' },
    { key: 'exam', title: 'Physical Exam', short: 'Exam' },
    { key: 'ap', title: 'Assessment/Plan', short: 'A/P' },
    { key: 'sign', title: 'Signature', short: 'Sign' },
];

/** The note as separately copyable sections: [{key, title, short, text}]. Empty CC / exam are left out. */
export function sections(v, signature = '') {
    const text = {};
    if (v.cc.trim()) text.cc = v.cc.trim().replace(/\.+$/, '');
    text.hpi = [oneLiner(v), ...(v.relation === 'new to me' ? [RECORDS] : []), ...v.hpi.map(s => s.trim()).filter(Boolean)].join('\n');
    const vit = vitalsText(v); const exam = examLines(v);
    if (vit || exam.length) text.exam = [...(vit ? ['Vitals: ' + vit] : []), ...exam].join('\n');
    const ap = [];
    v.problems.forEach((p, i) => { ap.push(...(i ? [''] : []), ...problemLines(p, i + 1)); });
    ap.push(...(ap.length ? [''] : []), followUp(v));
    text.ap = ap.join('\n');
    text.sign = [signature.trim(), attestation(v)].filter(Boolean).join('\n\n');
    return SECTIONS.filter(s => text[s.key] !== undefined).map(s => ({ ...s, text: plain(text[s.key]) }));
}

/** The whole note with section titles (for Share). */
export const render = (v, signature = '') => sections(v, signature).map(s => `${s.title}\n${s.text}`).join('\n\n');

// ------------------------------------------------------------ physical exam (from the On-Call app)
// Vitals fields, then per system nL (one tap) or abnL findings. Systems / findings live in library.json.

export const NL = 'nL';

const setExam = (v, system, picks) => {
    const exam = { ...(v.exam || {}) };
    if (picks.length) exam[system] = picks; else delete exam[system];
    return { ...v, exam };
};

/** nL and each finding toggle on their own. nL plus findings prints the normal text with the findings appended. */
export function examToggle(v, system, item) {
    const cur = (v.exam || {})[system] || [];
    const next = cur.includes(item) ? cur.filter(x => x !== item) : item === NL ? [NL, ...cur] : [...cur, item];
    return setExam(v, system, next);
}

/** Every system not yet examined → nL (optional systems such as GU only when examined). */
export const examAllNormal = v => Library.data.exam.reduce((acc, s) =>
    (s.optional || (acc.exam || {})[s.name]?.length ? acc : setExam(acc, s.name, [NL])), v);

export const examLines = v => Library.data.exam.flatMap(s => {
    const p = (v.exam || {})[s.name] || [];
    const found = p.filter(x => x !== NL);
    if (!p.length) return [];
    return [`${s.name}: ` + (p.includes(NL) ? [s.normal, ...found].join(', ') : join(found))];
});

export const vitalsText = v => Library.data.vitals.map(k => [k, ((v.vitals || {})[k] || '').trim()]).filter(([, x]) => x).map(([k, x]) => `${k} ${x}`).join(', ');

export const withVital = (v, k, value) => {
    const vitals = { ...(v.vitals || {}) };
    if (value.trim()) vitals[k] = value.trim(); else delete vitals[k];
    return { ...v, vitals };
};

// ------------------------------------------------------------ carry forward

/** Splits on commas outside parentheses: "topiramate effect (fatigue, mood change), OSA" → 2 items. */
export function split(s) {
    const out = []; let cur = ''; let depth = 0;
    for (const ch of s) {
        if (ch === '(') { depth++; cur += ch; }
        else if (ch === ')') { depth = Math.max(0, depth - 1); cur += ch; }
        else if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; }
        else cur += ch;
    }
    out.push(cur.trim());
    return out.filter(Boolean);
}

const HEADER = /^(PLAN|A\/?P|ASSESSMENT( AND|\/| & )PLAN)\s*:?$/i;
const NUMBERED = /^\d{1,2}[.)]\s+(\S.*)$/;
const SIGNED = /^By the addition of|^[A-Z][A-Za-z.' -]+, (MD|DO|NP|PA|PA-C|APRN|FNP)\b/;
const WHO = /^(\d{1,3})\s?([FM])\b/;
const word = (s, set) => set.find(w => w.toLowerCase() === s.trim().toLowerCase());

/**
 * Reads a previous note: every "1. Problem" (or older "#Problem") block after the Assessment/Plan header.
 * A block ends at the next problem, an "F/u" / "Follow-up" line, or the signature.
 */
export function parse(text) {
    const lines = text.replace(/\r/g, '').split('\n').map(l => l.replace(/\s+$/, ''));
    const m = lines.map(l => WHO.exec(l.trim())).find(Boolean);
    const h = lines.findIndex(l => HEADER.test(l.trim()));
    const problems = [];
    let p = null; let ddxOpen = false;
    const close = () => { if (p) problems.push(p); p = null; ddxOpen = false; };
    for (const raw of lines.slice(h < 0 ? 0 : h + 1)) {
        const s = raw.trim();
        if (SIGNED.test(s)) break;
        if (s.startsWith('#') && s.length > 1) { close(); p = newProblem({ name: s.slice(1).trim() }); continue; }
        if (NUMBERED.test(s)) { close(); p = newProblem({ name: NUMBERED.exec(s)[1].trim() }); continue; }
        if (/^follow-up/i.test(s) || /^f\/u\b/i.test(s)) { close(); continue; }
        if (!p || !s || s === '***') continue;
        if (word(s, NOVELTY) && !p.novelty) p = { ...p, novelty: word(s, NOVELTY) };
        else if (word(s, COURSE) && !p.course) p = { ...p, course: word(s, COURSE) };
        else if (word(s, TREND) && !p.trend) p = { ...p, trend: word(s, TREND) };
        else if (/^ddx/i.test(s)) {
            const rest = s.includes(':') ? s.slice(s.indexOf(':') + 1).trim() : '';
            if (rest) p = withDdx(p, '', [...ddxItems(p, ''), ...split(rest)]);
            ddxOpen = true;
        } else if (ddxOpen && s.startsWith('>')) {
            const body = s.slice(1).trim();
            const c = body.indexOf(':');
            const label = c >= 0 ? body.slice(0, c).trim() : '';
            p = withDdx(p, label, [...ddxItems(p, label), ...split(c >= 0 ? body.slice(c + 1) : body)]);
        } else if (s.startsWith('- ') || s.startsWith('• ') || (s.startsWith('-') && !s.startsWith('--'))) {
            ddxOpen = false; p = { ...p, plan: [...p.plan, s.replace(/^[-• ]+/, '')] };
        } else { ddxOpen = false; p = { ...p, notes: [...p.notes, s] }; }
    }
    close();
    return { age: m ? m[1] : '', sex: m ? m[2] : '', problems };
}

/** Last visit's problems for today: Known, trend cleared (needs today's assessment), library chips reattached. */
export function carryForward(ps) {
    return ps.map(p => {
        const lib = Library.match(p.name);
        const none = lib ? !!lib.noStatus : false;
        return { ...p, lib: lib ? lib.key : '', noStatus: none, novelty: none ? '' : 'Known', trend: '' };
    });
}
