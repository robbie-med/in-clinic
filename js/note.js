// The note, in the user's format (same rules as android/.../Note.kt; tools/test.mjs pins both to the same sample):
//
//   41F known to me here for follow-up of fatigue.
//
//   <HPI lines>
//
//   PLAN
//
//   #Fatigue
//   New / Chronic / Worsening        (one per line; unpicked = ***, Epic's F2 wildcard)
//   <supporting lines>
//   DDx:
//   >Non-hormonal: OSA, ...
//
//   - plan item
//
//   Follow-up: 2 wk to review labs and confirm sleep study scheduled.
import { Library } from './library.js';

export const NOVELTY = ['New', 'Known'];
export const COURSE = ['Acute', 'Subacute', 'Chronic'];
export const TREND = ['Worsening', 'Stable', 'Improving', 'Resolved'];
export const RELATIONS = ['known to me', 'new to me', 'new to clinic'];

/** Visit type → chip label, one-liner with a chief complaint (%s), one-liner without. */
export const TYPES = [
    { key: 'follow-up', label: 'Follow-up', withCc: 'here for follow-up of %s', bare: 'here for follow-up' },
    { key: 'acute', label: 'Acute', withCc: 'here with %s', bare: 'here for an acute visit' },
    { key: 'hospital', label: 'Hospital f/u', withCc: 'here for hospital follow-up of %s', bare: 'here for hospital follow-up' },
    { key: 'ed', label: 'ED f/u', withCc: 'here for ED follow-up of %s', bare: 'here for ED follow-up' },
    { key: 'establish', label: 'Establish care', withCc: 'here to establish care and discuss %s', bare: 'here to establish care' },
    { key: 'annual', label: 'Annual', withCc: 'here for annual exam and %s', bare: 'here for annual exam' },
    { key: 'preop', label: 'Pre-op', withCc: 'here for pre-op evaluation before %s', bare: 'here for pre-op evaluation' },
    { key: 'labs', label: 'Lab review', withCc: 'here to review labs for %s', bare: 'here to review labs' },
];
export const type = key => TYPES.find(t => t.key === key);

export const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));

export function newVisit(fields = {}) {
    return {
        id: uid(), created: Date.now(), slot: '', age: '', sex: '', relation: 'known to me', type: 'follow-up', cc: '',
        oneLiner: '', hpi: [], problems: [], fuWhen: '', fuWhy: [], copiedAt: 0, ...fields,
    };
}

export function newProblem(fields = {}) {
    return { id: uid(), name: '', lib: '', novelty: '', course: '', trend: '', noStatus: false, notes: [], ddx: [], plan: [], ...fields };
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
    return [who, v.relation.trim(), here].filter(Boolean).join(' ') + '.';
}

export function problemLines(p) {
    const out = ['#' + p.name.trim()];
    if (!p.noStatus) for (const s of [p.novelty, p.course, p.trend]) out.push(s || '***');
    out.push(...p.notes.map(s => s.trim()).filter(Boolean));
    const groups = p.ddx.filter(g => g.items.length);
    if (groups.length === 1 && !groups[0].label) out.push('DDx: ' + groups[0].items.join(', '));
    else if (groups.length) {
        out.push('DDx:');
        for (const g of groups) out.push('>' + (g.label ? g.label + ': ' : '') + g.items.join(', '));
    }
    const plan = p.plan.map(s => s.trim()).filter(Boolean);
    if (plan.length) out.push('', ...plan.map(s => '- ' + s));
    return out;
}

export function followUp(v) {
    const why = v.fuWhy.map(s => s.trim().replace(/\.+$/, '')).filter(Boolean);
    const when = v.fuWhen.trim() || '***';
    return why.length ? `${when} to ${join(why)}` : when;
}

export function render(v) {
    const out = [oneLiner(v), ''];
    const hpi = v.hpi.map(s => s.trim()).filter(Boolean);
    if (hpi.length) out.push(...hpi, '');
    out.push('PLAN');
    for (const p of v.problems) out.push('', ...problemLines(p));
    out.push('', `Follow-up: ${followUp(v)}.`);
    return plain(out.join('\n'));
}

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
const WHO = /^(\d{1,3})\s?([FM])\b/;
const word = (s, set) => set.find(w => w.toLowerCase() === s.trim().toLowerCase());

/** Reads a previous note in this format: every "#Problem" block. A block ends at the next "#", "Follow-up:" or the end. */
export function parse(text) {
    const lines = text.replace(/\r/g, '').split('\n').map(l => l.replace(/\s+$/, ''));
    const first = (lines.find(l => l.trim()) || '').trim();
    const m = WHO.exec(first);
    const h = lines.findIndex(l => HEADER.test(l.trim()));
    const problems = [];
    let p = null; let ddxOpen = false;
    const close = () => { if (p) problems.push(p); p = null; ddxOpen = false; };
    for (const raw of lines.slice(h < 0 ? 0 : h + 1)) {
        const s = raw.trim();
        if (s.startsWith('#') && s.length > 1) { close(); p = newProblem({ name: s.slice(1).trim() }); continue; }
        if (/^follow-up/i.test(s) || /^f\/u:/i.test(s)) { close(); continue; }
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
