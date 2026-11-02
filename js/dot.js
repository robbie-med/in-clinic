// Dotphrase problem blocks (dotphrases.json, copied from ~/Projects/dot by tools/import-dot.mjs).
// Adding a problem fills its Notes and Plan from its block. A library problem uses the block mapped to its key;
// any other name uses a block whose name, title or #abbreviation matches. Blocks with no library problem
// are offered in the problem picker too.
// Handouts are the library's $pi patient instructions, for the After Visit Summary. A block's "pi" names its handout.
// Clinic phone numbers are "{{Central Referral Center}}" in dotphrases.json (the repo is public); load() fills them from
// the numbers saved on this device (Clinic phone numbers), or leaves a *** blank. Resources are physician-only lists.
export const Dot = {
    phrases: [],
    handouts: [],
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
        return { ...p, notes, ddx, plan, avs: p.avs || block.pi || '', ...(block.kind && !p.kind ? { kind: block.kind } : {}),
            dot: [...(p.dot || []), ...added], confirmed: added.length ? false : p.confirmed };
    },
};

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
