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

    /** The problem with the block's lines added to its Notes and Plan (lines it already has are skipped). */
    fill(p, block) {
        if (!block) return p;
        const add = (have, more) => [...have, ...more.filter(l => !have.includes(l))];
        return { ...p, notes: add(p.notes, block.notes), plan: add(p.plan, block.plan) };
    },
};

/** "_controlled / uncontrolled" pick lists in a line: [{ at, text, options }]. */
export function picks(line) {
    return [...line.matchAll(/(?:^|(?<=[\s:(]))_([^,.;_]+?(?: \/ [^,.;_]+?)+)(?=[,.;)]|$)/g)].map(m => ({
        at: m.index, text: m[0], options: m[1].split(' / ').map(s => s.trim()),
    }));
}

/** Still a template: has a *** blank or an unpicked "_a / b" list. */
export const unfilled = line => line.includes('***') || picks(line).length > 0;
