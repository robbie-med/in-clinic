// Problem library: library.json (shared with the Android app). Clinical lists are starting points to tap
// from, not recommendations. Lines you type are remembered per problem (store.js) and come back as chips.
export const Library = {
    data: { medVerbs: [], hpiGeneric: [], fuWhen: [], fuGeneric: [], problems: [] },

    load(data) { this.data = data; this.byKey = new Map(data.problems.map(p => [p.key, p])); },

    get(key) { return (key && this.byKey?.get(key)) || null; },

    /** Exact name / alias match (for carried-forward problems). */
    match(name) {
        const n = name.trim().toLowerCase();
        return this.data.problems.find(l => l.name.toLowerCase() === n || (l.aliases || []).includes(n)) || null;
    },

    /** Name or alias contains the query; names that start with it first. */
    search(q) {
        const n = q.trim().toLowerCase();
        if (!n) return this.data.problems;
        const hit = l => l.name.toLowerCase().includes(n) || (l.aliases || []).some(a => a.includes(n));
        const starts = l => l.name.toLowerCase().startsWith(n) || (l.aliases || []).some(a => a.startsWith(n));
        return this.data.problems.filter(hit).sort((a, b) => (starts(a) ? 0 : 1) - (starts(b) ? 0 : 1));
    },
};
