// Dotphrase problem blocks (dotphrases.json, copied from ~/Projects/dot by tools/import-dot.mjs).
// Adding a problem fills its Notes and Plan from its block. A library problem uses the block mapped to its key;
// any other name uses a block whose name, title or #abbreviation matches. Blocks with no library problem
// are offered in the problem picker too.
// Handouts are the library's $pi patient instructions, for the After Visit Summary. A block's "pi" names its handout.
// Clinic phone numbers are "{{Central Referral Center}}" in dotphrases.json (the repo is public); load() fills them from
// the numbers saved on this device (Clinic phone numbers), or leaves a *** blank. Resources are physician-only lists.
import { isBranch } from './billing.js';

export const Dot = {
    phrases: [],
    handouts: [],
    hpis: [],
    resources: [],
    phoneLabels: [],

    load(data, phones = {}) {
        this.raw = data;
        this.phoneLabels = data?.phones || [];
        const num = l => String(phones[l] || '').replace(/[^\d()+. x-]/g, '').trim();
        data = data && JSON.parse(JSON.stringify(data).replace(/\{\{([^{}"\\]+)\}\}/g, (_, l) => num(l) || '***'));
        this.resources = data?.resources || [];
        this.phrases = data?.phrases || [];
        this.byLib = new Map(this.phrases.filter(p => p.lib).map(p => [p.lib, p]));
        this.handouts = data?.handouts || [];
        this.hpis = data?.hpis || [];
        this.byPi = new Map(this.handouts.map(x => [x.abbr, x]));
    },

    /** Resource lists (Tulsa counseling) for a problem's block, [] if none. */
    resourcesFor(block) { return (block?.res || []).map(a => this.resources.find(r => r.abbr === a)).filter(Boolean); },

    /** A handout by abbreviation ("$pihtn"), or null. */
    handout(abbr) { return this.byPi?.get(abbr) || null; },

    /** Handouts whose title or abbreviation contains every word of the query, by title; all of them for an empty query. */
    searchHandouts(q) {
        const words = q.trim().toLowerCase().replace(/^[#$]/, '').split(/[\s,]+/).filter(Boolean);
        const hay = x => (x.title + ' | ' + x.abbr.slice(1) + ' | ' + x.abbr.slice(3)).toLowerCase();
        return this.handouts.filter(x => words.every(w => hay(x).includes(w))).sort((a, b) => a.title.localeCompare(b.title));
    },

    /** An HPI dotphrase by abbreviation ("$hcough"), or null. */
    hpi(abbr) { return this.hpis.find(x => x.abbr === abbr) || null; },

    /** HPIs whose title or abbreviation contains every word of the query; all of them for an empty query. */
    searchHpis(q) {
        const words = q.trim().toLowerCase().replace(/^\$h?/, '').split(/[\s,]+/).filter(Boolean);
        const hay = x => (x.title + ' | ' + x.abbr.slice(2)).toLowerCase();
        return this.hpis.filter(x => words.every(w => hay(x).includes(w))).sort((a, b) => a.title.localeCompare(b.title));
    },

    /**
     * HPIs to offer for a visit: the problems' (their block's "hpi"), then ones the chief complaint names
     * ("sore throat" → Sore throat, "dizzy" → Dizziness, "sob" → $hsob). Pediatric ($h…k) ones under 18 only, and
     * under 18 they replace their adult version.
     */
    suggestHpis(cc = '', blocks = [], age = '') {
        const kid = String(age).trim() !== '' && +age < 18;
        const fits = x => (x.abbr.endsWith('k') ? kid : !(kid && this.hpi(x.abbr + 'k')));
        const words = s => s.toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length >= 3 && !HPI_STOP.has(w));
        const same = (a, b) => (a.length >= 4 && b.length >= 4 ? a.slice(0, 4) === b.slice(0, 4) : a === b);
        const ws = words(cc);
        const named = this.hpis.filter(x => ws.some(w => w === x.abbr.slice(2).replace(/k$/, '') || words(x.title).some(t => same(w, t))));
        return [...new Set([...blocks.map(b => this.hpi(b?.hpi)).filter(Boolean), ...named])].filter(fits);
    },

    /** The block for a library key, else an exact name / title / abbreviation match. */
    find(lib, name = '') {
        if (lib && this.byLib?.has(lib)) return this.byLib.get(lib);
        const n = name.trim().toLowerCase().replace(/^[#$]/, '');
        if (!n) return null;
        return this.phrases.find(p => p.name.toLowerCase() === n || p.title.toLowerCase() === n || p.abbr.slice(1) === n) || null;
    },

    /** Blocks without a library problem whose name, title, abbreviation or aliases contain every word of the query (exact, then prefix matches first). */
    search(q) {
        const n = q.trim().toLowerCase().replace(/^[#$]/, '');
        const free = this.phrases.filter(p => !p.lib);
        if (!n) return [];
        const hay = p => [p.name.toLowerCase(), p.title.toLowerCase(), p.abbr.slice(1), ...(p.aliases || [])];
        const words = n.split(/[\s,]+/).filter(Boolean);   // every word somewhere: "well child 15" → Well child, 15 to 17 years
        const hit = p => { const all = hay(p).join(' | '); return words.every(w => all.includes(w)); };
        const rank = p => (hay(p).slice(0, 3).includes(n) ? 0 : hay(p).some(s => s.startsWith(n)) ? 1 : 2);   // exact, prefix, the rest
        return free.filter(hit).sort((a, b) => rank(a) - rank(b));
    },

    /** The problem with the block's lines added to its Notes, DDx (unlabelled group) and Plan; lines it already has are skipped.
     *  The block's handout goes into the After Visit Summary (p.avs); its kind (acute, chronic, workup…) drives billing. */
    fill(p, block) {
        if (!block) return p;
        const add = (have, more = []) => [...have, ...more.filter(l => !have.includes(l))];
        const items = (block.ddx || []).filter(d => !p.ddx.some(g => g.items.includes(d)));
        const ddx = !items.length ? p.ddx : p.ddx.some(g => g.label === '')
            ? p.ddx.map(g => (g.label === '' ? { ...g, items: [...g.items, ...items] } : g)) : [...p.ddx, { label: '', items }];
        const notes = add(p.notes, block.notes); const plan = add(p.plan, block.plan);
        // The lines it brought aren't decisions yet: billing counts them once you tap Done on the problem (p.confirmed)
        const added = [...notes.slice(p.notes.length), ...plan.slice(p.plan.length)];
        // Core lines come in on; lines under an "If ...:" header come in off (✓ the ones that apply)
        let inIf = false;
        const off = (block.plan || []).filter(s => {
            if (isBranch(s)) { inIf = true; return false; }
            return inIf && !p.plan.includes(s);
        });
        return { ...p, notes, ddx, plan, avs: p.avs || block.pi || '', ...(block.kind && !p.kind ? { kind: block.kind } : {}),
            off: [...(p.off || []), ...off], dot: [...(p.dot || []), ...added], confirmed: added.length ? false : p.confirmed };
    },
};

const HPI_STOP = new Set(['pain', 'follow', 'hpi', 'pediatric', 'concern', 'concerns', 'symptoms', 'change', 'and', 'the', 'for', 'with', 'visit', 'acute']);
const LINKING = new Set(['on', 'given', 'with', 'for', 'of', 'x', 'since', 'in', 'at', 'to', 'from', 'per', 'after', 'before', 'while']);
const words = s => s.trim().split(/\s+/);

/**
 * "_controlled / uncontrolled" pick lists in a line: [{ at, text, options }].
 * A list runs to the end of its sentence (". " or a final "."), a ";", the line's end, a *** blank, the next "_" list or an unmatched ")".
 * - Presentation lists (right after "given", or an option before the last has a comma or "given") keep the whole last option:
 *   "given _dysuria and frequency, no discharge / urgency, suprapubic pain / recurrent sxs." → 3 options.
 * - Otherwise the last option stops at a comma, and if more text follows it is cut to the shortest earlier option's
 *   word count (the earlier option's count if both start with the same word, "on repletion / on maintenance"),
 *   kept longer through words the earlier options use ("LNG-IUD / copper IUD placement" → copper IUD), and cut
 *   before a linking word, so the words after it stay in the sentence:
 *   "_mild / moderate / severe alcohol use disorder" → mild | moderate | severe;
 *   "_controlled / uncontrolled on current regimen" → controlled | uncontrolled.
 */
export function picks(line) {
    const out = [];
    for (const m of line.matchAll(/(?:^|(?<=[\s:(]))_(?=[^\s_])/g)) {
        const from = m.index + 1;
        if (out.length && m.index < out.at(-1).at + out.at(-1).text.length) continue;
        let end = line.length; let depth = 0;
        for (let i = from; i < line.length; i++) {
            const c = line[i];
            if (c === '(') depth++;
            else if (c === ')') { if (!depth) { end = i; break; } depth--; }
            else if ((c === '.' && /\s|$/.test(line[i + 1] || '') && !/(^|\s)[A-Za-z]$/.test(line.slice(from, i)))   // "H. pylori" goes on
                || c === ';' || c === '\n' || (line.startsWith(' ***', i) && line[i - 1] !== '/') || /^ _[^\s_]/.test(line.slice(i, i + 3))) { end = i; break; }
        }
        const parts = line.slice(from, end).split(' / ');
        const opts = parts.slice(0, -1);
        if (!opts.length || parts.some(o => !o.trim() || o.includes('_'))) continue;
        let last = parts.at(-1);
        if (!/\bgiven $/.test(line.slice(0, m.index)) && !opts.some(o => o.includes(',') || /\bgiven\b/.test(o))) {
            if (opts.some(o => /[,;]/.test(o))) continue;
            last = last.split(',')[0];
            if (from + parts.slice(0, -1).join(' / ').length + 3 + last.length < line.length) {
                const w = last.trim().split(' ');
                const ws = opts.map(words);
                const twin = ws.find(o => o[0].toLowerCase() === w[0].toLowerCase());
                // Earlier options all 2+ words are full names ("normal grief / prolonged grief disorder / major depression
                // with bereavement given"): the last one isn't cut by word count, only before a linking word.
                const full = ws.every(o => o.length > 1) && !twin;
                let k = full ? w.length : Math.min(w.length, twin ? twin.length : Math.min(...ws.map(o => o.length)));
                const used = new Set(ws.flat().flatMap(x => [x, ...x.split('-')]).map(x => x.toLowerCase()));
                // A full name runs on past a linking word with only one word after it ("it is up to date.")
                const link = w.findIndex((x, i) => i > 0 && LINKING.has(x.toLowerCase()) && !(full && i === w.length - 2));
                const stop = link > 0 ? link : w.length;
                while (k < stop && w[k].length > 2 && !['and', 'the'].includes(w[k].toLowerCase()) && used.has(w[k].toLowerCase())) k++;
                // Options differ: one cut to an earlier option's words runs on to the linking word ("mammogram / mammogram and ultrasound on")
                if (opts.some(o => o.trim().toLowerCase() === w.slice(0, k).join(' ').toLowerCase())) k = stop;
                last = w.slice(0, Math.min(k, stop)).join(' ');
            }
        }
        const text = '_' + [...opts, last].join(' / ');
        if (!last.trim()) continue;
        out.push({ at: m.index, text, options: [...opts, last].map(o => o.trim()) });
    }
    return out;
}

/** Still a template: has a *** blank or an unpicked "_a / b" list. */
export const unfilled = line => line.includes('***') || picks(line).length > 0;

// ------------------------------------------------------------ HPI dotphrases ($h): blanks you fill with a tap

/** Common answers for a *** blank, by the words around it; [] when there's no safe guess (you type it). */
const BLANK_CHOICES = [
    [/\bx$/, /^ days\b/, ['1', '2', '3', '4', '5', '7', '10', '14']],
    [/\bx$/, /^ wk\b/, ['1', '2', '3', '4', '6', '8', '12']],
    [/\bx$/, null, ['1 day', '2 days', '3 days', '5 days', '1 week', '2 weeks', '1 month', '3 months', '6 months', '1 year', 'years']],
    [/\btried$/, null, ['OTC analgesics', 'OTC cold medicine', 'rest and ice', 'home remedies']],
    [/\bwith$/, /^ relief\b/, ['no', 'minimal', 'partial', 'good', 'complete']],
    [/\bonset$/, null, ['sudden', 'gradual']],
    [/\bpain is$/, null, ['sharp', 'dull', 'aching', 'burning', 'throbbing', 'cramping', 'pressure-like']],
    [/\bcough is$/, null, ['dry', 'productive']],
    [/^$/, /^ (sided|ear|knee|shoulder|hip|ankle|elbow|foot|leg|arm|wrist|hand|red eye|eye|jaw)\b/, ['left', 'right', 'bilateral']],
    [/\b(tobacco|nicotine|tobacco and vaping)$/, null, ['none', 'former', 'current']],
    [/\b(alcohol|cannabis|caffeine)$/, null, ['none', 'occasional', 'daily']],
    [/\bsick contacts$/, null, ['none', 'at home', 'at school', 'at work']],
    [/\b(course|symptoms are)$/, null, ['improving', 'stable', 'worsening']],
    [/\bmax temp$/, null, ['not measured', '100.4 F', '101 F', '102 F', '103 F', '104 F']],
    [/\badherence( and technique)?$/, null, ['good', 'missed doses', 'poor']],
    [/\b(sleep|appetite|energy|mood|concentration|intake)$/, null, ['normal', 'decreased', 'increased']],
];
/** Words a blank's label can't end with for the generic none / yes answer ("Reports ***" yes, "radiating to ***" no). */
const NOT_LABEL = /(^|\s)(is|are|to|of|for|in|with|by|on|at|as|and|or|every|lasting|last|x|before|after|from|since|about|than|located|started|described as|interested in|associated with|triggered by|worse with|reports|dr\.)$/;

/** Start of the *** blank number n (0-based) in a line, or -1. */
export function blankAt(line, n) {
    let at = -1;
    for (let i = 0; i <= n; i++) { at = line.indexOf('***', at + (i ? 3 : 0)); if (at < 0) return -1; }
    return at;
}

/** Separators between clauses: ", " "; " ". " (not "Dr. ***"). */
const SEP = /(?<!\bDr)[,;.](?=\s|$)/g;

/** Tap-to-fill answers for blank n: [] when there's no safe guess. */
export function blankChoices(line, n) {
    const at = blankAt(line, n); if (at < 0) return [];
    const before = line.slice(0, at);
    const clause = before.slice(Math.max(...[...before.matchAll(SEP)].map(m => m.index + 1), before.lastIndexOf(':') + 1, 0))
        .trim().replace(/^- /, '').toLowerCase();
    const after = line.slice(at + 3);
    const hit = BLANK_CHOICES.find(([b, a]) => b.test(clause) && (!a || a.test(after)));
    if (hit) return hit[2];
    // "Orthopnea ***," / "Prior episodes ***.": a label then the blank, ending its clause
    return clause && /^\s*([,;.]|$)/.test(after) && !NOT_LABEL.test(clause) ? ['none', 'yes'] : [];
}

/** The line with blank n filled; capitalized at the start of a sentence. */
export function fillBlank(line, n, text) {
    const at = blankAt(line, n); if (at < 0) return line;
    const start = /(^|[.:]\s+|^- )$/.test(line.slice(0, at));
    return line.slice(0, at) + (start ? text[0].toUpperCase() + text.slice(1) : text) + line.slice(at + 3);
}

/** The line without the clause holding blank n ("Drainage ***, hearing change ***." → "Hearing change ***."); '' if nothing is left. */
export function dropClause(line, n) {
    const at = blankAt(line, n); if (at < 0) return line;
    const seps = [...line.matchAll(SEP)].map(m => m.index);
    const a = seps.filter(i => i < at).at(-1) ?? -1;
    const b = seps.find(i => i > at) ?? line.length;
    let out;
    if (a >= 0 && /[,;]/.test(line[a])) out = line.slice(0, a) + line.slice(b);          // "A, [B], C." → "A, C."; "A, [B]." → "A."
    else if (/[,;]/.test(line[b] || '')) {                                             // "[A], B." → "B." (capitalized)
        const rest = line.slice(b + 1).replace(/^\s+/, '');
        out = line.slice(0, a + 1) + (a >= 0 ? ' ' : '') + rest.charAt(0).toUpperCase() + rest.slice(1);
    } else out = line.slice(0, a + 1) + line.slice(b + 1);                               // the whole sentence
    out = out.replace(/\s{2,}/g, ' ').trim();
    return /^-?\s*$/.test(out) ? '' : out;
}
