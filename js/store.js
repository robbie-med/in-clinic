// Visits + learned chips in this device's browser storage (never leaves the device).
// Visits older than 3 days are dropped on load; "Clear panel" drops them all.
const KEEP_MS = 3 * 24 * 3600_000;
const LEARN_MAX = 20;
const K = 'in-clinic.';

function read(key, fallback) {
    try { const s = localStorage.getItem(K + key); return s ? JSON.parse(s) : fallback; } catch { return fallback; }
}
function write(key, value) {
    try { localStorage.setItem(K + key, JSON.stringify(value)); return true; } catch { return false; }
}

let cache = null;

export const Store = {
    visits() {
        if (!cache) {
            const cutoff = Date.now() - KEEP_MS;
            cache = read('visits', []).filter(v => v && v.id && v.created > cutoff);
        }
        return cache;
    },

    /** Panel order: by slot time (blank last), then when added. */
    panel() {
        return [...this.visits()].sort((a, b) => (a.slot || '9999').localeCompare(b.slot || '9999') || a.created - b.created);
    },

    find(id) { return this.visits().find(v => v.id === id) || null; },

    put(v) {
        const l = this.visits(); const i = l.findIndex(x => x.id === v.id);
        if (i < 0) l.push(v); else l[i] = v;
        return this.save(l);
    },
    putAll(vs) { return this.save([...this.visits(), ...vs]); },
    remove(id) { return this.save(this.visits().filter(v => v.id !== id)); },
    clear() { return this.save([]); },
    save(l) { cache = l; return write('visits', l); },

    // ---- learned chips: lines you typed for a problem come back as chips (most recent first)
    learned(key, kind) { return read(`learn.${kind}.${key}`, []); },
    learn(key, kind, text) {
        const t = text.trim();
        if (!t || t.length > 160) return;
        write(`learn.${kind}.${key}`, [t, ...this.learned(key, kind).filter(x => x !== t)].slice(0, LEARN_MAX));
    },
    forget(key, kind, text) { write(`learn.${kind}.${key}`, this.learned(key, kind).filter(x => x !== text)); },

    // ---- settings (signature block printed above the attestation)
    setting(key, fallback = '') { return read('set.' + key, fallback); },
    setSetting(key, value) { return write('set.' + key, value); },

    /** Free-typed problem names, offered in the problem picker next time. */
    customProblems() { return this.learned('names', 'problem'); },

    /** Every learned chip, for backup / moving to another device. */
    learnedDump() {
        const o = {};
        for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (k.startsWith(K + 'learn.')) o[k.slice(K.length)] = read(k.slice(K.length), []);
        }
        return o;
    },
    learnedRestore(o) {
        let n = 0;
        for (const [k, v] of Object.entries(o || {})) if (k.startsWith('learn.') && Array.isArray(v)) { write(k, v); n++; }
        return n;
    },
};
