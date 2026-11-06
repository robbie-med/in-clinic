// Private build on this PC only: "Send to ClinReminder" hands one visit's ordered tests, referrals, follow-up and
// E/M code to ClinReminder (desktop_clinic_aide, localhost:8471), which has the patient's name and owns reminders.
// No note text and no names leave In-Clinic; ClinReminder matches the visit by today's date + slot time (+ age/sex).
import * as B from './billing.js';
import * as N from './note.js';

export const CLIN_URL = 'http://127.0.0.1:8471';

// "Referral to cardiology", "Refer to GI for colonoscopy", "Ambulatory referral to derm" → "Cardiology", "GI", "Derm"
const REFER = /\brefer(?:ral|red)?\s+(?:back\s+)?to\s+(.+?)(?=\s+(?:for|re|to|and)\b|[,.;:(]|\s-\s|$)/i;
const SKIP = /\*\*\*|\b(if|unless|consider|when|declin|defer)\b|(^|[\s:(])_[^\s_][^_]*? \/ /i;

export function referrals(v) {
    const out = [];
    for (const s of B.planned(v)) {
        if (SKIP.test(s)) continue;
        const m = REFER.exec(s);
        if (!m) continue;
        const spec = m[1].trim().replace(/^(the|a|an)\s+/i, '');
        const nice = spec[0].toUpperCase() + spec.slice(1);
        if (nice && !out.some(o => o.toLowerCase() === nice.toLowerCase())) out.push(nice);
    }
    return out;
}

const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

/** What ClinReminder gets for this visit. */
export function payload(v, labDays = 3, date = today()) {
    return {
        date, slot: v.slot, age: v.age, sex: v.sex,
        code: B.bill(v).code,
        labs: B.testsOrdered(v), labDays,
        referrals: referrals(v),
        followUp: N.followUp(v), fuWhen: v.fuWhen,
    };
}

/** Resolves to ClinReminder's reply ({visit: {name, sched_time}, added}); rejects with a readable message. */
export async function send(body) {
    let res;
    try {
        res = await fetch(CLIN_URL + '/api/inclinic', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    } catch {
        throw new Error('ClinReminder isn’t running (localhost:8471).');
    }
    const out = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(out.error || 'ClinReminder said ' + res.status);
    return out;
}

// ---- room time (Room Logger taps assigned to this card in ClinReminder), shown in the Visit section

const hhmm = iso => { const d = new Date(iso); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
const mins = (from, to) => Math.max(0, Math.round((new Date(to) - new Date(from)) / 60000));

/** "Rm 2 · 10:42–11:00 · 18 min · staffed 10:55", or "Rm 2 · in since 10:42 (12 min)" while still in the room. */
export function roomText(r, now = Date.now()) {
    const rooms = 'Rm ' + r.rooms.join(', ');
    const staffed = r.staffed_at ? ` · staffed ${hhmm(r.staffed_at)}` : '';
    if (!r.end_at) return `${rooms} · in since ${hhmm(r.start_at)} (${mins(r.start_at, now)} min)${staffed}`;
    return `${rooms} · ${hhmm(r.start_at)}–${hhmm(r.end_at)} · ${mins(r.start_at, r.end_at)} min${staffed}`;
}

/** The matching card's room time, or null (no time set, no card, nothing assigned, or ClinReminder not running). */
export async function room(v, date = today()) {
    if (!v.slot) return null;
    const q = new URLSearchParams({ date, slot: v.slot, age: v.age, sex: v.sex });
    try { return (await (await fetch(CLIN_URL + '/api/inclinic/room?' + q)).json()).room || null; } catch { return null; }
}
