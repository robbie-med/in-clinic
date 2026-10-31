#!/usr/bin/env node
// Web app logic tests (same cases as android/app/src/test). Run: node tools/test.mjs
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { Library } from '../js/library.js';
import * as Note from '../js/note.js';
import * as Billing from '../js/billing.js';
import { extract } from '../js/schedule.js';
import { Dot, picks, unfilled } from '../js/dot.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
Library.load(JSON.parse(fs.readFileSync(path.join(root, 'library.json'), 'utf8')));

let pass = 0; let fail = 0;
const test = (name, f) => {
    try { f(); pass++; } catch (e) { fail++; console.error(`FAIL ${name}\n  ${e.message.split('\n').join('\n  ')}`); }
};

const P = f => Note.newProblem(f);
const sample = Note.newVisit({
    age: '52', sex: 'F', cc: 'fatigue',
    hpi: [
        'Complains of fatigue, poor sleep and low mood for several months',
        'Recently moved; new commute',
        'Denies significant stress; does not explain all symptoms',
        'LMP 2 wk ago',
    ],
    problems: [
        P({ name: 'Fatigue', lib: 'fatigue', novelty: 'New', course: 'Chronic', trend: 'Worsening',
            notes: [
                'Incidental pituitary finding on prior imaging; labs not yet done',
                'Prior cortisol confounded by IV steroid the day before',
                'Denies recent steroid use',
            ],
            ddx: [
                { label: 'Non-hormonal', items: ['OSA', 'depression/anxiety (PHQ-9 negative)',
                    'medication effect (fatigue, mood change)', 'iron deficiency anemia'] },
                { label: 'Hormonal', items: ['hyperprolactinemia', 'central adrenal insufficiency', 'panhypopituitarism', 'perimenopause/estrogen insufficiency'] },
            ],
            plan: [
                '8 AM serum cortisol with simultaneous ACTH, DHEA-S',
                'TSH, free T4, IGF-1, prolactin, estradiol, LH, FSH',
                'CBC, CMP, A1C, ferritin, iron panel',
                'Sleep study ordered',
            ] }),
        P({ name: 'Left hand tingling', novelty: 'New', course: 'Acute', trend: 'Stable',
            notes: ['Seen by neurology; workup ongoing', 'Neurology recommends continuing current meds'],
            plan: ['Continue current meds; defer changes for now'] }),
        P({ name: 'HTN', lib: 'htn', novelty: 'Known', course: 'Chronic', trend: 'Stable', plan: ['CONT amlodipine 5 mg PO daily'] }),
    ],
    fuWhen: '2 wk', fuWhy: ['review labs', 'confirm sleep study scheduled'],
});

const expected = {
    cc: 'fatigue',
    hpi: `52F known to me presents for follow-up of fatigue.
Complains of fatigue, poor sleep and low mood for several months
Recently moved; new commute
Denies significant stress; does not explain all symptoms
LMP 2 wk ago`,
    ap: `#Fatigue
Incidental pituitary finding on prior imaging; labs not yet done
Prior cortisol confounded by IV steroid the day before
Denies recent steroid use

DDx:
>OSA
>depression/anxiety (PHQ-9 negative)
>medication effect (fatigue, mood change)
>iron deficiency anemia
>hyperprolactinemia
>central adrenal insufficiency
>panhypopituitarism
>perimenopause/estrogen insufficiency

- 8 AM serum cortisol with simultaneous ACTH, DHEA-S
- TSH, free T4, IGF-1, prolactin, estradiol, LH, FSH
- CBC, CMP, A1C, ferritin, iron panel
- Sleep study ordered

#Left hand tingling
Seen by neurology; workup ongoing
Neurology recommends continuing current meds

- Continue current meds; defer changes for now

#HTN
- CONT amlodipine 5 mg PO daily

F/u in 2 wk to review labs and confirm sleep study scheduled`,
};
const text = (v, sig = '') => Object.fromEntries(Note.sections(v, sig).map(s => [s.key, s.text]));

// ---- note
test('renders the clinic template, one section at a time', () => {
    const t = text(sample);
    assert.deepEqual(Object.keys(t), ['cc', 'hpi', 'ap', 'sign']);
    for (const k of ['cc', 'hpi', 'ap']) assert.equal(t[k], expected[k], k);
    assert.equal(t.sign, Billing.ATTEST_PRESENT);
});
test('signature goes above the attestation', () =>
    assert.equal(text(sample, 'A. Doc, MD\nPGY-2').sign, 'A. Doc, MD\nPGY-2\n\n' + Billing.ATTEST_PRESENT));
test('empty visit', () => {
    const t = text(Note.newVisit({ problems: [P({ name: 'Cough' })] }));
    assert.deepEqual(Object.keys(t), ['hpi', 'ap', 'sign']);
    assert.equal(t.hpi, '*** known to me presents for follow-up.');
    assert.equal(t.ap, '#Cough');
});
test('status pills are not printed; blank line between notes, DDx and plan, none after the header', () => {
    assert.deepEqual(Note.problemLines(P({ name: 'Health maintenance', noStatus: true, plan: ['Tdap'] })), ['#Health maintenance', '- Tdap']);
    assert.deepEqual(Note.problemLines(P({ name: 'HTN', novelty: 'Known', course: 'Chronic', trend: 'Stable', notes: ['At goal'], plan: ['CONT x'] })),
        ['#HTN', 'At goal', '', '- CONT x']);
    assert.deepEqual(Note.problemLines(P({ name: '#Cough', ddx: [{ label: 'Infectious', items: ['viral URI; most likely'] }, { label: '', items: ['GERD'] }] })),
        ['#Cough', 'DDx:', '>viral URI; most likely', '>GERD']);
});

// The clinic example from the build spec, character for character
const golden = `#Fatigue
Likely iron deficiency anemia given menorrhagia and microcytosis.
Hgb 10.8, MCV 76, ferritin 9, no melena or hematochezia.

DDx:
>Iron deficiency anemia; most likely given menorrhagia and ferritin 9, treating empirically
>Hypothyroidism; considered but unlikely given no cold intolerance or weight gain, TSH to exclude

- START ferrous sulfate 325 mg PO every other day with vitamin C source
- Increase dietary iron: red meat 2-3x/wk, lentils, spinach; avoid tea/coffee within 1 hr of dose
- TSH today
- Repeat CBC, ferritin in 8 wk

#Primary hypertension
Above goal on current regimen, home average 142/90.
No hypokalemia, no resistant pattern.

- CONT lisinopril 10 mg PO daily
- INCR. lisinopril to 20 mg PO daily if home average >130/80 at f/u
- DASH diet, sodium <2 g/day, 150 min/wk moderate aerobic activity
- Home BP log BID x 2 wk, f/u 4 wk

#Deferred to future visit
- Lipid screening
- Colon cancer screening`;
const goldenVisit = Note.newVisit({ age: '34', sex: 'F', problems: [
    P({ name: 'Fatigue', novelty: 'New', course: 'Subacute', trend: 'Worsening',
        notes: ['Likely iron deficiency anemia given menorrhagia and microcytosis.', 'Hgb 10.8, MCV 76, ferritin 9, no melena or hematochezia.'],
        ddx: [{ label: 'Hematologic', items: ['Iron deficiency anemia; most likely given menorrhagia and ferritin 9, treating empirically'] },
            { label: 'Endocrine', items: ['Hypothyroidism; considered but unlikely given no cold intolerance or weight gain, TSH to exclude'] }],
        plan: ['START ferrous sulfate 325 mg PO every other day with vitamin C source',
            'Increase dietary iron: red meat 2-3x/wk, lentils, spinach; avoid tea/coffee within 1 hr of dose', 'TSH today', 'Repeat CBC, ferritin in 8 wk'] }),
    P({ name: 'Primary hypertension', novelty: 'Known', course: 'Chronic', trend: 'Worsening',
        notes: ['Above goal on current regimen, home average 142/90.', 'No hypokalemia, no resistant pattern.'],
        plan: ['CONT lisinopril 10 mg PO daily', 'INCR. lisinopril to 20 mg PO daily if home average >130/80 at f/u',
            'DASH diet, sodium <2 g/day, 150 min/wk moderate aerobic activity', 'Home BP log BID x 2 wk, f/u 4 wk'] }),
    P({ name: 'Deferred to future visit', noStatus: true, plan: ['Lipid screening', 'Colon cancer screening'] }),
] });
test('A/P matches the clinic example exactly', () => assert.equal(text(goldenVisit).ap, golden));
test('the clinic example parses back to the same A/P', () => {
    const r = Note.parse(golden);
    assert.deepEqual(r.problems.map(p => p.name), ['Fatigue', 'Primary hypertension', 'Deferred to future visit']);
    assert.deepEqual(r.problems[0].ddx, [{ label: '', items: goldenVisit.problems[0].ddx.flatMap(g => g.items) }]);
    assert.equal(text(Note.newVisit({ problems: r.problems })).ap, golden);
});
test('one-liner variants', () => {
    assert.equal(Note.oneLiner(Note.newVisit({ age: '63', sex: 'M', relation: 'new to clinic', type: 'establish' })), '63M new to clinic presents to establish care.');
    assert.equal(Note.oneLiner(Note.newVisit({ age: '28', sex: 'F', type: 'acute', cc: 'cough x5 days' })), '28F known to me presents for cough x5 days.');
    assert.equal(Note.oneLiner(Note.newVisit({ oneLiner: 'Typed by hand.' })), 'Typed by hand.');
});
test('new to me: records line instead of the words', () => {
    const t = text(Note.newVisit({ age: '30', sex: 'F', relation: 'new to me', type: 'establish', hpi: ['Moved here 7 yr ago'] }));
    assert.equal(t.hpi, `30F presents to establish care.\n${Note.RECORDS}\nMoved here 7 yr ago`);
});
test('follow-up line', () => {
    const fu = f => Note.followUp(Note.newVisit(f));
    assert.equal(fu({ fuWith: 'Dr. Richard', fuWhen: '2 mo', fuWhy: ['prenatal care'] }), 'F/u w Dr. Richard in 2 mo to prenatal care');
    assert.equal(fu({ fuWith: 'Dr. Owen', fuWhy: ['after specialist visit', 'ED precautions reviewed'] }), 'F/u w Dr. Owen after specialist visit and ED precautions reviewed');
    assert.equal(fu({ fuWhen: 'PRN' }), 'F/u PRN');
    assert.equal(fu({}), '');   // no follow-up line
});
test('parse round-trips', () => {
    const r = Note.parse('History of Present Illness\n' + expected.hpi + '\n\nAssessment/Plan\n' + expected.ap);
    assert.equal(r.age, '52'); assert.equal(r.sex, 'F');
    assert.deepEqual(r.problems.map(p => p.name), sample.problems.map(p => p.name));
    sample.problems.forEach((a, i) => {
        const b = r.problems[i];
        for (const k of ['notes', 'plan']) assert.deepEqual(b[k], a[k], `${a.name}.${k}`);
        assert.deepEqual(b.ddx.flatMap(g => g.items), a.ddx.flatMap(g => g.items), `${a.name}.ddx`);
    });
});
// Synthetic note in the shape the EMR pastes back (leading spaces, stray blanks, signature + attestation after)
const pasted = `Chief Complaint

DM

History of Present Illness

70F known to me presents for leg swelling

 Swelling x 2 wk

Assessment/Plan

1. Leg swelling
Likely venous insufficiency
 No calf tenderness
 - Compression stockings
 - BMP

2. Type 2 diabetes mellitus without complication
TIR improving
 - CONT metformin 500 mg BID
 - f/u in 2-3 weeks

F/u w Dr. Smith in 3 mo

Jane Doe, MD
 PGY-2, Program
 555-0100

By the addition of their electronic signature, the teaching physician certifies that ...`;
test('parses an EMR paste and stops at the signature', () => {
    const r = Note.parse(pasted);
    assert.equal(r.age, '70'); assert.equal(r.sex, 'F');
    assert.deepEqual(r.problems.map(p => p.name), ['Leg swelling', 'Type 2 diabetes mellitus without complication']);
    assert.deepEqual(r.problems[0].notes, ['Likely venous insufficiency', 'No calf tenderness']);
    assert.deepEqual(r.problems[1].plan, ['CONT metformin 500 mg BID', 'f/u in 2-3 weeks']);
});
test('still reads older notes: "1. Problem", status lines, ">Label: a, b" DDx', () => {
    const r0 = Note.parse('Assessment/Plan\n1. Fatigue\nNew\nChronic\nDDx:\n>Hormonal: hyperprolactinemia, central adrenal insufficiency\n\n- TSH');
    assert.equal(r0.problems[0].course, 'Chronic');
    assert.deepEqual(r0.problems[0].ddx, [{ label: 'Hormonal', items: ['hyperprolactinemia', 'central adrenal insufficiency'] }]);
    assert.deepEqual(r0.problems[0].plan, ['TSH']);
    const r = Note.parse('52F known to me.\n\nPLAN\n\n#HTN\nKnown\nChronic\nStable\n\n- CONT amlodipine\n\nFollow-up: 2 wk.');
    assert.equal(r.problems[0].name, 'HTN'); assert.equal(r.problems[0].trend, 'Stable'); assert.deepEqual(r.problems[0].plan, ['CONT amlodipine']);
});
test('carry forward: Known, trend cleared, library reattached', () => {
    const ps = Note.carryForward(Note.parse('Assessment/Plan\n' + expected.ap).problems);
    assert.ok(ps.every(p => p.novelty === 'Known' && p.trend === ''));
    assert.equal(ps[2].lib, 'htn'); assert.equal(ps[0].lib, 'fatigue');
});
test('exam is its own section', () => {
    let v = Note.newVisit({ age: '60', sex: 'M', hpi: ['Cough x2 wk'], vitals: { BP: '128/82', SpO2: '97%' } });
    v = Note.examToggle(Note.examToggle(v, 'Respiratory', 'crackles'), 'Respiratory', 'diminished bases');
    v = Note.examToggle(v, 'General', Note.NL);
    assert.equal(text(v).exam, 'Vitals: BP 128/82, SpO2 97%\nGeneral: No acute distress, pleasant, conversant, well-groomed\nRespiratory: crackles and diminished bases');
});
test('exam nL plus a finding appends it', () => {
    let v = Note.examToggle(Note.newVisit(), 'MSK', Note.NL);
    v = Note.examToggle(v, 'MSK', 'myofascial trigger points');
    assert.deepEqual(Note.examLines(v), ['MSK: Normal ambulation, no clubbing or cyanosis, myofascial trigger points']);
    v = Note.examToggle(v, 'MSK', Note.NL); assert.deepEqual(Note.examLines(v), ['MSK: myofascial trigger points']);
    v = Note.examToggle(v, 'MSK', 'myofascial trigger points'); assert.ok(!('MSK' in v.exam));
});
test('all untouched -> nL skips optional systems', () => {
    const l = Note.examLines(Note.examAllNormal(Note.newVisit()));
    assert.deepEqual(l.map(x => x.split(':')[0]), ['General', 'Eyes', 'ENT', 'Neck', 'Respiratory', 'CV', 'MSK', 'Neuro', 'Skin', 'Psych']);
});
test('old saved visits still render', () => {
    const old = Note.newVisit(); for (const k of ['exam', 'vitals', 'fuWith', 'data', 'risk', 'code', 'copied']) delete old[k];
    assert.equal(text(old).ap, undefined);
    assert.equal(Billing.bill(old).code, '99212');
});
test('exam is ASCII', () => Library.data.exam.forEach(s => [s.name, s.normal, ...s.abnormal].forEach(x => assert.ok(/^[\x00-\x7f]*$/.test(x), x))));
test('split keeps parentheses', () =>
    assert.deepEqual(Note.split('OSA, medication effect (fatigue, mood change), IDA'), ['OSA', 'medication effect (fatigue, mood change)', 'IDA']));

// ---- billing
const V = f => Note.newVisit(f);
const chronic = (name, trend = 'Stable', plan = []) => P({ name, novelty: 'Known', course: 'Chronic', trend, plan });
test('sample bills 99214: worsening chronic, 3+ tests, Rx', () => {
    const b = Billing.bill(sample);
    assert.deepEqual([b.problems.lvl, b.data.lvl, b.risk.lvl, b.code, b.pce], [3, 3, 3, '99214', false]);
    assert.ok(b.data.auto.includes('cortisol') && b.data.auto.includes('sleep study') && b.data.auto.includes('LH'));
});
test('1 stable chronic, plan without Rx -> 99213 with the primary care exception attestation', () => {
    const v = V({ problems: [chronic('HTN', 'Stable', ['Home BP log'])] });
    const b = Billing.bill(v);
    assert.deepEqual([b.problems.lvl, b.data.lvl, b.risk.lvl, b.code, b.pce], [2, 1, 2, '99213', true]);
    assert.equal(Billing.attestation(v), Billing.ATTEST_PCE);
});
test('2 stable chronic + Rx -> 99214; new to clinic -> 99204', () => {
    const ps = [chronic('HTN', 'Stable', ['CONT lisinopril 10 mg']), chronic('HLD')];
    assert.equal(Billing.bill(V({ problems: ps })).code, '99214');
    assert.equal(Billing.bill(V({ problems: ps, relation: 'new to clinic' })).code, '99204');
    assert.equal(Billing.bill(V({ problems: ps, relation: 'new to me' })).code, '99214');
});
test('MDM is the middle of the three', () => {
    // high problem, minimal data, low risk -> low
    const v = V({ problems: [P({ name: 'Chest pain', cx: 'threat', plan: ['ice'] })] });
    assert.equal(Billing.bill(v).mdm, 2);
    assert.equal(Billing.bill({ ...v, risk: 'high' }).code, '99215');
});
test('problem complexity from status pills', () => {
    assert.equal(Billing.autoCx(chronic('x', 'Worsening')), 'chronicx');
    assert.equal(Billing.autoCx(chronic('x', 'Improving')), 'stable');
    assert.equal(Billing.autoCx(P({ name: 'x', novelty: 'New', course: 'Acute' })), 'acute');
    assert.equal(Billing.autoCx(P({ name: 'x', trend: 'Resolved', course: 'Chronic' })), 'minor');
    assert.equal(Billing.autoCx(P({ name: 'HM', noStatus: true })), 'none');
    assert.equal(Billing.problemCx(P({ name: 'x', course: 'Acute', cx: 'undx' })), 'undx');
});
test('two acute uncomplicated problems stay low', () =>
    assert.equal(Billing.bill(V({ problems: [P({ name: 'a', course: 'Acute' }), P({ name: 'b', course: 'Acute' })] })).problems.lvl, 2));
test('data levels', () => {
    const lvl = data => Billing.bill(V({ data })).data.lvl;
    assert.equal(lvl({ reviewed: 1 }), 1);
    assert.equal(lvl({ reviewed: 1, external: 1 }), 2);
    assert.equal(lvl({ historian: true }), 2);
    assert.equal(lvl({ reviewed: 2, historian: true }), 3);
    assert.equal(lvl({ discuss: true }), 3);
    assert.equal(lvl({ discuss: true, interp: true }), 4);
    assert.equal(lvl({ reviewed: 3, discuss: true }), 4);
    assert.equal(lvl({ ordered: 0 }), 1);
});
test('tests ordered come from plan lines that read as orders', () => {
    const v = V({ problems: [P({ name: 'x', plan: ['CBC, CMP', 'Reviewed TSH: normal', 'US abdomen', 'Consider MRI', 'chest x-ray'] })] });
    assert.deepEqual(Billing.testsOrdered(v), ['CBC', 'CMP', 'chest x-ray', 'US']);
    assert.deepEqual(Billing.testsOrdered(V({ problems: [P({ name: 'x', plan: ['Discussed results with us', 'flu shot today'] })] })), []);
});
test('risk from the plan', () => {
    const r = plan => Billing.bill(V({ problems: [P({ name: 'x', plan })] })).risk.lvl;
    assert.equal(r([]), 1);
    assert.equal(r(['Continue prenatal vitamin']), 2);
    assert.equal(r(['STOP ibuprofen']), 3);
    assert.equal(r(['No opioids prescribed today']), 3);
    assert.equal(r(['Direct admit to hospital']), 4);
    assert.equal(Billing.bill(V({ sdoh: true, problems: [P({ name: 'x', plan: ['labs'] })] })).risk.lvl, 3);
});
test('code set by hand picks the attestation', () => {
    const v = { ...sample, code: '99213' };
    const b = Billing.bill(v);
    assert.deepEqual([b.code, b.auto, b.overridden, b.pce], ['99213', '99214', true, true]);
    assert.equal(text(v).sign, Billing.ATTEST_PCE);
    assert.equal(Billing.bill({ ...sample, code: '99203' }).code, '99214');   // wrong patient kind is ignored
});
test('unfilled template lines (*** or an unpicked "_a / b") are not counted', () => {
    const plan = ['BMP and UACR ***', 'CONT lisinopril *** mg PO daily', 'Statin: _moderate / high intensity, start ***', 'Naloxone prescribed ***'];
    const v = V({ problems: [P({ name: 'x', plan })] });
    assert.deepEqual(Billing.testsOrdered(v), []);
    assert.equal(Billing.bill(v).risk.lvl, 2);   // still a plan, but no Rx decided
    const filled = V({ problems: [P({ name: 'x', plan: ['BMP and UACR today', 'CONT lisinopril 10 mg PO daily', 'my_file / x'] })] });
    assert.deepEqual(Billing.testsOrdered(filled), ['BMP', 'UACR']);
    assert.equal(Billing.bill(filled).risk.lvl, 3);
});
test('"If ...:" plan branches: header between blank lines, dropped once its lines are gone, not billed, parsed back', () => {
    const p = P({ name: 'UTI', notes: ['UA ***.'], plan: ['Return for fever', 'If local resistance <20%:', 'START TMP-SMX 1 DS tab PO BID x 3 days', 'If recurrent:'] });
    const lines = ['#UTI', 'UA ***.', '', '- Return for fever', '', 'If local resistance <20%:', '', '- START TMP-SMX 1 DS tab PO BID x 3 days'];
    assert.deepEqual(Note.problemLines(p), lines);
    assert.deepEqual(Note.problemLines(P({ name: 'x', plan: ['If DMPA:', 'START DMPA'] })), ['#x', 'If DMPA:', '', '- START DMPA']);
    assert.deepEqual(Note.parse(lines.join('\n')).problems[0].plan, p.plan.slice(0, 3));
    assert.deepEqual(Billing.testsOrdered(V({ problems: [P({ name: 'x', plan: ['If UA positive:', 'Return PRN'] })] })), []);
    assert.equal(Billing.bill(V({ problems: [P({ name: 'x', plan: ['START _amoxicillin 500 mg PO TID, 5 days / doxycycline'] })] })).risk.lvl, 2);   // unpicked: no Rx yet
});
test('the build style\'s med verbs (INCR. / DECR. / HOLD) count as Rx management', () => {
    for (const l of ['INCR. lisinopril to 20 mg PO daily', 'DECR. metoprolol to 25 mg PO BID', 'HOLD metformin while AKI'])
        assert.equal(Billing.bill(V({ problems: [P({ name: 'x', plan: [l] })] })).risk.lvl, 3, l);
});
test('plan under "Deferred to future visit" is not counted', () => {
    const v = V({ problems: [P({ name: 'Deferred to future visit', noStatus: true, plan: ['Mammogram', 'Lipid panel', 'START statin'] })] });
    assert.deepEqual(Billing.testsOrdered(v), []);
    assert.equal(Billing.bill(v).risk.lvl, 1);
    assert.equal(Billing.bill(goldenVisit).code, '99214');   // the clinic example: 2 problems, IDA workup, Rx
});

// ---- dotphrases
test('dotphrase blocks fill a new problem; pick lists parse', () => {
    const dot = JSON.parse(fs.readFileSync(path.join(root, 'dotphrases.json'), 'utf8'));
    Dot.load(dot);
    const libKeys = new Set(Library.data.problems.map(p => p.key));
    for (const ph of dot.phrases) {
        if (ph.lib) assert.ok(libKeys.has(ph.lib), `${ph.abbr} maps to unknown library key ${ph.lib}`);
        assert.ok(ph.name && !ph.name.startsWith('#'), ph.abbr);
    }
    const htn = Dot.fill(Note.newProblem({ name: 'HTN', lib: 'htn' }), Dot.find('htn'));
    assert.deepEqual([htn.notes, htn.plan], [Dot.find('htn').notes, Dot.find('htn').plan]);   // follows the library as rebuilt
    assert.ok(htn.plan.length > 0);
    assert.equal(Dot.fill(htn, Dot.find('htn')).plan.length, htn.plan.length);   // no duplicates
    assert.equal(Dot.find('', '#pcos')?.abbr, '#pcos');
    for (const ph of dot.phrases) assert.ok(!ph.notes.some(l => /^(DDx:?|>)/.test(l)), `${ph.abbr}: DDx lines belong in ddx`);
    const ddxBlock = { notes: ['n'], ddx: ['A; most likely given ***', 'B; considered but unlikely given ***'], plan: ['p'] };
    const filled = Dot.fill(Note.newProblem({ name: 'x', ddx: [{ label: 'Lab', items: ['C'] }] }), ddxBlock);
    assert.deepEqual(filled.ddx, [{ label: 'Lab', items: ['C'] }, { label: '', items: ddxBlock.ddx }]);
    assert.deepEqual(Dot.fill(filled, ddxBlock).ddx, filled.ddx);   // no duplicates
    assert.deepEqual(Note.problemLines(filled), ['#x', 'n', '', 'DDx:', '>C', '>A; most likely given ***', '>B; considered but unlikely given ***', '', '- p']);
    assert.equal(Dot.find('', 'polycystic ovary syndrome')?.abbr, '#pcos');
    assert.equal(Dot.find('', 'no such thing'), null);
    assert.equal(Dot.search('pcos')[0].abbr, '#pcos');
    // well child visits come from the $wcc visit notes' A&P block, without status pills
    const wcc = Dot.search('wcc');
    assert.ok(wcc.length >= 20 && wcc.every(p => p.noStatus && p.abbr.startsWith('$wcc')), wcc.map(p => p.abbr).join());
    assert.ok(Dot.search('well child 2 months').some(p => p.abbr === '$wcc2m'));
    assert.ok(Dot.search('well child 15').some(p => p.abbr === '$wcc1517'));
    assert.ok(['$wcc1114', '$wcc1517'].every(a => dot.phrases.some(p => p.abbr === a)));
    assert.ok(Library.search('annual').some(l => l.key === 'hm') && Library.search('physical').some(l => l.key === 'hm'));
    assert.ok(!Dot.search('hyper').some(p => p.lib));   // library problems aren't listed twice
    assert.equal(Dot.search('#pid')[0].abbr, '#pid');   // exact abbreviation before #pidx
    assert.deepEqual(picks('LDL goal: _under 100 / under 70, then ***').map(x => x.options), [['under 100', 'under 70']]);
    assert.deepEqual(picks('my_file / x'), []);
    const opts = l => picks(l).map(x => x.options);
    assert.deepEqual(opts('BP _controlled / uncontrolled on current regimen, most likely primary given ***.'), [['controlled', 'uncontrolled']]);
    assert.deepEqual(opts('_minimal / mild / moderate / moderately severe / severe on current regimen, ***.'), [['minimal', 'mild', 'moderate', 'moderately severe', 'severe']]);
    assert.deepEqual(opts('_mild / moderate / severe alcohol use disorder, ***.'), [['mild', 'moderate', 'severe']]);
    assert.deepEqual(opts('_mild cognitive impairment / dementia given ***.'), [['mild cognitive impairment', 'dementia']]);
    assert.deepEqual(opts('_acute flare / chronic gout, *** on current regimen.'), [['acute flare', 'chronic gout']]);
    assert.deepEqual(opts('Plan: _taper now / taper later / continue with risk reduction'), [['taper now', 'taper later', 'continue with risk reduction']]);
    assert.deepEqual(opts('START POP _norethindrone / norgestrel / drospirenone *** mg PO daily'), [['norethindrone', 'norgestrel', 'drospirenone']]);
    assert.deepEqual(opts('Vitamin D deficiency, _new / on repletion / on maintenance, ***.'), [['new', 'on repletion', 'on maintenance']]);
    assert.deepEqual(opts('Likely _essential / enhanced physiologic / parkinsonian / drug-induced tremor given ***.'), [['essential', 'enhanced physiologic', 'parkinsonian', 'drug-induced']]);
    assert.deepEqual(opts('Pain with _cervical motion / uterine / adnexal tenderness.'), [['cervical motion', 'uterine', 'adnexal']]);
    assert.deepEqual(opts('H. pylori _positive / persistent after treatment by _stool antigen / urea breath test / biopsy, ***.'),
        [['positive', 'persistent'], ['stool antigen', 'urea breath test', 'biopsy']]);
    assert.deepEqual(opts('Likely cystitis given _dysuria and frequency, no discharge / urgency, suprapubic pain / recurrent sxs, no discharge.'),
        [['dysuria and frequency, no discharge', 'urgency, suprapubic pain', 'recurrent sxs, no discharge']]);
    assert.deepEqual(opts('Likely _essential / drug-induced tremor given _action tremor, relieved by alcohol / tremor after new med. Onset ***.'),
        [['essential', 'drug-induced'], ['action tremor, relieved by alcohol', 'tremor after new med']]);
    assert.deepEqual(opts('Likely _celiac given + tTG / H. pylori given + breath test / NSAID-related given NSAID use.'),
        [['celiac given + tTG', 'H. pylori given + breath test', 'NSAID-related given NSAID use']]);
    assert.deepEqual(opts('Likely stroke given _sudden weakness / sudden aphasia / visual field loss or ataxia, DWI lesion.'),
        [['sudden weakness', 'sudden aphasia', 'visual field loss or ataxia, DWI lesion']]);
    assert.deepEqual(opts('_Dog / cat / human / *** bite to *** on ***.'), [['Dog', 'cat', 'human', '***']]);
    assert.deepEqual(opts('Likely _major depression with bereavement / prolonged grief disorder / normal grief given _a / b / c.')[0],
        ['major depression with bereavement', 'prolonged grief disorder', 'normal grief']);
    const pk = picks('BP _controlled / uncontrolled on current regimen, ***.')[0];
    assert.equal('BP _controlled / uncontrolled on current regimen, ***.'.slice(pk.at, pk.at + pk.text.length), pk.text);
    assert.ok(unfilled('_a / b') && unfilled('dose ***') && !unfilled('dose 10 mg'));
});

// ---- schedule
test('one line per patient', () => {
    const vs = extract('8:30 AM  Doe, Jane  41 y.o. F  Follow Up  MRN 1234567\n9:00 AM  Roe, Rick  63 yo M  New Patient\n1:15 PM  Poe, Ann   72 Female  Annual Wellness');
    assert.deepEqual(vs.map(v => v.slot), ['0830', '0900', '1315']);
    assert.deepEqual(vs.map(v => v.age), ['41', '63', '72']);
    assert.deepEqual(vs.map(v => v.sex), ['F', 'M', 'F']);
    assert.deepEqual(vs.map(v => v.type), ['follow-up', 'establish', 'annual']);
});
test('patient spread over lines', () => {
    const vs = extract('10:40 AM\nSmith, Bob\n55 y.o. male\nHospital Follow Up\n11:00 AM\nLee, Kim\n30 y.o. F\nSick visit');
    assert.equal(vs.length, 2);
    assert.deepEqual([vs[0].slot, vs[0].age, vs[0].sex, vs[0].type, vs[1].type], ['1040', '55', 'M', 'hospital', 'acute']);
});
test('keeps no names', () => { const s = JSON.stringify(extract('8:30 AM Doe, Jane 41 y.o. F Follow Up')); assert.ok(!s.includes('Doe') && !s.includes('Jane')); });
test('noon and midnight', () => assert.deepEqual(extract('12:00 PM x\n12:15 AM y').map(v => v.slot), ['1200', '0015']));

// ---- library
const all = Library.data.problems;
test('keys and names unique', () => {
    assert.equal(new Set(all.map(l => l.key)).size, all.length);
    assert.equal(new Set(all.map(l => l.name.toLowerCase())).size, all.length);
});
test('every entry offers a plan', () => all.forEach(l => assert.ok(l.plan?.length, l.name)));
test('status words valid', () => all.forEach(l => {
    assert.ok(!l.novelty || Note.NOVELTY.includes(l.novelty), l.name);
    assert.ok(!l.course || Note.COURSE.includes(l.course), l.name);
}));
test('chips are ASCII', () => all.forEach(l => {
    for (const s of [...(l.hpi || []), ...(l.notes || []), ...(l.plan || []), ...(l.fu || []), ...(l.ddx || []).flatMap(d => [d.label, ...d.items])])
        assert.ok(/^[\x00-\x7f]*$/.test(s), `${l.name}: ${s}`);
}));
test('search finds aliases', () => {
    assert.equal(Library.search('hypert')[0].key, 'htn');
    assert.equal(Library.search('diab')[0].key, 'dm2');
    assert.equal(Library.match('Hypertension').key, 'htn');
    assert.equal(Library.search('fat')[0].key, 'fatigue');
});

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
