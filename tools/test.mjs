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
    ap: `1. Fatigue
New
Chronic
Worsening
Incidental pituitary finding on prior imaging; labs not yet done
Prior cortisol confounded by IV steroid the day before
Denies recent steroid use
DDx:
>Non-hormonal: OSA, depression/anxiety (PHQ-9 negative), medication effect (fatigue, mood change), iron deficiency anemia
>Hormonal: hyperprolactinemia, central adrenal insufficiency, panhypopituitarism, perimenopause/estrogen insufficiency

- 8 AM serum cortisol with simultaneous ACTH, DHEA-S
- TSH, free T4, IGF-1, prolactin, estradiol, LH, FSH
- CBC, CMP, A1C, ferritin, iron panel
- Sleep study ordered

2. Left hand tingling
New
Acute
Stable
Seen by neurology; workup ongoing
Neurology recommends continuing current meds

- Continue current meds; defer changes for now

3. HTN
Known
Chronic
Stable

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
    assert.equal(t.ap, '1. Cough\n***\n***\n***\n\nF/u ***');
});
test('status lines print (unpicked = ***); health maintenance has none', () => {
    const l = Library.get('hm');
    assert.deepEqual(Note.problemLines(P({ name: l.name, lib: l.key, noStatus: true, plan: ['Tdap'] }), 4), ['4. Health maintenance', '- Tdap']);
    assert.deepEqual(Note.problemLines(P({ name: 'HTN', novelty: 'Known', course: 'Chronic', trend: 'Stable', notes: ['At goal'], plan: ['CONT x'] })),
        ['1. HTN', 'Known', 'Chronic', 'Stable', 'At goal', '', '- CONT x']);
});
test('unlabelled DDx is one line', () =>
    assert.ok(Note.problemLines(P({ name: 'Cough', ddx: [{ label: '', items: ['viral URI', 'GERD'] }] })).includes('DDx: viral URI, GERD')));
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
    assert.equal(fu({}), 'F/u ***');
});
test('parse round-trips', () => {
    const r = Note.parse('History of Present Illness\n' + expected.hpi + '\n\nAssessment/Plan\n' + expected.ap);
    assert.equal(r.age, '52'); assert.equal(r.sex, 'F');
    assert.deepEqual(r.problems.map(p => p.name), sample.problems.map(p => p.name));
    sample.problems.forEach((a, i) => {
        const b = r.problems[i];
        for (const k of ['novelty', 'course', 'trend', 'notes', 'ddx', 'plan']) assert.deepEqual(b[k], a[k], `${a.name}.${k}`);
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
test('still reads the old #problem format', () => {
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
    assert.equal(text(old).ap, 'F/u ***');
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
