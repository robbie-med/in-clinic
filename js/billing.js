// Office E/M level from medical decision making (AMA 2021+ office E/M table). android/.../Billing.kt has the same
// table but reads only the pills, counters and plan verbs; the web app also reads the note's text, as below.
// MDM is the 2nd-highest of its three elements: problems, data, risk (2 of 3 must meet a level).
// Levels: 1 straightforward, 2 low, 3 moderate, 4 high. Time-based billing is not offered: with a resident,
// only the teaching physician's time counts, and under the primary care exception only MDM may be used.
//
// Everything is automatic from what the note says; every part can be overridden by hand:
// - Problems: the status pills (set when a problem is added, from its dotphrase's kind and the visit) and the kind
//   (threat / systemic / workup / minor). A chronic problem not at goal ("uncontrolled", "flare", a START / INCREASE /
//   SWITCH line) counts as chronic with progression (AMA: a chronic illness not at treatment goal is not stable).
// - Data: tests ordered in plan lines; results reviewed (tests named with a value in the HPI / notes); outside records,
//   an independent historian (a child, or "per mom"), independent interpretation and a discussion with an outside
//   physician from their wording; hospital / ED follow-up counts the discharge records as one external note.
// - Risk: med verbs (Rx management), admit / ED / hospice (high), OTC and PT (low), SDOH wording.
// What counts: lines you typed, tapped in or edited, and a dotphrase's lines once you tap Done on its problem
// (p.confirmed; until then they're a menu, p.dot). Counted lines count as written, *** blanks included. Never counted:
// an unpicked "_a / b" list (nothing chosen yet), and conditional lines ("Admit if …") as escalation, orders or changes.
// It only suggests a code; the person billing decides.

export const LEVELS = ['', 'Straightforward', 'Low', 'Moderate', 'High'];

/** Problem complexity choices: key, label, MDM level of one such problem. */
export const CX = [
    { key: 'none', label: 'Not counted', lvl: 0 },
    { key: 'minor', label: 'Minor / self-limited', lvl: 1 },
    { key: 'stable', label: 'Stable chronic', lvl: 2 },
    { key: 'acute', label: 'Acute, uncomplicated', lvl: 2 },
    { key: 'chronicx', label: 'Chronic w/ exacerbation / progression / tx side effects', lvl: 3 },
    { key: 'undx', label: 'Undiagnosed new problem, uncertain prognosis', lvl: 3 },
    { key: 'systemic', label: 'Acute illness w/ systemic symptoms', lvl: 3 },
    { key: 'complicated', label: 'Acute complicated injury', lvl: 3 },
    { key: 'severe', label: 'Chronic w/ severe exacerbation', lvl: 4 },
    { key: 'threat', label: 'Threat to life or bodily function', lvl: 4 },
];
export const cx = key => CX.find(c => c.key === key);

export const RISKS = ['minimal', 'low', 'moderate', 'high'];

/** CMS primary care exception: the teaching physician need not be present for these (lower-level) codes. */
export const PCE_CODES = ['99202', '99203', '99211', '99212', '99213'];
export const CODES = { new: ['99202', '99203', '99204', '99205'], est: ['99212', '99213', '99214', '99215'] };

export const ATTEST_PCE = "By the addition of their electronic signature, the teaching physician certifies that they have reviewed the resident's history, physical, diagnosis, and plan and agree with the patient's care as documented in the resident note except as noted. The teaching physician will remain available for follow up to the resident or the patient if that becomes medically necessary.";
export const ATTEST_PRESENT = "By the addition of their electronic signature, the teaching physician certifies that they were physically present for the critical or key portions of the visit or re-performed these portions to their satisfaction. The teaching physician discussed the case with the resident, history was reviewed, examination performed and an assessment/plan was established. The resident's documentation was reviewed and the teaching physician agrees with the resident's findings except as noted. The teaching physician will remain available for follow-up to the resident or the patient if that becomes medically necessary.";

/** An unpicked "_a / b" dotphrase list: nothing chosen yet, so the line isn't counted. */
const PICK = /(^|[\s:(])_[^\s_][^_]*? \/ /;
/** A conditional or criteria line ("Admit if …", "Labs only if …"): not a decision made today. */
const COND = /\b(if|unless|consider|when)\b/i;
/** A problem's plan lines that are switched on (✓); off lines stay on screen but out of the note and billing. */
export const onPlan = p => (p.off?.length ? p.plan.filter(s => !p.off.includes(s)) : p.plan);

/** A problem's lines that count: all once confirmed (Done), else the ones that didn't come from its dotphrase as is. */
const live = (p, lines) => (lines || []).filter(s => p.confirmed || !(p.dot || []).includes(s));
/** Changing treatment of a chronic problem means it isn't at goal. OTC lines don't count. */
const CHANGE = /^(START|INCREASE|INCR|DECREASE|DECR|SWITCH|ADD|HOLD|STOP|DISCONTINUE|D\/C|TAPER)\b/;   // holding/stopping a med is a change too
const OTC = /\b(OTC|over[- ]the[- ]counter)\b/i;
const NOT_AT_GOAL = /\b(uncontrolled|not (at|to) goal|above goal|not controlled|poorly controlled|suboptimal(ly)? controlled|worsening|worsened|exacerbation|flares?|progressi(on|ng)|side effects?|intoleran\w*|adverse (effects?|reactions?))\b/i;
const NEGATED = /\b(no|not|without|denies|denied|resolved|free of)\s+(\S+\s+){0,2}$/i;

/** The words in a problem's lines that show it isn't at goal, or ''. */
export function notAtGoal(p) {
    for (const s of live(p, p.notes)) {
        if (PICK.test(s)) continue;
        const m = NOT_AT_GOAL.exec(s);
        if (m && !NEGATED.test(s.slice(0, m.index))) return m[0];
    }
    const ch = live(p, onPlan(p)).find(s => CHANGE.test(s.trim()) && !PICK.test(s) && !OTC.test(s) && !COND.test(s));
    return ch ? ch.trim().split(/\s+/).slice(0, 3).join(' ') : '';
}

/**
 * What a problem counts as when not overridden: its kind (from its dotphrase) and status pills, and for a chronic
 * problem whether it's at goal. Tapping Stable says it's at goal; Worsening says it isn't.
 */
export function autoCx(p) {
    if (p.noStatus || p.kind === 'none') return 'none';
    if (p.trend === 'Resolved') return 'minor';
    if (p.kind === 'threat') return 'threat';
    const chronic = p.course === 'Chronic' || (!p.course && p.novelty === 'Known');
    if (chronic) return p.trend === 'Worsening' || (p.trend !== 'Stable' && notAtGoal(p)) ? 'chronicx' : 'stable';
    if (p.kind === 'systemic') return 'systemic';
    if (p.kind === 'minor') return 'minor';
    if (p.kind === 'workup' && p.novelty !== 'Known') return 'undx';
    if (p.course === 'Acute' || p.course === 'Subacute' || p.novelty === 'New') return 'acute';
    return 'minor';
}
export const problemCx = p => (p.cx && cx(p.cx) ? p.cx : autoCx(p));

function problemsLevel(ps) {
    const rows = ps.map(p => ({ name: p.name.trim() || 'problem', c: cx(problemCx(p)) })).filter(r => r.c.lvl > 0);
    const of = key => rows.filter(r => r.c.key === key);
    const names = rs => rs.map(r => r.name).join(', ');
    const top = Math.max(0, ...rows.map(r => r.c.lvl));
    if (top >= 3) return { lvl: top, why: rows.filter(r => r.c.lvl === top).map(r => `${r.name}: ${r.c.label.toLowerCase()}`) };
    const stable = of('stable'); const acute = of('acute'); const minor = of('minor');
    if (stable.length >= 2) return { lvl: 3, why: [`${stable.length} stable chronic: ${names(stable)}`] };
    if (stable.length || acute.length) {
        return { lvl: 2, why: [stable.length ? `1 stable chronic: ${names(stable)}` : '', acute.length ? `acute uncomplicated: ${names(acute)}` : ''].filter(Boolean) };
    }
    if (minor.length >= 2) return { lvl: 2, why: [`${minor.length} minor: ${names(minor)}`] };
    return { lvl: 1, why: [rows.length ? `minor: ${names(minor)}` : 'no problems counted'] };
}

// ------------------------------------------------------------ data reviewed and analyzed

/** null = automatic (from the note's text); a number / true / false = set by hand. */
export const emptyData = () => ({ ordered: null, reviewed: null, external: null, historian: null, interp: null, discuss: null });

// Unique tests named in plan lines (each counts once, the way a CPT code would). Matched on word boundaries;
// short all-caps names (UA, CT, LH) only in capitals so ordinary words don't match.
// RESULTS: a result named in the HPI or notes counts as its test ("Hgb 10.8" is the CBC); only there, not in plan
// lines, where "potassium-rich foods" isn't a BMP.
const TESTS = [
    'CBC', 'CMP', 'BMP', 'A1C', 'TSH', 'free T4', 'T3', 'lipid panel', 'UA', 'urinalysis', 'urine culture', 'urine albumin',
    'UACR', 'PSA', 'ferritin', 'iron panel', 'B12', 'folate', 'vitamin D', 'magnesium', 'phosphorus', 'LFTs', 'hepatic panel',
    'lipase', 'CRP', 'ESR', 'BNP', 'troponin', 'INR', 'PT/INR', 'D-dimer', 'uric acid', 'HIV', 'hepatitis C', 'HCV', 'RPR',
    'GC/CT', 'hCG', 'pregnancy test', 'prolactin', 'cortisol', 'ACTH', 'DHEA-S', 'IGF-1', 'estradiol', 'LH', 'FSH', 'testosterone',
    'ANA', 'RF', 'CCP', 'celiac', 'stool culture', 'FIT', 'Cologuard', 'H. pylori', 'strep test', 'rapid strep',
    'EKG', 'ECG', 'echo', 'echocardiogram', 'Holter', 'stress test', 'PFT', 'PFTs', 'spirometry', 'sleep study', 'PSG',
    'CGM', 'CXR', 'chest x-ray', 'x-ray', 'XR', 'CT', 'CTA', 'MRI', 'ultrasound', 'US', 'DEXA', 'mammogram', 'colonoscopy', 'ABI', 'EMG',
];
const RESULTS = {
    CBC: ['Hgb', 'hemoglobin', 'Hct', 'hematocrit', 'MCV', 'WBC', 'platelets', 'Plt'],
    BMP: ['creatinine', 'Cr', 'eGFR', 'GFR', 'potassium', 'sodium', 'BUN', 'bicarb', 'glucose'],
    A1C: ['HbA1c', 'Hb A1c'], 'lipid panel': ['LDL', 'HDL', 'triglycerides', 'TG', 'total cholesterol', 'non-HDL'],
    LFTs: ['ALT', 'AST', 'bilirubin', 'alk phos', 'albumin'], 'free T4': ['FT4'], UACR: ['albuminuria', 'microalbumin'],
    'vitamin D': ['25-OH', '25-hydroxy'], 'PT/INR': ['PT'], 'urine culture': ['UCx'], 'H. pylori': ['stool antigen', 'urea breath test'],
};
const esc = s => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
const word = t => new RegExp(`(^|[^A-Za-z0-9])${esc(t)}(?![A-Za-z0-9])`, /^[A-Z][A-Za-z]{1,2}$/.test(t) ? '' : 'i');
const TEST_RE = TESTS.map(t => [t, word(t)]);
const RESULT_RE = TESTS.map(t => [t, [t, ...(RESULTS[t] || [])].map(word)]);
/** A dotphrase plan branch header ("If DMPA:"): groups the plan lines under it, isn't a plan step itself. */
export const isBranch = s => /^If\b.*:$/.test(s.trim());
const NOT_ORDER = /\b(review(ed)?|result(s|ed)?|showed|shows|was|were|normal|unremarkable|declin|defer|consider|ordered? (previously|last))/i;

/** Plan lines that can count: not under "#Deferred to future visit" (those aren't done today), no branch headers. */
export const planned = v => v.problems.filter(p => !/^#?deferred\b/i.test(p.name.trim())).flatMap(p => live(p, onPlan(p))).filter(s => !isBranch(s));

/** Unique tests whose patterns match any of the lines; "x-ray" inside "chest x-ray" counts once. */
function testsIn(lines, table) {
    const found = [];
    for (const [t, res] of table) {
        if (lines.some(s => [res].flat().some(re => re.test(s))) && !found.some(f => f.toLowerCase() === t.toLowerCase())) found.push(t);
    }
    return found.filter(t => !found.some(o => o !== t && o.toLowerCase().includes(t.toLowerCase()) && o.length > t.length));
}

/** Tests named in plan lines that read as orders (not "reviewed CBC"). */
export const testsOrdered = v => testsIn(planned(v).filter(s => !NOT_ORDER.test(s) && !PICK.test(s) && !COND.test(s)), TEST_RE);

/** The HPI and the problems' notes (what was found and reviewed), filled lines only. */
const historyLines = v => [...(v.hpi || []), ...v.problems.flatMap(p => live(p, p.notes))].filter(s => !PICK.test(s) && !s.includes('***'));

/** Tests with a result in the HPI or notes ("Hgb 10.8", "TSH normal"), or a "reviewed …" plan line; not ones ordered today. */
export function testsReviewed(v) {
    const RESULT = /\d|\b(normal|wnl|unremarkable|elevated|high|low|positive|negative|neg|pos)\b/i;
    const lines = [...historyLines(v).filter(s => (RESULT.test(s) || /\breviewed\b/i.test(s)) && !/\b(goal|target)\b/i.test(s)),
        ...planned(v).filter(s => /\b(reviewed|results?)\b/i.test(s) && !PICK.test(s))];
    const ordered = testsOrdered(v).map(t => t.toLowerCase());
    return testsIn(lines, RESULT_RE).filter(t => !ordered.includes(t.toLowerCase()));
}

const EXTERNAL = /\b((outside|external) (records?|notes?|labs?|imaging)|care everywhere|discharge summary|(ED|ER|urgent care|hospital|consult) (note|records?|visit note)|records (from|obtained|received)|per (his|her|their|the) \w+ (note|records?))/i;
const HISTORIAN = /\b(per|according to|accompanied by|(collateral|history)( history)?( (obtained|provided|given))? (from|by))\s+(his |her |their |the )?(mom|mother|dad|father|parents?|caregivers?|guardian|wife|husband|spouse|partner|daughter|son|family|aide|staff|grand(mother|father|parents?)|sister|brother)\b/i;
const INTERP = /\b(independent(ly)? interpret|my (own )?(read|interpretation)|personally (reviewed|viewed|interpreted) (the )?(images?|films?|tracings?|EKG|ECG|x-?rays?|XR|CXR|CT|MRI|imaging))/i;
const DISCUSS = /\b(discussed|spoke|talked|d\/w|curbsided?)\s+(with |w\/ |to )?(Dr\.?\s|the |his |her |their |pt's )?(\w+\s)?(Dr\.?\s|cardiolog|nephrolog|endocrin|gastroenterolog|GI\b|neurolog|pulmonolog|rheumatolog|oncolog|hematolog|surg|urolog|ortho|dermatolog|psychiatr|infectious|radiolog|hospitalist|ED (physician|provider|doctor)|consultant|specialist|pharmacist|PCP)/i;

/** Months for "18 mo", "6 wk", "3 d"; years for "4" or "4 yo"; null if unreadable. */
function ageYears(age) {
    const m = /^\s*(\d+(?:\.\d+)?)\s*([a-z]*)/i.exec(age || '');
    if (!m) return null;
    const n = +m[1]; const u = m[2].toLowerCase();
    return /^(mo|m$|month)/.test(u) ? n / 12 : /^(w|wk|week)/.test(u) ? n / 52 : /^d/.test(u) ? n / 365 : n;
}

/** What the note's text says for each data item: { reviewed: [tests], external: [lines], historian: why, interp: line, discuss: line }. */
export function dataAuto(v) {
    const all = [...historyLines(v), ...planned(v).filter(s => !PICK.test(s))];
    const external = all.filter(s => EXTERNAL.test(s));
    if (!external.length && (v.type === 'hospital' || v.type === 'ed')) external.push(v.type === 'ed' ? 'ED records' : 'hospital discharge records');
    const yrs = ageYears(v.age);
    const hist = all.find(s => HISTORIAN.test(s));
    // A resident's "discussed with attending" isn't an outside discussion
    const discuss = all.find(s => DISCUSS.test(s) && !/\b(attending|preceptor|staffed)\b/i.test(s));
    return {
        reviewed: testsReviewed(v), external,
        historian: yrs !== null && yrs < 12 ? `age ${String(v.age).trim()}: history from parent` : hist ? hist : '',
        interp: all.find(s => INTERP.test(s)) || '', discuss: discuss || '',
    };
}

/** The data counts in effect: set by hand, else from the note's text. */
export function dataValues(v) {
    const d = { ...emptyData(), ...(v.data || {}) };
    const a = dataAuto(v); const ord = testsOrdered(v);
    const pick = (k, auto) => (d[k] === null || d[k] === undefined ? auto : d[k]);
    return {
        ordered: pick('ordered', ord.length), reviewed: pick('reviewed', a.reviewed.length), external: pick('external', a.external.length),
        historian: !!pick('historian', !!a.historian), interp: !!pick('interp', !!a.interp), discuss: !!pick('discuss', !!a.discuss),
        isAuto: k => d[k] === null || d[k] === undefined, auto: { ...a, ordered: ord },
    };
}

function dataLevel(v) {
    const d = dataValues(v); const a = d.auto;
    const docs = d.ordered + d.reviewed + d.external;           // category 1 without the historian
    const cat1 = docs + (d.historian ? 1 : 0);
    const cats = (cat1 >= 3 ? 1 : 0) + (d.interp ? 1 : 0) + (d.discuss ? 1 : 0);
    const list = (k, xs) => (d.isAuto(k) && xs.length ? ` (${xs.join(', ')})` : '');
    const why = [];
    if (d.ordered) why.push(`${d.ordered} ordered` + list('ordered', a.ordered));
    if (d.reviewed) why.push(`${d.reviewed} reviewed` + list('reviewed', a.reviewed));
    if (d.external) why.push(`${d.external} external source${d.external > 1 ? 's' : ''}` + list('external', a.external.map(s => s.slice(0, 40))));
    if (d.historian) why.push('independent historian');
    if (d.interp) why.push('independent interpretation');
    if (d.discuss) why.push('discussed w/ external');
    let lvl = 1;
    if (cats >= 2) lvl = 4;
    else if (cats >= 1) lvl = 3;
    else if (docs >= 2 || d.historian) lvl = 2;
    return { lvl, why: why.length ? why : ['none'], ordered: d.ordered, auto: a.ordered };
}

// ------------------------------------------------------------ risk of patient management

const RX = /^(CONT|START|INCREASE|DECREASE|INCR|DECR|STOP|REFILL|TAPER|HOLD|RESUME|SWITCH)\b|prescri|\bRx\b/;
const HIGH = /\b(admit|admission|hospitaliz|direct(ly)? to (the )?ED|sent to (the )?ED|send to (the )?ED|DNR|hospice|comfort care)/i;
const LOW = /\b(OTC|over[- ]the[- ]counter|physical therapy|home PT|PT referral|OT)\b/i;

const SDOH = /\b(can'?t afford|cannot afford|unable to afford|cost (is )?(a )?barrier|cost-prohibitive|uninsured|no insurance|(lacks?|lack of|no) transportation|housing insecur\w*|homeless\w*|food insecur\w*|unable to obtain)/i;

/** The SDOH wording in the note that limits diagnosis or treatment, or ''. */
export const sdohAuto = v => [...historyLines(v), ...planned(v)].find(s => SDOH.test(s)) || '';

function riskLevel(v) {
    const lines = planned(v).map(s => s.trim()).filter(Boolean);
    const ex = re => lines.filter(s => re.test(s) && !PICK.test(s));
    const sdoh = v.sdoh === true || (v.sdoh !== false && !!sdohAuto(v));
    if (v.risk && RISKS.includes(v.risk)) return { lvl: RISKS.indexOf(v.risk) + 1, why: ['set by hand'] };
    const high = ex(HIGH).filter(s => !COND.test(s) && !s.includes('***'));   // escalation only when spelled out
    if (high.length) return { lvl: 4, why: ['escalation: ' + high[0]] };
    const rx = ex(RX).filter(s => !OTC.test(s));
    if (rx.length) return { lvl: 3, why: ['Rx drug mgmt: ' + rx.slice(0, 2).join('; ')] };
    if (sdoh) return { lvl: 3, why: ['SDOH limits dx/tx' + (v.sdoh === true ? '' : ': ' + sdohAuto(v))] };
    if (ex(LOW).length || ex(RX).length) return { lvl: 2, why: [(ex(LOW)[0] || ex(RX)[0])] };
    if (lines.length) return { lvl: 2, why: ['plan without Rx'] };
    return { lvl: 1, why: ['no plan yet'] };
}

// ------------------------------------------------------------ the code

/** New patient: no visit with this group (same specialty) in 3 years. "New to me" in a known clinic is established. */
export const isNew = v => v.relation === 'new to clinic';

/** For the Billing warnings: counted plan lines still holding ***, unpicked lists, and problems with dotphrase lines not yet confirmed. */
export function blanks(v) {
    const lines = planned(v);
    const pending = v.problems.filter(p => !p.confirmed && !p.noStatus && (p.dot || []).some(s => onPlan(p).includes(s) || p.notes.includes(s))).map(p => p.name);
    return { stars: lines.filter(s => s.includes('***')).length, picks: lines.filter(s => PICK.test(s)).length, pending };
}

export function bill(v) {
    const problems = problemsLevel(v.problems);
    const data = dataLevel(v);
    const risk = riskLevel(v);
    const mdm = [problems.lvl, data.lvl, risk.lvl].sort((a, b) => b - a)[1];
    const kind = isNew(v) ? 'new' : 'est';
    const auto = CODES[kind][mdm - 1];
    const code = CODES[kind].includes(v.code) ? v.code : auto;   // a code for the other patient kind is ignored
    return { problems, data, risk, mdm, kind, auto, code, overridden: code !== auto, pce: PCE_CODES.includes(code) };
}

/**
 * Teaching-physician attestation: what actually happened, picked by hand in Billing (v.tp 'present' | 'pce').
 * Never inferred from the code: nothing is printed until it's picked. (b.pce only says the code fits the exception.)
 */
export const attestation = v => ({ present: ATTEST_PRESENT, pce: ATTEST_PCE }[v.tp] || '');
