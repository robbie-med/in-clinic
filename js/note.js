// The note, in the clinic's template (same rules as android/.../Note.kt; tools/test.mjs pins both to the same sample).
// Each section is copied on its own into the EMR's matching section, so the section titles are not part of the text:
//
//   Chief Complaint            fatigue
//   History of Present Illness 52F known to me presents for follow-up of fatigue.
//                              <HPI lines>
//   Physical Exam              General: No acute distress, ...   (examined systems only; nL + findings append)
//   Assessment/Plan            #Fatigue
//                              <supporting lines>
//
//                              DDx:
//                              >Iron deficiency anemia; most likely given ...
//
//                              - plan item
//
//                              F/u w Dr. X in 2 wk to review labs   (only when follow-up is filled in)
//   After Visit Summary        the handouts ($pi patient instructions) of the problems, then any added by hand
//   Signature                  <signature from settings> + the teaching-physician attestation for the billed level
//
// Each problem's status pills (not printed) drive the billing level (billing.js).
import { Library } from './library.js';
import { attestation, emptyData, isBranch, onPlan } from './billing.js';
import { Dot, unfilled } from './dot.js';

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
        oneLiner: '', hpi: [], hpiT: [], ros: {}, vitals: {}, exam: {}, problems: [], fuWith: '', fuWhen: '', fuWhy: [],
        data: emptyData(), risk: '', sdoh: null, code: '', copied: {}, copiedAt: 0, avs: [], avsEdits: {}, ...fields,
    };
}

export function newProblem(fields = {}) {
    return { id: uid(), name: '', lib: '', novelty: '', course: '', trend: '', noStatus: false, cx: '', notes: [], ddx: [], plan: [], avs: '', ...fields };
}

/**
 * Status pills for a problem being added, from its dotphrase's kind (p.kind) and the visit. Pills already set are kept.
 * Chronic: Known, or New at an establish-care / new-to-clinic visit. Acute kinds: New, Acute. A workup: Known at a
 * follow-up or lab visit, else New (an undiagnosed new problem). A problem with no dotphrase follows the visit type.
 */
export function withStatus(v, p) {
    if (p.noStatus || p.kind === 'none') return p;
    const kind = p.kind || (v.type === 'acute' ? 'acute' : 'chronic');
    const set = (novelty, course) => ({ ...p, novelty: p.novelty || novelty, course: p.course || course });
    if (kind === 'chronic') return set(v.relation === 'new to clinic' || v.type === 'establish' ? 'New' : 'Known', 'Chronic');
    if (kind === 'workup') return set(['follow-up', 'labs'].includes(v.type) ? 'Known' : 'New', '');
    return set('New', 'Acute');
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

/**
 * "#Fatigue", then the supporting lines, "DDx:" with one ">item; reasoning" line per item, and the "- " plan items,
 * with a blank line between those blocks (not after the header). The status pills aren't printed; they drive billing.
 * DDx group labels only sort the chips on screen.
 */
export function problemLines(p) {
    const clean = l => l.map(s => s.trim()).filter(Boolean);
    const ddx = clean(p.ddx.flatMap(g => g.items));
    // An "If DMPA:" branch header prints on its own between blank lines, and only while it still has lines under it.
    const plan = clean(onPlan(p)).filter((s, i, l) => !isBranch(s) || (l[i + 1] !== undefined && !isBranch(l[i + 1])));
    const planOut = plan.flatMap((s, i) => (isBranch(s) ? [...(i ? [''] : []), s, ''] : ['- ' + s]));
    const blocks = [clean(p.notes), ddx.length ? ['DDx:', ...ddx.map(s => '>' + s)] : [], planOut].filter(b => b.length);
    return ['#' + p.name.trim().replace(/^#+/, ''), ...blocks.flatMap((b, i) => (i ? ['', ...b] : b))];
}

/**
 * ✓ on plan line i: switches it on or off. On an "If ...:" header it switches the lines under it:
 * all off if any is on, else all on. The header itself prints only while a line under it is on.
 */
export function togglePlan(p, i) {
    const l = p.plan; const off = new Set(p.off || []);
    let j = i + 1;
    if (isBranch(l[i])) while (j < l.length && !isBranch(l[j])) j++;
    const group = isBranch(l[i]) ? l.slice(i + 1, j) : [l[i]];
    const turnOff = group.some(s => !off.has(s));
    group.forEach(s => (turnOff ? off.add(s) : off.delete(s)));
    return { ...p, off: [...off] };
}

// A typed reason that already starts with its own connector ("after OSU visit") doesn't get "to" in front.
const CONNECTOR = /^(to|after|for|before|once|when|if|in|at|with|w\/|re:?|;)(\s|$)/i;

/** "F/u w Dr. Richard in 2 mo to review labs and reassess symptoms". Nothing picked at all → "" (no line). */
export function followUp(v) {
    const why = v.fuWhy.map(s => s.trim().replace(/\.+$/, '')).filter(Boolean);
    const who = (v.fuWith || '').trim(); const when = v.fuWhen.trim();
    const out = ['F/u'];
    if (who) out.push('w ' + who);
    if (when) out.push(/^(prn|as needed)$/i.test(when) ? 'PRN' : 'in ' + when);
    if (why.length) out.push((CONNECTOR.test(why[0]) ? '' : 'to ') + join(why));
    return out.length === 1 ? '' : out.join(' ');
}

export const SECTIONS = [
    { key: 'cc', title: 'Chief Complaint', short: 'CC' },
    { key: 'hpi', title: 'History of Present Illness', short: 'HPI' },
    { key: 'exam', title: 'Physical Exam', short: 'Exam' },
    { key: 'ap', title: 'Assessment/Plan', short: 'A/P' },
    { key: 'avs', title: 'After Visit Summary', short: 'AVS' },
    { key: 'sign', title: 'Signature', short: 'Sign' },
];

/**
 * The After Visit Summary's handouts, once each: the problems' (in problem order), then the ones added by hand (v.avs).
 * [{abbr, title, text, from}]: text is this visit's edited copy if there is one; from is the problems that added it.
 */
export function avsHandouts(v) {
    const abbrs = [...new Set([...v.problems.map(p => p.avs), ...(v.avs || [])].filter(Boolean))];
    return abbrs.map(a => Dot.handout(a)).filter(Boolean).map(x => ({
        ...x, text: (v.avsEdits || {})[x.abbr] ?? x.text, from: v.problems.filter(p => p.avs === x.abbr).map(p => p.name),
    }));
}

/** EMR blank styles: Cerner's "_" or Epic's "***". The library and the app write ***; the app's setting picks one. */
export const EMRS = [{ key: 'cerner', label: 'Cerner', blank: '_' }, { key: 'epic', label: 'Epic', blank: '***' }];

/**
 * The note as separately copyable sections: [{key, title, short, text}]. Empty CC / exam / A/P / AVS are left out.
 * *** blanks print as `blank` (an EMR's style, see EMRS).
 */
export function sections(v, signature = '', blank = '***') {
    const text = {};
    if (v.cc.trim()) text.cc = v.cc.trim().replace(/\.+$/, '');
    text.hpi = [oneLiner(v), ...(v.relation === 'new to me' ? [RECORDS] : []), ...hpiLines(v)].join('\n');
    const vit = vitalsText(v); const exam = examLines(v);
    if (vit || exam.length) text.exam = [...(vit ? ['Vitals: ' + vit] : []), ...exam].join('\n');
    const fu = followUp(v);
    const ap = [...v.problems.map(p => problemLines(p).join('\n')), ...(fu ? [fu] : [])].join('\n\n');
    if (ap) text.ap = ap;
    const avs = avsHandouts(v).map(x => x.text.trim()).filter(Boolean).join('\n\n');
    if (avs) text.avs = avs;
    text.sign = [signature.trim(), attestation(v)].filter(Boolean).join('\n\n');
    return SECTIONS.filter(s => text[s.key] !== undefined).map(s => ({ ...s, text: plain(text[s.key]).replaceAll('***', blank) }));
}

// ------------------------------------------------------------ HPI dotphrases ($h)
// v.hpiT: the HPI dotphrases added (their lines went into v.hpi). v.ros: red-flag answers, { item: 'no' | 'yes' }.

/** A line an HPI dotphrase put in that you haven't touched yet: still has a blank or an unpicked list. Not printed. */
export const hpiUntouched = (v, line) => unfilled(line) && (v.hpiT || []).some(a => Dot.hpi(a)?.lines.includes(line));

/** The red flags to ask, from the HPI dotphrases added, then any answered ones no longer offered. */
export const rosItems = v => [...new Set([...(v.hpiT || []).flatMap(a => Dot.hpi(a)?.denies || []), ...Object.keys(v.ros || {})])];

/** "Reports chest pain. Denies fever, dyspnea." from the tapped red flags; '' if none. */
export function rosText(v) {
    const by = s => rosItems(v).filter(i => (v.ros || {})[i] === s);
    return [by('yes').length ? 'Reports ' + by('yes').join(', ') + '.' : '', by('no').length ? 'Denies ' + by('no').join(', ') + '.' : '']
        .filter(Boolean).join(' ');
}

/** The HPI as printed: lines, minus untouched dotphrase lines and headers ("Feeding history:") with nothing under them, then the red flags. */
export function hpiLines(v) {
    const kept = v.hpi.map(s => s.trim()).filter(s => s && !hpiUntouched(v, s));
    const head = s => /:$/.test(s) && (v.hpiT || []).some(a => Dot.hpi(a)?.lines.includes(s));
    const out = kept.filter((s, i) => !head(s) || (kept[i + 1] !== undefined && !head(kept[i + 1])));
    const ros = rosText(v);
    return ros ? [...out, ros] : out;
}

/** The whole note with section titles (for Share). The After Visit Summary is for the patient, so it's left out. */
export const render = (v, signature = '', blank = '***') => sections(v, signature, blank).filter(s => s.key !== 'avs').map(s => `${s.title}\n${s.text}`).join('\n\n');

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
 * Reads a previous note: every "#Problem" (or older "1. Problem") block after the Assessment/Plan header, or in
 * the whole paste when there's no header.
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
        if (!p || !s || s === '***') { if (!s) ddxOpen = false; continue; }
        if (word(s, NOVELTY) && !p.novelty) p = { ...p, novelty: word(s, NOVELTY) };
        else if (word(s, COURSE) && !p.course) p = { ...p, course: word(s, COURSE) };
        else if (word(s, TREND) && !p.trend) p = { ...p, trend: word(s, TREND) };
        else if (/^ddx/i.test(s)) {
            const rest = s.includes(':') ? s.slice(s.indexOf(':') + 1).trim() : '';
            if (rest) p = withDdx(p, '', [...ddxItems(p, ''), ...split(rest)]);
            ddxOpen = true;
        } else if (ddxOpen && s.startsWith('>')) {
            // ">Iron deficiency anemia; most likely given ..." is one item; older notes have ">Hormonal: a, b"
            const body = s.slice(1).trim();
            const c = body.indexOf(':');
            const group = !body.includes(';') && c > 0 && !body.slice(0, c).includes(',');
            const label = group ? body.slice(0, c).trim() : '';
            p = withDdx(p, label, [...ddxItems(p, label), ...(group ? split(body.slice(c + 1)) : [body])]);
        } else if (isBranch(s) && p.plan.length) {
            ddxOpen = false; p = { ...p, plan: [...p.plan, s] };
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
        const kind = Dot.find(lib ? lib.key : '', p.name)?.kind || '';
        return { ...p, lib: lib ? lib.key : '', noStatus: none, novelty: none ? '' : 'Known', trend: '', ...(kind ? { kind } : {}) };
    });
}
