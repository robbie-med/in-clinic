// In-Clinic web app: the day's panel, and one visit's editor that builds the note live as you tap.
// Same behaviour as the Android app (android/.../MainActivity.kt). No framework: small DOM helpers below.
import { Library } from './library.js';
import { Store } from './store.js';
import { extract } from './schedule.js';
import * as N from './note.js';
import * as B from './billing.js';

const app = document.getElementById('app');

// ================================================================ DOM helpers

function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    for (const [k, val] of Object.entries(props || {})) {
        if (val === undefined || val === null || val === false) continue;
        if (k === 'class') el.className = val;
        else if (k.startsWith('on')) el.addEventListener(k.slice(2), val);
        else if (k in el) el[k] = val;
        else el.setAttribute(k, val);
    }
    for (const kid of kids.flat()) if (kid !== null && kid !== undefined && kid !== false) el.append(kid);
    return el;
}

const chip = (label, onClick, cls = '') => h('button', { type: 'button', class: 'chip ' + cls, onclick: onClick }, label);
const pill = (label, on, onClick, cls = '') => chip(label, onClick, (on ? 'on ' : '') + cls);
const header = s => h('h2', { class: 'hd' }, s);
const sub = s => h('div', { class: 'sub' }, s);

/** Press-and-hold (iPad has no right click). Suppresses the click that follows a hold. */
function onHold(el, f) {
    let t = null; let held = false; let x0 = 0; let y0 = 0;
    el.addEventListener('pointerdown', e => {
        held = false; x0 = e.clientX; y0 = e.clientY;
        t = setTimeout(() => { held = true; t = null; navigator.vibrate?.(20); f(); }, 500);
    });
    const cancel = () => { if (t) clearTimeout(t); t = null; };
    el.addEventListener('pointerup', cancel);
    el.addEventListener('pointercancel', cancel);
    el.addEventListener('pointermove', e => { if (Math.abs(e.clientX - x0) > 10 || Math.abs(e.clientY - y0) > 10) cancel(); });
    el.addEventListener('click', e => { if (held) { e.stopImmediatePropagation(); e.preventDefault(); held = false; } }, true);
    el.addEventListener('contextmenu', e => e.preventDefault());
    return el;
}

/** Single-choice pills; tapping the picked one clears it. */
function choice(opts, cur, set, cls = 'flow') {
    const box = h('div', { class: cls });
    const draw = () => {
        box.replaceChildren(...opts.map(([k, label]) => pill(label, cur() === k, () => { set(cur() === k ? '' : k); draw(); })));
    };
    draw();
    return box;
}

let toastT = null;
function toast(s) {
    let el = document.getElementById('toast');
    if (!el) { el = h('div', { id: 'toast' }); document.body.append(el); }
    el.textContent = s; el.classList.add('show');
    clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove('show'), 1800);
}

/** Modal sheet. actions: [{label, cls, onClick}] — onClick returning false keeps it open. */
function modal({ title, body, actions = [], cancel = 'Cancel', onOpen }) {
    const close = () => { wrap.remove(); document.removeEventListener('keydown', esc); };
    const esc = e => { if (e.key === 'Escape') close(); };
    const buttons = h('div', { class: 'actions' },
        cancel ? chip(cancel, close) : null,
        actions.map(a => chip(a.label, () => { if (a.onClick() !== false) close(); }, a.cls || '')));
    const sheet = h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true' }, title ? h('h3', {}, title) : null, body, buttons);
    const wrap = h('div', { class: 'scrim', onclick: e => { if (e.target === wrap) close(); } }, sheet);
    document.body.append(wrap);
    document.addEventListener('keydown', esc);
    onOpen?.();
    return { close };
}

function focusSelect(input, text) {
    input.value = text;
    input.focus();
    const i = text.indexOf('***');
    if (i >= 0) input.setSelectionRange(i, i + 3); else input.setSelectionRange(text.length, text.length);
}

async function copyText(text, msg) {
    try { await navigator.clipboard.writeText(text); }
    catch {
        const t = h('textarea', { value: text, readOnly: true, style: 'position:fixed;opacity:0' });
        document.body.append(t); t.select(); document.execCommand('copy'); t.remove();
    }
    toast(msg);
}

const hm = ms => { const d = new Date(ms); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };

// ================================================================ routing

const go = hash => { if (location.hash !== hash) location.hash = hash; else route(); };
function route() {
    const m = /^#\/v\/(.+)$/.exec(location.hash);
    if (m && Store.find(m[1])) showVisit(m[1]); else showPanel();
}

// ================================================================ panel

function showPanel() {
    document.title = 'In-Clinic';
    const visits = Store.panel();
    const copied = visits.filter(v => v.copiedAt).length;
    const list = visits.length ? visits.map(visitCard) : [h('p', { class: 'empty' },
        'No visits yet. Tap + New visit in the room, or Import a pasted schedule tonight to pre-chart (only times, age, sex and visit type are kept).')];
    app.replaceChildren(h('div', { class: 'panel' },
        h('header', { class: 'top' }, h('h1', {}, 'In-Clinic'), chip('Import', () => importSchedule('')), chip('⋯', panelMenu)),
        header(`${visits.length} visits · ${copied} copied`),
        chip('+  New visit', () => { const v = N.newVisit(); Store.put(v); go('#/v/' + v.id); }, 'primary big'),
        h('div', { class: 'cards' }, list)));
}

function visitCard(x) {
    const what = [x.age + x.sex, N.type(x.type)?.label, x.cc].filter(s => s && s.trim()).join(' · ');
    const card = h('div', { class: 'card visit', tabIndex: 0, onclick: () => go('#/v/' + x.id), onkeydown: e => { if (e.key === 'Enter') go('#/v/' + x.id); } },
        h('div', { class: 'row' }, h('b', { class: 'slot' }, x.slot || '----'), h('span', { class: 'grow' }, what), h('span', { class: 'code' }, B.bill(x).code)),
        x.problems.length ? h('div', { class: 'dim' }, x.problems.map(p => '#' + p.name).join('  ')) : null,
        h('div', { class: x.copiedAt ? 'ok' : 'faint' }, x.copiedAt ? `✓ copied ${hm(x.copiedAt)}` : 'not copied yet'));
    return onHold(card, () => visitMenu(x));
}

function visitMenu(x) {
    modal({
        title: `${x.slot || 'Visit'} ${x.age}${x.sex}`, body: h('div'),
        actions: [
            { label: 'Delete visit', cls: 'danger', onClick: () => { if (confirm('Delete this visit?')) { Store.remove(x.id); showPanel(); } } },
        ],
    });
}

function panelMenu() {
    const m = modal({
        title: 'In-Clinic', cancel: 'Close',
        body: h('div', { class: 'menu' },
            chip('Import schedule…', () => { m.close(); importSchedule(''); }),
            chip('Clear panel (end of clinic)…', () => {
                const n = Store.visits().length; const un = Store.visits().filter(v => !v.copiedAt).length;
                if (confirm(`Clear all ${n} visits?` + (un ? `\n\n${un} notes were never copied.` : '') + '\n\nLearned chips are kept.')) { Store.clear(); m.close(); showPanel(); }
            }, 'danger'),
            chip('Signature…', () => { m.close(); editSignature(); }),
            chip('Copy learned chips (backup)', () => copyText(JSON.stringify(Store.learnedDump()), 'Learned chips copied')),
            chip('Restore learned chips…', () => { m.close(); restoreLearned(); }),
            h('p', { class: 'faint small' }, 'Everything stays on this device (browser storage). Visits are removed after 3 days or when you clear the panel.')),
    });
}

const signature = () => Store.setting('signature', '');

function editSignature(after) {
    const t = h('textarea', { rows: 4, value: signature(), placeholder: 'Name, MD\nPGY-2, Program\nPhone' });
    modal({ title: 'Signature', body: h('div', {}, t, h('p', { class: 'faint small' },
        'Printed above the attestation in the Signature section. Stored on this device only.')),
    onOpen: () => t.focus(), actions: [{ label: 'Save', cls: 'primary', onClick: () => { Store.setSetting('signature', t.value.trim()); after?.(); } }] });
}

function restoreLearned() {
    const t = h('textarea', { rows: 6, placeholder: 'Paste a learned-chips backup' });
    modal({ title: 'Restore learned chips', body: t, actions: [{ label: 'Restore', cls: 'primary', onClick: () => {
        try { toast(`Restored ${Store.learnedRestore(JSON.parse(t.value))} lists`); } catch { toast('Not a valid backup'); return false; }
    } }], onOpen: () => t.focus() });
}

function importSchedule(prefill) {
    const pv = h('div', { class: 'dim small' });
    const t = h('textarea', { rows: 7, value: prefill, placeholder: 'Paste the schedule (8:30 AM … 41 y.o. F … Follow Up)' });
    const preview = () => {
        const vs = extract(t.value);
        pv.textContent = vs.length ? `${vs.length} visits: ` + vs.map(v => `${v.slot} ${v.age}${v.sex} ${N.type(v.type)?.label || ''}`.trim()).join(', ') : 'No times found';
    };
    t.addEventListener('input', preview); preview();
    modal({
        title: 'Import schedule',
        body: h('div', {}, t, pv, h('p', { class: 'faint small' }, 'Only time, age, sex and visit type are kept. Names, MRNs and DOBs are dropped.')),
        actions: [{ label: 'Add', cls: 'primary', onClick: () => { const vs = extract(t.value); Store.putAll(vs); toast(`Added ${vs.length} visits`); showPanel(); } }],
        onOpen: () => t.focus(),
    });
}

// ================================================================ visit editor

let v = null;
const expanded = new Set();
let openId = null;
const R = {};   // live elements: note, oneLiner, title, problems, hpi, fu

function update(f) {
    v = f(v);
    Store.put(v);
    refresh();
}

function refresh() {
    const secs = N.sections(v, signature());
    R.note.replaceChildren(...secs.map(sectionCard));
    R.copyBar.replaceChildren(...secs.map(s => chip(s.short, () => copySection(s), 'grow' + (copiedNow(s) ? ' done' : ''))));
    R.oneLiner.textContent = N.oneLiner(v);
    R.title.textContent = [v.slot, v.age + v.sex].filter(s => s.trim()).join(' · ') || 'New visit';
    const b = B.bill(v);
    R.badge.textContent = b.code;
    R.drawBilling(b);
    for (const sel of R.problems.querySelectorAll('select.cx')) {
        const p = v.problems.find(x => x.id === sel.dataset.id);
        if (p) sel.options[0].text = 'MDM: auto · ' + B.cx(B.autoCx(p)).label;
    }
}

/** Copied, and unchanged since. */
const copiedNow = s => (v.copied || {})[s.key] === s.text;

function sectionCard(s) {
    const done = copiedNow(s); const stale = !done && (v.copied || {})[s.key] !== undefined;
    return h('section', { class: 'sec' },
        h('div', { class: 'row gap' },
            h('span', { class: 'sectitle grow' }, s.title),
            s.key === 'sign' ? chip(signature() ? 'Edit signature' : 'Set signature', () => editSignature(refresh), 'small link') : null,
            chip(done ? 'Copied ✓' : stale ? 'Copy again' : 'Copy', () => copySection(s), 'small ' + (done ? 'done' : 'primary'))),
        h('pre', { class: 'note' }, s.text));
}

const libs = () => v.problems.map(p => Library.get(p.lib)).filter(Boolean);

function field(placeholder, value, onInput, props = {}) {
    const el = h('input', { type: 'text', placeholder, value, autocomplete: 'off', ...props });
    el.addEventListener('input', () => onInput(el.value));
    return el;
}

function showVisit(id) {
    v = Store.find(id);
    if (openId !== id) expanded.clear();
    openId = id;

    R.title = h('b', { class: 'title' });
    R.oneLiner = h('button', { type: 'button', class: 'oneliner', onclick: editOneLiner });
    R.note = h('div', { class: 'secs' });
    R.copyBar = h('div', { class: 'row gap grow' });
    R.badge = chip('', () => R.billing.scrollIntoView({ behavior: 'smooth', block: 'start' }), 'badge');
    R.problems = h('div', { class: 'problems' });

    const lib = Library.data;
    R.hpi = Lines({
        get: () => v.hpi, set: l => update(x => ({ ...x, hpi: l })),
        chips: () => [...lib.hpiGeneric, ...libs().flatMap(l => l.hpi || [])],
        placeholder: 'Complains of… (type or dictate, Enter adds)',
    });
    R.fu = Lines({
        get: () => v.fuWhy, set: l => update(x => ({ ...x, fuWhy: l })),
        chips: () => [...lib.fuGeneric, ...libs().flatMap(l => l.fu || [])],
        learnKey: () => 'fu', kind: 'fu', placeholder: 'to… e.g. confirm sleep study scheduled',
    });

    const editor = h('div', { class: 'editor' },
        header('Visit'),
        h('div', { class: 'row gap' },
            field('Time 0830', v.slot, s => update(x => ({ ...x, slot: s.trim() })), { inputMode: 'numeric', class: 'grow' }),
            field('Age', v.age, s => update(x => ({ ...x, age: s.trim() })), { inputMode: 'numeric', class: 'grow' }),
            choice([['F', 'F'], ['M', 'M']], () => v.sex, s => update(x => ({ ...x, sex: s })), 'row')),
        choice(N.RELATIONS.map(r => [r, r]), () => v.relation, s => update(x => ({ ...x, relation: s }))),
        choice(N.TYPES.map(t => [t.key, t.label]), () => v.type, s => update(x => ({ ...x, type: s }))),
        field('Chief complaint, e.g. fatigue', v.cc, s => update(x => ({ ...x, cc: s })), { autocapitalize: 'none', class: 'wide' }),
        R.oneLiner,

        header('HPI'), R.hpi.el,

        header('Exam'), examView(),

        h('div', { class: 'row' }, header('Plan'), h('span', { class: 'grow' }), chip('+ Problem', addProblem, 'primary')),
        R.problems,
        chip('+ Problem', addProblem, 'ghost'),

        header('Follow-up'),
        fuWithView(),
        choice(lib.fuWhen.map(w => [w, w]), () => v.fuWhen, s => update(x => ({ ...x, fuWhen: s }))),
        R.fu.el,

        billingView(),
        h('div', { class: 'narrow-only' }, header('Note')),
    );
    // One live note element: under the editor on narrow screens, in the side column on wide ones (iPad landscape)
    const below = editor.lastElementChild;
    const sideNote = h('div', { class: 'side-note' });
    const side = h('aside', { class: 'side' }, sideNote);
    const wideQ = matchMedia('(min-width: 900px)');
    const placeNote = () => (wideQ.matches ? sideNote : below).append(R.note);

    app.replaceChildren(h('div', { class: 'visit-view' },
        h('header', { class: 'top' },
            chip('‹', () => go('#/'), 'back'), R.title, h('span', { class: 'grow' }), R.badge, chip('Paste last note', pasteLast), chip('Share', share)),
        h('div', { class: 'layout' }, editor, side),
        h('footer', { class: 'bar' },
            h('span', { class: 'faint small' }, 'Copy'), R.copyBar,
            chip('↓', () => R.note.scrollIntoView({ behavior: 'smooth', block: 'start' })))));
    placeNote();
    wideQ.onchange = () => { if (R.note.isConnected) placeNote(); };

    drawProblems();
    refresh();
    window.scrollTo(0, 0);
}

/** Physical exam (from the On-Call app): vitals fields, then per system nL in one tap or abnL findings. */
function examView() {
    const box = h('div', { class: 'exam' });
    const vitals = h('div', { class: 'vitals' }, Library.data.vitals.map(k => {
        const el = h('input', { type: 'text', placeholder: k, value: (v.vitals || {})[k] || '', autocomplete: 'off', 'aria-label': k });
        el.addEventListener('input', () => update(x => N.withVital(x, k, el.value)));
        return el;
    }));
    const systems = h('div');
    const addOther = s => {
        const t = h('input', { type: 'text', placeholder: 'Finding' });
        modal({ title: s.name, body: t, onOpen: () => t.focus(), actions: [{ label: 'Add', cls: 'primary', onClick: () => {
            const f = t.value.trim();
            if (f && !((v.exam || {})[s.name] || []).includes(f)) { update(x => N.examToggle(x, s.name, f)); draw(); }
        } }] });
    };
    function draw() {
        systems.replaceChildren(...Library.data.exam.map(s => {
            const picked = (v.exam || {})[s.name] || [];
            const nl = picked.length === 1 && picked[0] === N.NL;
            const extras = picked.filter(x => x !== N.NL && !s.abnormal.includes(x));
            return h('div', { class: 'sys' },
                h('div', { class: 'sysname' }, s.name),
                h('div', { class: 'flow' },
                    pill('nL · ' + s.normal, nl, () => { update(x => N.examToggle(x, s.name, N.NL)); draw(); }, 'small'),
                    [...s.abnormal, ...extras].map(a => pill(a, picked.includes(a), () => { update(x => N.examToggle(x, s.name, a)); draw(); }, 'small')),
                    chip('+ other', () => addOther(s), 'small link')));
        }));
    }
    draw();
    box.append(vitals,
        h('div', { class: 'flow' },
            chip('All untouched → nL', () => { update(N.examAllNormal); draw(); }, 'primary'),
            chip('Clear exam', () => { update(x => ({ ...x, exam: {} })); draw(); })),
        systems);
    return box;
}

function drawProblems() {
    R.problems.replaceChildren(...(v.problems.length ? v.problems.map(p => problemCard(p.id))
        : [h('p', { class: 'empty' }, 'No problems yet. + Problem, or Paste last note to carry the old plan forward.')]));
    R.hpi.draw(); R.fu.draw();
}

function problemCard(id) {
    const p0 = v.problems.find(p => p.id === id);
    const lib = Library.get(p0.lib);
    const cur = () => v.problems.find(p => p.id === id);
    const upd = f => { const p = cur(); if (p) update(x => ({ ...x, problems: x.problems.map(q => (q.id === id ? f(p) : q)) })); };
    const open = expanded.has(id);

    const card = h('section', { class: 'card problem' },
        h('div', { class: 'row' },
            h('button', { type: 'button', class: 'pname', onclick: () => problemMenu(id) }, '#' + p0.name),
            h('span', { class: 'grow' }),
            chip(open ? '▴ less' : '▾ more', () => toggleOpen(id), 'small'),
            chip('⋯', () => problemMenu(id), 'small')));
    if (!p0.noStatus) card.append(
        choice(N.NOVELTY.map(s => [s, s]), () => cur()?.novelty || '', s => upd(p => ({ ...p, novelty: s }))),
        choice(N.COURSE.map(s => [s, s]), () => cur()?.course || '', s => upd(p => ({ ...p, course: s }))),
        choice(N.TREND.map(s => [s, s]), () => cur()?.trend || '', s => upd(p => ({ ...p, trend: s }))));
    const sel = h('select', { class: 'cx', 'aria-label': 'MDM complexity', onchange: () => upd(p => ({ ...p, cx: sel.value })) },
        h('option', { value: '' }, 'MDM: auto · ' + B.cx(B.autoCx(p0)).label),
        B.CX.map(c => h('option', { value: c.key }, 'MDM: ' + c.label)));
    sel.dataset.id = id; sel.value = p0.cx || '';
    card.append(sel);

    if (!open) {
        const rest = N.problemLines(p0).slice(p0.noStatus ? 1 : 4).join('\n').trim();
        card.append(h('pre', { class: 'mini' + (rest ? '' : ' faint'), onclick: () => toggleOpen(id) }, rest || 'Tap to add notes, DDx, plan'));
        return card;
    }
    card.append(
        sub('Notes'),
        Lines({ get: () => cur()?.notes || [], set: l => upd(p => ({ ...p, notes: l })), chips: () => lib?.notes || [],
            placeholder: 'Supporting line (history, data)' }).el,
        ddxView(id, lib),
        sub('Plan'),
        Lines({ get: () => cur()?.plan || [], set: l => upd(p => ({ ...p, plan: l })), chips: () => lib?.plan || [],
            learnKey: () => (cur() ? N.learnKey(cur()) : null), kind: 'plan', placeholder: 'Order / action (Enter adds)',
            prefixes: Library.data.medVerbs, dash: true }).el);
    return card;
}

function toggleOpen(id) {
    if (expanded.has(id)) expanded.delete(id); else expanded.add(id);
    drawProblems();
}

function ddxView(id, lib) {
    const box = h('div', { class: 'ddx' });
    const p = () => v.problems.find(x => x.id === id);
    const set = (label, items) => { const x = p(); if (x) update(vv => ({ ...vv, problems: vv.problems.map(q => (q.id === id ? N.withDdx(x, label, items) : q)) })); };
    const annotate = (label, item) => {
        const t = h('input', { type: 'text', value: item });
        modal({ title: 'Edit DDx item', body: t, onOpen: () => t.focus(), actions: [
            { label: 'Remove', cls: 'danger', onClick: () => { set(label, N.ddxItems(p(), label).filter(i => i !== item)); draw(); } },
            { label: 'Save', cls: 'primary', onClick: () => {
                const s = t.value.trim();
                set(label, N.ddxItems(p(), label).flatMap(i => (i === item ? (s ? [s] : []) : [i]))); draw();
            } },
        ] });
    };
    const addItems = label => {
        const lab = h('input', { type: 'text', placeholder: 'Group label (optional), e.g. Hormonal' });
        const items = h('input', { type: 'text', placeholder: 'Items, comma-separated' });
        modal({ title: label === null ? 'New DDx group' : 'Add to ' + (label || 'DDx'), body: h('div', { class: 'stack' }, label === null ? lab : null, items),
            onOpen: () => items.focus(), actions: [{ label: 'Add', cls: 'primary', onClick: () => {
                const l = label === null ? lab.value.trim() : label;
                const add = N.split(items.value);
                if (add.length) { set(l, [...N.ddxItems(p(), l), ...add]); draw(); }
            } }] });
    };
    function draw() {
        const x = p(); if (!x) return;
        const labels = [...new Set([...(lib?.ddx || []).map(g => g.label), ...x.ddx.map(g => g.label)])];
        box.replaceChildren(sub('DDx' + (labels.length ? ' · tap to include · hold to annotate' : '')));
        for (const g of labels) {
            if (g) box.append(h('div', { class: 'glabel' }, '>' + g));
            const opts = (lib?.ddx || []).find(d => d.label === g)?.items || [];
            const chosen = N.ddxItems(x, g);
            const matchOf = o => chosen.find(c => c === o || c.startsWith(o + ' ('));
            const flow = h('div', { class: 'flow' });
            for (const o of opts) {
                const m = matchOf(o);
                const c = pill(m || o, !!m, () => { set(g, m ? chosen.filter(i => i !== m) : [...chosen, o]); draw(); }, 'small');
                if (m) onHold(c, () => annotate(g, m));
                flow.append(c);
            }
            for (const extra of chosen.filter(c => !opts.some(o => c === o || c.startsWith(o + ' (')))) {
                flow.append(onHold(pill(extra, true, () => { set(g, chosen.filter(i => i !== extra)); draw(); }, 'small'), () => annotate(g, extra)));
            }
            flow.append(chip('+ other', () => addItems(g), 'small link'));
            box.append(flow);
        }
        box.append(chip('+ DDx group', () => addItems(null), 'small link'));
    }
    draw();
    return box;
}

function problemMenu(id) {
    const p = v.problems.find(x => x.id === id); if (!p) return;
    const i = v.problems.findIndex(x => x.id === id);
    const move = d => {
        const j = i + d; if (j < 0 || j >= v.problems.length) return;
        const l = [...v.problems]; [l[i], l[j]] = [l[j], l[i]];
        update(x => ({ ...x, problems: l })); drawProblems();
    };
    const name = h('input', { type: 'text', value: p.name });
    const close = () => dlg.close();
    const dlg = modal({
        title: '#' + p.name, cancel: 'Close',
        body: h('div', { class: 'stack' }, name,
            h('div', { class: 'flow' },
                chip('Rename', () => { const n = name.value.trim().replace(/^#/, ''); if (n) { update(x => ({ ...x, problems: x.problems.map(q => (q.id === id ? { ...q, name: n } : q)) })); drawProblems(); close(); } }, 'primary'),
                chip('Move up', () => { move(-1); close(); }),
                chip('Move down', () => { move(1); close(); }),
                chip(p.noStatus ? 'Show status lines' : 'No status lines', () => { update(x => ({ ...x, problems: x.problems.map(q => (q.id === id ? { ...q, noStatus: !q.noStatus } : q)) })); drawProblems(); close(); }),
                chip('Remove problem', () => { update(x => ({ ...x, problems: x.problems.filter(q => q.id !== id) })); drawProblems(); close(); }, 'danger'))),
    });
}

function addProblem() {
    const q = h('input', { type: 'text', placeholder: 'Search or type a new problem', autocomplete: 'off', enterKeyHint: 'done' });
    const results = h('div', { class: 'results' });
    let first = null;
    let dlg = null;
    const add = p => {
        dlg.close();
        expanded.add(p.id);
        update(x => ({ ...x, problems: [...x.problems, p] }));
        drawProblems();
        R.problems.lastElementChild?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
    const fromLib = l => N.newProblem({ name: l.name, lib: l.key, novelty: l.novelty || '', course: l.course || '', noStatus: !!l.noStatus });
    const draw = () => {
        const s = q.value.trim();
        const rows = [];
        for (const l of Library.search(s)) rows.push([l.name, (l.aliases || []).slice(0, 2).join(', '), () => add(fromLib(l))]);
        for (const n of Store.customProblems().filter(n => !s || n.toLowerCase().includes(s.toLowerCase()))) rows.push([n, 'yours', () => add(N.newProblem({ name: n }))]);
        if (s && !Library.match(s) && !Store.customProblems().some(n => n.toLowerCase() === s.toLowerCase())) {
            // Enter takes the first row: a library / earlier match when there is one, else this new problem
            rows.push([`+ Add "${s}"`, '', () => { Store.learn('names', 'problem', s); add(N.newProblem({ name: s })); }, 'accent']);
        }
        first = rows[0]?.[2] || null;
        results.replaceChildren(...rows.map(([t, note, f, cls]) =>
            h('button', { type: 'button', class: 'result ' + (cls || ''), onclick: f }, t, note ? h('span', { class: 'faint' }, '  ·  ' + note) : null)));
    };
    q.addEventListener('input', draw);
    q.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); first?.(); } });
    draw();
    dlg = modal({ title: 'Add problem', body: h('div', {}, q, results), onOpen: () => q.focus() });
}

function editOneLiner() {
    const t = h('textarea', { rows: 3, value: N.oneLiner(v) });
    modal({ title: 'One-liner', body: t, onOpen: () => t.focus(), actions: [
        { label: 'Use generated', onClick: () => update(x => ({ ...x, oneLiner: '' })) },
        { label: 'Save', cls: 'primary', onClick: () => {
            const s = t.value.trim();
            update(x => ({ ...x, oneLiner: s === N.oneLiner({ ...x, oneLiner: '' }) ? '' : s }));
        } },
    ] });
}

/** Paste the last note → its problems come back as Known, trend cleared, plan and notes kept. */
function pasteLast() {
    const t = h('textarea', { rows: 10, placeholder: 'Paste the previous note (its Assessment/Plan with numbered problems)' });
    modal({
        title: 'Carry forward',
        body: h('div', {}, h('p', { class: 'dim small' }, 'Problems become Known; trend is cleared for today. Plan, notes and DDx are kept to edit.'), t),
        onOpen: () => t.focus(),
        actions: [{ label: 'Carry forward', cls: 'primary', onClick: () => {
            const parsed = N.parse(t.value);
            const have = new Set(v.problems.map(p => p.name.toLowerCase()));
            const add = N.carryForward(parsed.problems).filter(p => !have.has(p.name.toLowerCase()));
            update(x => ({ ...x, problems: [...x.problems, ...add], age: x.age || parsed.age, sex: x.sex || parsed.sex }));
            showVisit(v.id);   // age/sex fields too
            toast(add.length ? `Added ${add.length} problems` : 'No problems found');
        } }],
    });
}

/** Copies one section and remembers its text, so the button shows when it changed since. */
function copySection(s) {
    copyText(s.text, s.title + ' copied');
    update(y => ({ ...y, copied: { ...(y.copied || {}), [s.key]: s.text }, copiedAt: Date.now() }));
}

/** F/u with: typed, or a remembered name (hold to forget). */
function fuWithView() {
    const input = field('With… e.g. Dr. Richard', v.fuWith || '', s => update(x => ({ ...x, fuWith: s })), { class: 'wide' });
    const box = h('div', { class: 'flow' });
    const draw = () => box.replaceChildren(...Store.learned('fu', 'with').map(n => {
        const el = pill(n, (v.fuWith || '').trim() === n, () => {
            const nv = (v.fuWith || '').trim() === n ? '' : n;
            input.value = nv; update(x => ({ ...x, fuWith: nv })); draw();
        }, 'small learned');
        return onHold(el, () => { if (confirm(`Forget "${n}"?`)) { Store.forget('fu', 'with', n); draw(); } });
    }));
    input.addEventListener('change', () => { if (input.value.trim()) Store.learn('fu', 'with', input.value.trim()); draw(); });
    draw();
    return h('div', {}, input, box);
}

/**
 * Billing: the E/M level, recalculated on every change (billing.js). Problems come from the status pills
 * (or each problem's MDM menu), risk from the plan, data from the counters here.
 */
function billingView() {
    const box = h('div', { class: 'billing' });
    R.billing = h('div', {}, header('Billing'), box);
    const setData = f => update(x => ({ ...x, data: f({ ...B.emptyData(), ...(x.data || {}) }) }));
    const counter = (label, value, set, note, reset) => h('div', { class: 'counter' },
        h('span', { class: 'grow' }, label, note ? h('span', { class: 'faint small' }, '  ' + note) : null),
        reset ? chip('auto', reset, 'small link') : null,
        chip('−', () => set(Math.max(0, value - 1)), 'small sq'),
        h('b', { class: 'num' }, String(value)),
        chip('+', () => set(value + 1), 'small sq'));
    const row = (name, part) => h('div', { class: 'brow' },
        h('span', { class: 'bname' }, name), h('b', { class: 'blvl l' + part.lvl }, B.LEVELS[part.lvl]), h('span', { class: 'dim small grow' }, part.why.join('; ')));
    R.drawBilling = b => {
        const d = { ...B.emptyData(), ...(v.data || {}) };
        const auto = d.ordered === null || d.ordered === undefined;
        box.replaceChildren(
            h('div', { class: 'bcode' }, h('b', {}, b.code), h('span', {}, `${B.LEVELS[b.mdm]} MDM · ${b.kind === 'new' ? 'new' : 'established'} patient`
                + (b.overridden ? ` · set by hand (calc ${b.auto})` : '')),
            h('span', { class: 'faint small' }, b.pce ? 'Attestation: primary care exception' : 'Attestation: teaching physician present')),
            row('Problems', b.problems), row('Data', b.data), row('Risk', b.risk),
            sub('Data'),
            counter('Tests ordered', b.data.ordered, n => setData(x => ({ ...x, ordered: n })), auto ? (b.data.auto.length ? 'auto from plan' : 'auto') : '',
                auto ? null : () => setData(x => ({ ...x, ordered: null }))),
            counter('Results reviewed', d.reviewed, n => setData(x => ({ ...x, reviewed: n })), 'not ones ordered today'),
            counter('External notes', d.external, n => setData(x => ({ ...x, external: n })), 'per unique source'),
            h('div', { class: 'flow' },
                pill('Independent historian', d.historian, () => setData(x => ({ ...x, historian: !x.historian })), 'small'),
                pill('Independent interpretation', d.interp, () => setData(x => ({ ...x, interp: !x.interp })), 'small'),
                pill('Discussed w/ external MD', d.discuss, () => setData(x => ({ ...x, discuss: !x.discuss })), 'small')),
            sub('Risk'),
            h('div', { class: 'flow' },
                pill('Auto', !v.risk, () => update(x => ({ ...x, risk: '' })), 'small'),
                B.RISKS.map(r => pill(r[0].toUpperCase() + r.slice(1), v.risk === r, () => update(x => ({ ...x, risk: x.risk === r ? '' : r })), 'small')),
                pill('SDOH limits dx/tx', !!v.sdoh, () => update(x => ({ ...x, sdoh: !x.sdoh })), 'small')),
            sub('Bill as'),
            h('div', { class: 'flow' },
                pill('Auto · ' + b.auto, !b.overridden, () => update(x => ({ ...x, code: '' })), 'small'),
                B.CODES[b.kind].map(c => pill(c, b.overridden && b.code === c, () => update(x => ({ ...x, code: x.code === c ? '' : c })), 'small'))),
            h('p', { class: 'faint small' }, 'Teaching physician not physically present → bill 99213 / 99203 or lower (primary care exception). ' +
                'Suggestion only; you pick the code.'));
    };
    return R.billing;
}

async function share() {
    const text = N.render(v, signature());
    if (navigator.share) { try { await navigator.share({ text }); } catch { /* cancelled */ } } else copyText(text, 'Note copied');
}

// ================================================================ line lists

/**
 * Editable list of lines (HPI, a problem's notes / plan, follow-up reasons). Tap a row to edit, move or delete it.
 * Chips toggle that line in or out; a chip with *** goes into the field with the blank selected so you type over it.
 * Prefix chips (med verbs) start the field. Enter adds what's typed and keeps the keyboard up for the next line.
 * With a learnKey, typed lines are remembered and come back as chips (hold one to forget it).
 */
function Lines({ get, set, chips, learnKey = () => null, kind = '', placeholder, prefixes = [], dash = false }) {
    const rows = h('div', { class: 'rows' });
    const chipBox = h('div', { class: 'flow' });
    const input = h('input', { type: 'text', placeholder, autocomplete: 'off', enterKeyHint: 'enter', autocapitalize: 'sentences' });
    const add = () => {
        const t = input.value.trim(); if (!t) return;
        set([...get(), t]);
        const k = learnKey(); if (k) Store.learn(k, kind, t);
        input.value = '';
        draw();
        input.focus();
    };
    input.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); add(); } });

    const edit = i => {
        const s = get()[i]; if (s === undefined) return;
        const t = h('textarea', { rows: 3, value: s });
        modal({ body: t, onOpen: () => { t.focus(); const j = s.indexOf('***'); if (j >= 0) t.setSelectionRange(j, j + 3); }, actions: [
            { label: 'Move up', onClick: () => { if (i > 0) { const l = [...get()]; [l[i - 1], l[i]] = [l[i], l[i - 1]]; set(l); draw(); } } },
            { label: 'Delete', cls: 'danger', onClick: () => { set(get().filter((_, j) => j !== i)); draw(); } },
            { label: 'Save', cls: 'primary', onClick: () => {
                const n = t.value.trim();
                set(n ? get().map((x, j) => (j === i ? n : x)) : get().filter((_, j) => j !== i)); draw();
            } },
        ] });
    };

    function draw() {
        rows.replaceChildren(...get().map((s, i) => h('button', { type: 'button', class: 'line', onclick: () => edit(i) }, (dash ? '- ' : '• ') + s)));
        const cur = get(); const base = chips(); const key = learnKey();
        const learned = key ? Store.learned(key, kind).filter(c => !base.includes(c)) : [];
        chipBox.replaceChildren(...[...new Set([...base, ...learned])].map(c => {
            const blank = c.includes('***'); const on = cur.includes(c);
            const el = pill(c, on, () => {
                if (blank && !on) focusSelect(input, c);
                else { set(on ? cur.filter(x => x !== c) : [...cur, c]); draw(); }
            }, 'small' + (blank && !on ? ' blank' : '') + (learned.includes(c) ? ' learned' : ''));
            if (key && learned.includes(c)) onHold(el, () => { if (confirm(`Forget "${c}"?`)) { Store.forget(key, kind, c); draw(); } });
            return el;
        }));
    }

    const el = h('div', { class: 'lines' },
        rows,
        h('div', { class: 'row gap addrow' }, input, chip('+', add, 'primary sq')),
        prefixes.length ? h('div', { class: 'flow' }, prefixes.map(p => chip(p.trim(), () => {
            const t = input.value; const pre = prefixes.find(x => t.startsWith(x));
            input.value = p + (pre ? t.slice(pre.length) : t);
            input.focus(); input.setSelectionRange(input.value.length, input.value.length);
        }, 'small link'))) : null,
        chipBox);
    draw();
    return { el, draw };
}

// ================================================================ boot

async function boot() {
    try {
        Library.load(await (await fetch('library.json')).json());
    } catch {
        app.replaceChildren(h('p', { class: 'empty' }, 'Could not load the problem library. Open the app once while online.'));
        return;
    }
    window.addEventListener('hashchange', route);
    route();
    if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
    navigator.storage?.persist?.();
}
boot();
