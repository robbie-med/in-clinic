// Dotphrase problem blocks (dotphrases.json, copied from ~/Projects/dot by tools/import-dot.mjs).
// Adding a problem fills its Notes and Plan from its block. A library problem uses the block mapped to its key;
// any other name uses a block whose name, title or #abbreviation matches. Blocks with no library problem
// are offered in the problem picker too.
export const Dot = {
    phrases: [],

    load(data) {
        this.phrases = data?.phrases || [];
        this.byLib = new Map(this.phrases.filter(p => p.lib).map(p => [p.lib, p]));
    },

    /** The block for a library key, else an exact name / title / abbreviation match. */
    find(lib, name = '') {
        if (lib && this.byLib?.has(lib)) return this.byLib.get(lib);
        const n = name.trim().toLowerCase().replace(/^#/, '');
        if (!n) return null;
        return this.phrases.find(p => p.name.toLowerCase() === n || p.title.toLowerCase() === n || p.abbr.slice(1) === n) || null;
    },

    /** Blocks without a library problem, matching the query by name, title or abbreviation (prefix matches first). */
    search(q) {
        const n = q.trim().toLowerCase().replace(/^#/, '');
        const free = this.phrases.filter(p => !p.lib);
        if (!n) return [];
        const hay = p => [p.name.toLowerCase(), p.title.toLowerCase(), p.abbr.slice(1)];
        const starts = p => hay(p).some(s => s.startsWith(n));
        return free.filter(p => hay(p).some(s => s.includes(n))).sort((a, b) => (starts(a) ? 0 : 1) - (starts(b) ? 0 : 1));
    },

    /** The problem with the block's lines added to its Notes, DDx (unlabelled group) and Plan; lines it already has are skipped. */
    fill(p, block) {
        if (!block) return p;
        const add = (have, more = []) => [...have, ...more.filter(l => !have.includes(l))];
        const items = (block.ddx || []).filter(d => !p.ddx.some(g => g.items.includes(d)));
        const ddx = !items.length ? p.ddx : p.ddx.some(g => g.label === '')
            ? p.ddx.map(g => (g.label === '' ? { ...g, items: [...g.items, ...items] } : g)) : [...p.ddx, { label: '', items }];
        return { ...p, notes: add(p.notes, block.notes), ddx, plan: add(p.plan, block.plan) };
    },
};

const LINKING = new Set(['on', 'given', 'with', 'for', 'of', 'x', 'since', 'in', 'at', 'to', 'from', 'per', 'after', 'before', 'while']);

/**
 * "_controlled / uncontrolled" pick lists in a line: [{ at, text, options }]. Where the list doesn't end the line, the
 * last option is cut to the shortest earlier option's word count and before a linking word, so the words after it stay
 * in the sentence: "_mild / moderate / severe alcohol use disorder" → mild | moderate | severe;
 * "_controlled / uncontrolled on current regimen" → controlled | uncontrolled.
 */
export function picks(line) {
    return [...line.matchAll(/(?:^|(?<=[\s:(]))_([^,.;_]+?(?: \/ [^,.;_]+?)+)(?=[,.;)]|$)/g)].map(m => {
        const opts = m[1].split(' / ');
        let last = opts.pop();
        if (m.index + m[0].length < line.length) {
            const words = last.split(' ');
            let k = Math.min(words.length, ...opts.map(o => o.trim().split(/\s+/).length));
            const link = words.findIndex((w, i) => i > 0 && LINKING.has(w.toLowerCase()));
            if (link > 0) k = Math.min(k, link);
            last = words.slice(0, k).join(' ');
        }
        const options = [...opts, last].map(s => s.trim());
        return { at: m.index, text: '_' + [...opts, last].join(' / '), options };
    });
}

/** Still a template: has a *** blank or an unpicked "_a / b" list. */
export const unfilled = line => line.includes('***') || picks(line).length > 0;
