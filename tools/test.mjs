#!/usr/bin/env node
// Web app logic tests (same cases as android/app/src/test). Run: node tools/test.mjs
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { Library } from '../js/library.js';
import * as Note from '../js/note.js';
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

const expected = `52F known to me here for follow-up of fatigue.

Complains of fatigue, poor sleep and low mood for several months
Recently moved; new commute
Denies significant stress; does not explain all symptoms
LMP 2 wk ago

PLAN

#Fatigue
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

#Left hand tingling
New
Acute
Stable
Seen by neurology; workup ongoing
Neurology recommends continuing current meds

- Continue current meds; defer changes for now

#HTN
Known
Chronic
Stable

- CONT amlodipine 5 mg PO daily

Follow-up: 2 wk to review labs and confirm sleep study scheduled.`;

// ---- note
test('renders the user\'s format', () => assert.equal(Note.render(sample), expected));
test('blanks become Epic wildcards', () => assert.equal(Note.render(Note.newVisit({ problems: [P({ name: 'Cough' })] })),
    '*** known to me here for follow-up.\n\nPLAN\n\n#Cough\n***\n***\n***\n\nFollow-up: ***.'));
test('health maintenance has no status lines', () => {
    const l = Library.get('hm');
    assert.deepEqual(Note.problemLines(P({ name: l.name, lib: l.key, noStatus: !!l.noStatus, plan: ['Tdap'] })), ['#Health maintenance', '', '- Tdap']);
});
test('unlabelled DDx is one line', () =>
    assert.ok(Note.problemLines(P({ name: 'Cough', ddx: [{ label: '', items: ['viral URI', 'GERD'] }] })).includes('DDx: viral URI, GERD')));
test('one-liner variants', () => {
    assert.equal(Note.oneLiner(Note.newVisit({ age: '63', sex: 'M', relation: 'new to me', type: 'establish' })), '63M new to me here to establish care.');
    assert.equal(Note.oneLiner(Note.newVisit({ age: '28', sex: 'F', type: 'acute', cc: 'cough x5 days' })), '28F known to me here with cough x5 days.');
    assert.equal(Note.oneLiner(Note.newVisit({ oneLiner: 'Typed by hand.' })), 'Typed by hand.');
});
test('parse round-trips', () => {
    const r = Note.parse(expected);
    assert.equal(r.age, '52'); assert.equal(r.sex, 'F');
    assert.deepEqual(r.problems.map(p => p.name), sample.problems.map(p => p.name));
    sample.problems.forEach((a, i) => {
        const b = r.problems[i];
        for (const k of ['novelty', 'course', 'trend', 'notes', 'ddx', 'plan']) assert.deepEqual(b[k], a[k], `${a.name}.${k}`);
    });
});
test('parses the user\'s paste with its stray spacing', () => {
    const ps = Note.parse(expected.replace('Stable\n', 'Stable \n\n').replace('\n#HTN', '\n\n#HTN')).problems;
    assert.equal(ps.length, 3); assert.equal(ps[1].trend, 'Stable');
    assert.deepEqual(ps[1].notes, ['Seen by neurology; workup ongoing', 'Neurology recommends continuing current meds']);
    assert.deepEqual(ps[2].plan, ['CONT amlodipine 5 mg PO daily']);
});
test('carry forward: Known, trend cleared, library reattached', () => {
    const ps = Note.carryForward(Note.parse(expected).problems);
    assert.ok(ps.every(p => p.novelty === 'Known' && p.trend === ''));
    assert.equal(ps[2].lib, 'htn'); assert.equal(ps[0].lib, 'fatigue');
});
test('split keeps parentheses', () =>
    assert.deepEqual(Note.split('OSA, medication effect (fatigue, mood change), IDA'), ['OSA', 'medication effect (fatigue, mood change)', 'IDA']));

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
