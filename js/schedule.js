// Pasted schedule → visits. Keeps only slot time, age, sex and visit type; names, MRNs, DOBs and the rest are
// dropped. A line with a time starts a visit; following lines (until the next time) fill in age/sex/type, because
// EMR schedules often spread one patient over several lines. Same rules as android/.../Schedule.kt.
import { newVisit } from './note.js';

const TIME = /\b(\d{1,2}):(\d{2})\s*([AaPp])\.?[Mm]?\.?\b|\b(\d{1,2}):(\d{2})\b/;
const AGE_SEX = /\b(\d{1,3})\s?(?:y\.?o\.?|yo|y\/o|yrs?|years?(?: old)?|Y)?\s?(F|M|female|male)\b/i;
const AGE_ONLY = /\b(\d{1,3})\s?(?:y\.?o\.?|yo|y\/o|yrs?|years? old|Y)\b/i;
const SEX_ONLY = /\b(Female|Male)\b/i;

const TYPES = [
    [/hosp|tcm|transition/i, 'hospital'],
    [/\b(ED|ER)\b|emergency/, 'ed'],
    [/new pat|establish|\bNP\b|new patient/i, 'establish'],
    [/annual|physical|wellness|\bAWV\b|\bCPE\b|preventive/i, 'annual'],
    [/pre-?op/i, 'preop'],
    [/acute|sick|same.?day|urgent/i, 'acute'],
    [/follow|f\/u|\bFU\b|return|chronic/i, 'follow-up'],
];

/** "8:30 AM" → "0830", "1:15 PM" → "1315", "13:15" → "1315". */
function slot(m) {
    let h = parseInt(m[1] || m[4], 10); const min = m[2] || m[5];
    const ap = (m[3] || '').toLowerCase();
    if (ap === 'p' && h < 12) h += 12;
    if (ap === 'a' && h === 12) h = 0;
    return String(h).padStart(2, '0') + min;
}

export function extract(text) {
    const out = []; let cur = null; let typed = false;
    const fill = (v, line) => {
        const x = { ...v };
        const as = AGE_SEX.exec(line);
        if (as) { if (!x.age) x.age = as[1]; if (!x.sex) x.sex = as[2][0].toUpperCase(); }
        if (!x.age) { const a = AGE_ONLY.exec(line); if (a) x.age = a[1]; }
        if (!x.sex) { const s = SEX_ONLY.exec(line); if (s) x.sex = s[1][0].toUpperCase(); }
        if (!typed) { const t = TYPES.find(([re]) => re.test(line)); if (t) { x.type = t[1]; typed = true; } }
        return x;
    };
    for (const raw of text.replace(/\r/g, '').split('\n')) {
        const line = raw.trim();
        if (!line) continue;
        const m = TIME.exec(line);
        if (m) {
            if (cur) out.push(cur);
            typed = false;
            cur = fill(newVisit({ slot: slot(m), created: Date.now() + out.length, type: '' }), line.slice(0, m.index) + line.slice(m.index + m[0].length));
        } else if (cur) cur = fill(cur, line);
    }
    if (cur) out.push(cur);
    return out.map(v => ({ ...v, type: v.type || 'follow-up' }));
}
