// Office E/M level from medical decision making (AMA 2021+ office E/M table; same rules as android/.../Billing.kt).
// MDM is the 2nd-highest of its three elements: problems, data, risk (2 of 3 must meet a level).
// Levels: 1 straightforward, 2 low, 3 moderate, 4 high. Time-based billing is not offered: with a resident,
// only the teaching physician's time counts, and under the primary care exception only MDM may be used.
//
// Problems come from each problem's status pills (or its per-problem override), risk from the plan lines
// (or the visit override), data from the counters in the Billing section. It only suggests a code;
// the person billing decides. Picks are conservative: when unsure it counts the lower level.

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

/** What a problem counts as when not overridden, from its status pills. */
export function autoCx(p) {
    if (p.noStatus) return 'none';
    if (p.trend === 'Resolved') return 'minor';
    if (p.course === 'Chronic') return p.trend === 'Worsening' ? 'chronicx' : 'stable';
    if (p.course === 'Acute' || p.course === 'Subacute') return 'acute';
    if (p.novelty === 'Known') return p.trend === 'Worsening' ? 'chronicx' : 'stable';
    if (p.novelty === 'New') return 'acute';
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

export const emptyData = () => ({ ordered: null, reviewed: 0, external: 0, historian: false, interp: false, discuss: false });

// Unique tests named in plan lines (each counts once, the way a CPT code would). Matched on word boundaries;
// short all-caps names (UA, CT, LH) only in capitals so ordinary words don't match.
const TESTS = [
    'CBC', 'CMP', 'BMP', 'A1C', 'TSH', 'free T4', 'T3', 'lipid panel', 'UA', 'urinalysis', 'urine culture', 'urine albumin',
    'UACR', 'PSA', 'ferritin', 'iron panel', 'B12', 'folate', 'vitamin D', 'magnesium', 'phosphorus', 'LFTs', 'hepatic panel',
    'lipase', 'CRP', 'ESR', 'BNP', 'troponin', 'INR', 'PT/INR', 'D-dimer', 'uric acid', 'HIV', 'hepatitis C', 'HCV', 'RPR',
    'GC/CT', 'hCG', 'pregnancy test', 'prolactin', 'cortisol', 'ACTH', 'DHEA-S', 'IGF-1', 'estradiol', 'LH', 'FSH', 'testosterone',
    'ANA', 'RF', 'CCP', 'celiac', 'stool culture', 'FIT', 'Cologuard', 'H. pylori', 'strep test', 'rapid strep',
    'EKG', 'ECG', 'echo', 'echocardiogram', 'Holter', 'stress test', 'PFT', 'PFTs', 'spirometry', 'sleep study', 'PSG',
    'CXR', 'chest x-ray', 'x-ray', 'XR', 'CT', 'CTA', 'MRI', 'ultrasound', 'US', 'DEXA', 'mammogram', 'colonoscopy', 'ABI', 'EMG',
];
const esc = s => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
const TEST_RE = TESTS.map(t => [t, new RegExp(`(^|[^A-Za-z0-9])${esc(t)}(?![A-Za-z0-9])`, /^[A-Z]{2,3}$/.test(t) ? '' : 'i')]);
const NOT_ORDER = /\b(review(ed)?|result(s|ed)?|showed|shows|was|were|normal|unremarkable|declin|defer|consider|ordered? (previously|last))/i;

/** Tests named in plan lines that read as orders (not "reviewed CBC"). */
export function testsOrdered(v) {
    const lines = v.problems.flatMap(p => p.plan).filter(s => !NOT_ORDER.test(s));
    const found = [];
    for (const [t, re] of TEST_RE) if (lines.some(s => re.test(s)) && !found.some(f => f.toLowerCase() === t.toLowerCase())) found.push(t);
    // "x-ray" also matches inside "chest x-ray"; drop the shorter duplicate
    return found.filter(t => !found.some(o => o !== t && o.toLowerCase().includes(t.toLowerCase()) && o.length > t.length));
}

function dataLevel(v) {
    const d = { ...emptyData(), ...(v.data || {}) };
    const auto = testsOrdered(v);
    const ordered = d.ordered === null || d.ordered === undefined ? auto.length : d.ordered;
    const docs = ordered + d.reviewed + d.external;           // category 1 without the historian
    const cat1 = docs + (d.historian ? 1 : 0);
    const cats = (cat1 >= 3 ? 1 : 0) + (d.interp ? 1 : 0) + (d.discuss ? 1 : 0);
    const why = [];
    if (ordered) why.push(`${ordered} ordered` + (d.ordered == null && auto.length ? ` (${auto.join(', ')})` : ''));
    if (d.reviewed) why.push(`${d.reviewed} reviewed`);
    if (d.external) why.push(`${d.external} external source${d.external > 1 ? 's' : ''}`);
    if (d.historian) why.push('independent historian');
    if (d.interp) why.push('independent interpretation');
    if (d.discuss) why.push('discussed w/ external');
    let lvl = 1;
    if (cats >= 2) lvl = 4;
    else if (cats >= 1) lvl = 3;
    else if (docs >= 2 || d.historian) lvl = 2;
    return { lvl, why: why.length ? why : ['none'], ordered, auto };
}

// ------------------------------------------------------------ risk of patient management

const RX = /^(CONT|START|INCREASE|DECREASE|STOP|REFILL|TAPER|HOLD|RESUME|SWITCH)\b|prescri|\bRx\b/;
const HIGH = /\b(admit|admission|hospitaliz|direct(ly)? to (the )?ED|sent to (the )?ED|send to (the )?ED|DNR|hospice|comfort care)/i;
const LOW = /\b(OTC|over[- ]the[- ]counter|physical therapy|home PT|PT referral|OT)\b/i;

function riskLevel(v) {
    const lines = v.problems.flatMap(p => p.plan.map(s => s.trim()).filter(Boolean));
    const ex = re => lines.filter(s => re.test(s));
    if (v.risk && RISKS.includes(v.risk)) return { lvl: RISKS.indexOf(v.risk) + 1, why: ['set by hand'] };
    if (ex(HIGH).length) return { lvl: 4, why: ['escalation: ' + ex(HIGH)[0]] };
    if (ex(RX).length) return { lvl: 3, why: ['Rx drug mgmt: ' + ex(RX).slice(0, 2).join('; ')] };
    if (v.sdoh) return { lvl: 3, why: ['SDOH limits dx/tx'] };
    if (ex(LOW).length) return { lvl: 2, why: [ex(LOW)[0]] };
    if (lines.length) return { lvl: 2, why: ['plan without Rx'] };
    return { lvl: 1, why: ['no plan yet'] };
}

// ------------------------------------------------------------ the code

/** New patient: no visit with this group (same specialty) in 3 years. "New to me" in a known clinic is established. */
export const isNew = v => v.relation === 'new to clinic';

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

/** Teaching-physician attestation for the code being billed. */
export const attestation = v => (bill(v).pce ? ATTEST_PCE : ATTEST_PRESENT);
