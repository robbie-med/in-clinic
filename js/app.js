// In-Clinic web app: the day's panel, and one visit's editor that builds the note live as you tap.
// Same behaviour as the Android app (android/.../MainActivity.kt). No framework: small DOM helpers below.
import { Library } from './library.js';
import { Store } from './store.js';
import { extract } from './schedule.js';
import * as N from './note.js';
import * as B from './billing.js';
import { Dot, picks, unfilled } from './dot.js';

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

const chip = (label, onClick, cls = '', props = {}) => h('button', { type: 'button', class: 'chip ' + cls, onclick: onClick, ...props }, label);
const pill = (label, on, onClick, cls = '', props = {}) => chip(label, onClick, (on ? 'on ' : '') + cls, { 'aria-pressed': String(!!on), ...props });
const sub = s => h('div', { class: 'sub' }, s);
const grow = () => h('span', { class: 'grow' });

/**
 * Press-and-hold on touch; right-click with a mouse (desktop). Suppresses the click that follows a hold.
 * Touch long-press also fires contextmenu on some browsers, so only a mouse's contextmenu runs f.
 */
function onHold(el, f) {
    let t = null; let held = false; let x0 = 0; let y0 = 0; let mouse = false;
    el.addEventListener('pointerdown', e => {
        held = false; x0 = e.clientX; y0 = e.clientY; mouse = e.pointerType === 'mouse';
        if (mouse) return;
        t = setTimeout(() => { held = true; t = null; navigator.vibrate?.(20); f(); }, 500);
    });
    const cancel = () => { if (t) clearTimeout(t); t = null; };
    el.addEventListener('pointerup', cancel);
    el.addEventListener('pointercancel', cancel);
    el.addEventListener('pointermove', e => { if (Math.abs(e.clientX - x0) > 10 || Math.abs(e.clientY - y0) > 10) cancel(); });
    el.addEventListener('click', e => { if (held) { e.stopImmediatePropagation(); e.preventDefault(); held = false; } }, true);
    el.addEventListener('contextmenu', e => { e.preventDefault(); if (mouse) f(); });
    return el;
}

/** Single-choice pills that wrap; tapping the picked one clears it. */
function choice(opts, cur, set, cls = 'flow') {
    const box = h('div', { class: cls });
    const draw = () => {
        box.replaceChildren(...opts.map(([k, label]) => pill(label, cur() === k, () => { set(cur() === k ? '' : k); draw(); })));
    };
    draw();
    return box;
}

/** Segmented control (a few short, mutually exclusive options); tapping the picked one clears it. */
function seg(opts, cur, set, cls = '', label = '') {
    const box = h('div', { class: 'seg ' + cls, role: 'group', 'aria-label': label || null });
    const draw = () => {
        box.replaceChildren(...opts.map(([k, text]) => h('button', {
            type: 'button', class: 'segb' + (cur() === k ? ' on' : ''), 'aria-pressed': String(cur() === k),
            onclick: () => { set(cur() === k ? '' : k); draw(); },
        }, text)));
    };
    draw();
    return box;
}

/** Text input with its label inside the box, so a filled field still says what it is (vitals, time, age). */
function lfield(label, value, onInput, props = {}, cls = '') {
    const input = h('input', { type: 'text', value, autocomplete: 'off', ...props });
    input.addEventListener('input', () => onInput(input.value));
    const wrap = h('label', { class: 'lf ' + cls }, h('span', {}, label), input);
    wrap.input = input;
    return wrap;
}

/** One section of the visit editor; the tabs in the header jump to it. */
const block = (key, title, actions, ...body) => h('section', { class: 'blk', id: 's-' + key, 'data-sec': key },
    h('div', { class: 'blkhd' }, h('h2', { class: 'hd' }, title), grow(), actions || null), ...body);

let toastT = null;
function toast(s) {
    let el = document.getElementById('toast');
    if (!el) { el = h('div', { id: 'toast' }); document.body.append(el); }
    el.textContent = s; el.classList.add('show');
    clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove('show'), 1800);
}

/**
 * Modal sheet. actions: [{label, cls, onClick}] — onClick returning false keeps it open.
 * Enter in a text field (or Ctrl/Cmd+Enter in a textarea) runs the primary action; Escape closes.
 */
function modal({ title, body, actions = [], cancel = 'Cancel', onOpen }) {
    const back = document.activeElement;
    const close = () => { wrap.remove(); document.removeEventListener('keydown', esc); back?.focus?.({ preventScroll: true }); };
    const esc = e => { if (e.key === 'Escape' && wrap === document.querySelector('.scrim:last-of-type')) close(); };
    const run = a => { if (a.onClick() !== false) close(); };
    const buttons = h('div', { class: 'actions' },
        cancel ? chip(cancel, close) : null,
        actions.map(a => chip(a.label, () => run(a), a.cls || '')));
    const sheet = h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': title || null },
        title ? h('h3', {}, title) : null, body, actions.length || cancel ? buttons : null);
    sheet.addEventListener('keydown', e => {
        if (e.key !== 'Enter' || e.isComposing || e.defaultPrevented) return;
        const tag = e.target.tagName;
        if (!(tag === 'INPUT' || (tag === 'TEXTAREA' && (e.metaKey || e.ctrlKey)))) return;
        const primary = [...actions].reverse().find(a => (a.cls || '').includes('primary'));
        if (primary) { e.preventDefault(); run(primary); }
    });
    const wrap = h('div', { class: 'scrim', onclick: e => { if (e.target === wrap) close(); } }, sheet);
    document.body.append(wrap);
    document.addEventListener('keydown', esc);
    onOpen?.();
    return { close };
}

/** A sheet of full-width menu buttons: [label, onClick, cls]. */
function menu(title, items, foot) {
    const m = modal({
        title, cancel: 'Close',
        body: h('div', { class: 'menu' }, items.filter(Boolean).map(([label, f, cls]) => chip(label, () => { m.close(); f(); }, cls || '')), foot || null),
    });
    return m;
}

function focusSelect(input, text) {
    input.value = text;
    input.focus();
    const i = text.indexOf('***');
    if (i >= 0) input.setSelectionRange(i, i + 3); else input.setSelectionRange(text.length, text.length);
}

/** A line with one "_a / b" pick list (from picks()) replaced by the chosen option; capitalized at the start of a line. */
const choose = (s, pk, o) => s.slice(0, pk.at) + (pk.at === 0 ? o[0].toUpperCase() + o.slice(1) : o) + s.slice(pk.at + pk.text.length);

/** A dropdown for one pick list. Its clicks don't reach the line under it (which opens the editor). */
function pickSelect(pk, onPick) {
    const all = pk.options.join(' / ');
    const label = all.length <= 28 ? all : `${pk.options[0]} … ${pk.options[pk.options.length - 1]}`;
    const sel = h('select', { class: 'pick', 'aria-label': 'Choose ' + pk.options.join(' or ') },
        h('option', { value: '', disabled: true, selected: true }, label),
        pk.options.map(o => h('option', { value: o }, o)));
    for (const ev of ['click', 'pointerdown', 'keydown']) sel.addEventListener(ev, e => e.stopPropagation());
    sel.addEventListener('change', () => onPick(sel.value));
    return sel;
}

/** A line's text with a dropdown in place of each "_a / b" pick list; onChange gets the line with the choice made. */
function withDropdowns(s, onChange) {
    const out = []; let pos = 0;
    for (const pk of picks(s)) { out.push(s.slice(pos, pk.at), pickSelect(pk, o => onChange(choose(s, pk, o)))); pos = pk.at + pk.text.length; }
    out.push(s.slice(pos));
    return out;
}

/** Dropdowns under a text field for the pick lists in it (edit dialogs). */
function pickBox(field, after) {
    const box = h('div', { class: 'picks' });
    const draw = () => box.replaceChildren(...picks(field.value).map(pk => pickSelect(pk, o => { field.value = choose(field.value, pk, o); draw(); after?.(); })));
    field.addEventListener('input', draw);
    draw();
    return box;
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
    measureTop();
}

/** The sticky header's height, for scroll offsets and the sticky note column. */
function measureTop() {
    const top = app.querySelector('.top');
    document.documentElement.style.setProperty('--top-h', (top ? top.offsetHeight : 0) + 'px');
    spy();
}

/** Highlights the tab of the section being read (the last one whose top has passed under the header). */
let spyQueued = false;
function spy() {
    spyQueued = false;
    const tabs = R.tabs;
    if (!tabs?.isConnected) return;
    const y = (app.querySelector('.top')?.offsetHeight || 0) + 32;
    const blks = [...app.querySelectorAll('.blk')].filter(el => el.offsetParent !== null);
    let cur = blks[0]?.dataset.sec;
    for (const el of blks) if (el.getBoundingClientRect().top <= y) cur = el.dataset.sec;
    if (innerHeight + scrollY >= document.documentElement.scrollHeight - 4 && blks.length) cur = blks[blks.length - 1].dataset.sec;
    for (const t of tabs.children) {
        const on = t.dataset.sec === cur;
        t.classList.toggle('on', on);
        if (on && (t.offsetLeft < tabs.scrollLeft || t.offsetLeft + t.offsetWidth > tabs.scrollLeft + tabs.clientWidth)) tabs.scrollLeft = t.offsetLeft - 12;
    }
}

function jump(key) {
    const el = document.getElementById('s-' + key);
    if (!el) return;
    el.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
}

// ================================================================ panel

const newVisit = () => { const v = N.newVisit(); Store.put(v); go('#/v/' + v.id); };

function showPanel() {
    document.title = 'In-Clinic';
    R.tabs = null;
    const visits = Store.panel();
    const copied = visits.filter(v => v.copiedAt).length;
    const list = visits.length ? visits.map(visitCard) : [h('div', { class: 'empty card' },
        h('p', {}, 'No visits yet.'),
        h('p', { class: 'dim small' }, 'Start one in the room with New visit, or Import a pasted schedule tonight to pre-chart. Only times, age, sex and visit type are kept.'))];
    app.replaceChildren(h('div', { class: 'panel' },
        h('header', { class: 'top' }, h('div', { class: 'toprow' },
            h('h1', {}, 'In-Clinic'), grow(),
            chip('Import', () => importSchedule('')),
            chip('⋯', panelMenu, 'icon', { 'aria-label': 'Menu', title: 'Menu' }),
            chip('+ New visit', newVisit, 'primary roomy-only'))),
        h('div', { class: 'panelsub' }, h('span', {}, visits.length === 1 ? '1 visit' : `${visits.length} visits`),
            visits.length ? h('span', { class: copied === visits.length ? 'ok' : 'faint' }, `${copied} copied`) : null),
        chip('+ New visit', newVisit, 'primary big compact-only'),
        h('div', { class: 'cards' }, list)));
}

function visitCard(x) {
    const what = [x.age + x.sex, N.type(x.type)?.label, x.cc].filter(s => s && s.trim()).join(' · ');
    const open = () => go('#/v/' + x.id);
    const card = h('div', { class: 'card visit', tabIndex: 0, role: 'link', onclick: open, onkeydown: e => { if (e.key === 'Enter') open(); } },
        h('b', { class: 'slot' }, x.slot || '––––'),
        h('div', { class: 'vmain' },
            h('div', { class: what ? 'vwhat' : 'vwhat faint' }, what || 'New visit'),
            x.problems.length ? h('div', { class: 'vprobs' }, x.problems.map(p => '#' + p.name).join('  ')) : null),
        h('div', { class: 'vside' },
            h('span', { class: 'code' }, B.bill(x).code),
            h('span', { class: x.copiedAt ? 'ok small' : 'faint small' }, x.copiedAt ? `✓ ${hm(x.copiedAt)}` : 'not copied')),
        chip('⋯', e => { e.stopPropagation(); visitMenu(x); }, 'icon small vmenu', { 'aria-label': 'Visit menu', title: 'Visit menu' }));
    return onHold(card, () => visitMenu(x));
}

function visitMenu(x) {
    menu(`${x.slot || 'Visit'} ${x.age}${x.sex}`.trim(), [
        ['Open', () => go('#/v/' + x.id)],
        ['Delete visit…', () => { if (confirm('Delete this visit?')) { Store.remove(x.id); showPanel(); } }, 'danger'],
    ]);
}

function panelMenu() {
    menu('In-Clinic', [
        ['Import schedule…', () => importSchedule('')],
        ['Signature…', () => editSignature()],
        ['Copy learned chips (backup)', () => copyText(JSON.stringify(Store.learnedDump()), 'Learned chips copied')],
        ['Restore learned chips…', restoreLearned],
        ['Clear panel (end of clinic)…', () => {
            const n = Store.visits().length; const un = Store.visits().filter(v => !v.copiedAt).length;
            if (confirm(`Clear all ${n} visits?` + (un ? `\n\n${un} notes were never copied.` : '') + '\n\nLearned chips are kept.')) { Store.clear(); showPanel(); }
        }, 'danger'],
    ], h('p', { class: 'faint small' }, 'Everything stays on this device (browser storage). Visits are removed after 3 days or when you clear the panel.'));
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
const examOpen = new Set();   // exam systems showing all findings (phones collapse them)
let openId = null;
const R = {};   // live elements: note, oneLiner, title, problems, hpi, fu, tabs, ...

function update(f) {
    v = f(v);
    Store.put(v);
    refresh();
}

/** '' never copied · 'done' copied and unchanged since · 'stale' copied, then changed. */
const copyState = s => ((v.copied || {})[s.key] === s.text ? 'done' : (v.copied || {})[s.key] !== undefined ? 'stale' : '');

function refresh() {
    const secs = N.sections(v, signature());
    R.note.replaceChildren(...secs.map(sectionCard));
    R.copyBar.replaceChildren(...secs.map(s => {
        const st = copyState(s);
        return chip((st === 'done' ? '✓ ' : '') + s.short, () => copySection(s), st,
            { title: `Copy ${s.title}` + (st === 'stale' ? ' (changed since copied)' : ''), 'aria-label': `Copy ${s.title}` });
    }));
    R.oneLinerText.textContent = N.oneLiner(v);
    R.title.textContent = [v.slot, v.age + v.sex].filter(s => s.trim()).join(' · ') || 'New visit';
    document.title = R.title.textContent + ' · In-Clinic';
    const b = B.bill(v);
    R.badge.textContent = b.code;
    R.drawBilling(b);
    R.sideBill.replaceChildren(
        h('div', { class: 'bsumtop' }, h('b', {}, b.code), h('span', { class: 'dim' }, `${B.LEVELS[b.mdm]} MDM`), grow(),
            h('span', { class: 'faint small' }, b.overridden ? 'set by hand' : 'auto')),
        h('div', { class: 'bsumrow' }, [['Problems', b.problems], ['Data', b.data], ['Risk', b.risk]].map(([n, part]) =>
            h('span', {}, h('span', { class: 'faint' }, n + ' '), h('b', { class: 'blvl l' + part.lvl }, B.LEVELS[part.lvl])))));
    for (const sel of R.problems.querySelectorAll('select.cx')) {
        const p = v.problems.find(x => x.id === sel.dataset.id);
        if (p) sel.options[0].text = 'Auto · ' + B.cx(B.autoCx(p)).label;
    }
}

function sectionCard(s) {
    const st = copyState(s);
    return h('section', { class: 'sec' },
        h('div', { class: 'sechd' },
            h('span', { class: 'sectitle grow' }, s.title),
            s.key === 'sign' ? chip(signature() ? 'Edit signature' : 'Set signature', () => editSignature(refresh), 'small link') : null,
            chip(st === 'done' ? 'Copied ✓' : st === 'stale' ? 'Copy again' : 'Copy', () => copySection(s), 'small ' + (st || 'primary'))),
        h('pre', { class: 'note' }, s.text));
}

const libs = () => v.problems.map(p => Library.get(p.lib)).filter(Boolean);

function showVisit(id) {
    v = Store.find(id);
    if (openId !== id) { expanded.clear(); examOpen.clear(); }
    openId = id;

    R.title = h('b', { class: 'title' });
    R.oneLinerText = h('span', { class: 'oltext' });
    R.oneLiner = h('button', { type: 'button', class: 'oneliner', onclick: editOneLiner, title: 'Edit the one-liner' },
        h('span', { class: 'ollabel' }, 'One-liner', h('span', { class: 'faint' }, ' · tap to edit')), R.oneLinerText);
    R.note = h('div', { class: 'secs' });
    R.copyBar = h('div', { class: 'copybar' });
    R.badge = chip('', () => jump('billing'), 'badge', { title: 'Billing level · jump to Billing' });
    R.problems = h('div', { class: 'problems' });
    R.sideBill = h('button', { type: 'button', class: 'bsum', onclick: () => jump('billing'), title: 'Jump to Billing' });

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
        block('visit', 'Visit', null,
            h('div', { class: 'vrow' },
                lfield('Time', v.slot, s => update(x => ({ ...x, slot: s.trim() })), { inputMode: 'numeric', placeholder: '0830' }, 'time'),
                lfield('Age', v.age, s => update(x => ({ ...x, age: s.trim() })), { inputMode: 'numeric', placeholder: '–' }, 'age'),
                seg([['F', 'F'], ['M', 'M']], () => v.sex, s => update(x => ({ ...x, sex: s })), 'sex', 'Sex'),
                seg(N.RELATIONS.map(r => [r, r]), () => v.relation, s => update(x => ({ ...x, relation: s })), 'rel', 'Relation')),
            choice(N.TYPES.map(t => [t.key, t.label]), () => v.type, s => update(x => ({ ...x, type: s })), 'flow types'),
            lfield('Chief complaint', v.cc, s => update(x => ({ ...x, cc: s })), { autocapitalize: 'none', placeholder: 'e.g. fatigue' }, 'wide'),
            R.oneLiner),

        block('hpi', 'HPI', null, R.hpi.el),

        block('exam', 'Exam', null, examView()),

        block('plan', 'Assessment / Plan', chip('+ Problem', addProblem, 'primary small'),
            R.problems,
            h('button', { type: 'button', class: 'addtile', onclick: addProblem }, '+ Add problem')),

        block('fu', 'Follow-up', null,
            fuWithView(),
            h('div', { class: 'glabel' }, 'In'),
            choice(lib.fuWhen.map(w => [w, w]), () => v.fuWhen, s => update(x => ({ ...x, fuWhen: s })), 'flow tight'),
            h('div', { class: 'glabel' }, 'To'),
            R.fu.el),

        billingView(),
    );
    // One live note element: under the editor on narrow screens, in the side column on wide ones (desktop, iPad landscape)
    R.noteBlock = h('section', { class: 'blk narrow-only', id: 's-note', 'data-sec': 'note' },
        h('div', { class: 'blkhd' }, h('h2', { class: 'hd' }, 'Note'), grow(), chip('Share', share, 'small'), chip('Copy all', copyAll, 'small')));
    editor.append(R.noteBlock);
    const sideNote = h('div', { class: 'side-note' });
    const side = h('aside', { class: 'side', 'aria-label': 'Note' }, R.sideBill, sideNote);
    const wideQ = matchMedia('(min-width: 900px)');
    const placeNote = () => (wideQ.matches ? sideNote : R.noteBlock).append(R.note);

    const TABS = [['visit', 'Visit'], ['hpi', 'HPI'], ['exam', 'Exam'], ['plan', 'A/P'], ['fu', 'F/u'], ['billing', 'Billing'], ['note', 'Note']];
    R.tabs = h('nav', { class: 'tabs', 'aria-label': 'Sections' }, TABS.map(([k, label]) =>
        h('button', { type: 'button', class: 'tab' + (k === 'note' ? ' narrow-only' : ''), 'data-sec': k, onclick: () => jump(k) }, label)));

    app.replaceChildren(h('div', { class: 'visit-view' },
        h('header', { class: 'top' },
            h('div', { class: 'toprow' },
                chip('‹', () => go('#/'), 'icon back', { 'aria-label': 'Back to panel', title: 'Back to panel' }),
                R.title, R.badge,
                chip('Paste last note', pasteLast, 'roomy-only'),
                chip('Share', share, 'roomy-only'),
                chip('⋯', visitActions, 'icon', { 'aria-label': 'Visit menu', title: 'More' })),
            R.tabs),
        h('div', { class: 'layout' }, editor, side),
        h('footer', { class: 'bar narrow-only', 'aria-label': 'Copy sections' }, R.copyBar)));
    placeNote();
    wideQ.onchange = () => { if (R.note.isConnected) { placeNote(); measureTop(); } };

    drawProblems();
    refresh();
    window.scrollTo(0, 0);
}

function visitActions() {
    menu([v.slot, v.age + v.sex].filter(s => s.trim()).join(' · ') || 'Visit', [
        ['Paste last note…', pasteLast],
        ['Share note…', share],
        ['Copy whole note', copyAll],
        ['Signature…', () => editSignature(refresh)],
        ['Delete visit…', () => { if (confirm('Delete this visit?')) { Store.remove(v.id); go('#/'); } }, 'danger'],
    ]);
}

/**
 * Physical exam (from the On-Call app): one row per system: nL in one tap, or findings. No vitals fields: they're
 * already in the EMR (vitals saved by an older version still print).
 * On phones a system shows nL and its picked findings; "findings" opens the rest.
 */
function examView() {
    const box = h('div', { class: 'exam' });
    const systems = h('div', { class: 'systems' });
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
            const nl = picked.includes(N.NL);
            const extras = picked.filter(x => x !== N.NL && !s.abnormal.includes(x));
            const open = examOpen.has(s.name);
            const nAbn = picked.filter(x => x !== N.NL).length;
            const toggle = (a) => { update(x => N.examToggle(x, s.name, a)); draw(); };
            return h('div', { class: 'sys' + (open ? ' open' : '') + (picked.length ? ' touched' : '') + (nAbn ? ' abn' : '') },
                h('div', { class: 'syshd' }, h('span', { class: 'sysname' }, s.name), h('span', { class: 'sysnl' }, s.normal)),
                h('div', { class: 'flow' },
                    pill(nl ? 'nL ✓' : 'nL', nl, () => toggle(N.NL), 'small nl', { title: 'Normal: ' + s.normal }),
                    [...s.abnormal, ...extras].map(a => pill(a, picked.includes(a), () => toggle(a), 'small sugg' + (picked.includes(a) ? '' : ' opt'))),
                    chip('+ other', () => addOther(s), 'small link opt'),
                    chip(open ? 'less' : (nAbn ? 'more' : 'findings') + ' ▾', () => { if (open) examOpen.delete(s.name); else examOpen.add(s.name); draw(); },
                        'small link more')));
        }));
    }
    draw();
    box.append(
        h('div', { class: 'flow' },
            chip('All untouched → nL', () => { update(N.examAllNormal); draw(); }, 'primary small', { title: 'Every system not yet touched gets nL (not Abd or URO/GYNE)' }),
            chip('Clear exam', () => { update(x => ({ ...x, exam: {} })); draw(); }, 'small')),
        systems);
    return box;
}

function drawProblems() {
    R.problems.replaceChildren(...(v.problems.length ? v.problems.map(p => problemCard(p.id))
        : [h('p', { class: 'empty' }, 'No problems yet. Add one, or use Paste last note (⋯) to carry the old plan forward.')]));
    R.hpi.draw(); R.fu.draw();
}

function problemCard(id) {
    const p0 = v.problems.find(p => p.id === id);
    const lib = Library.get(p0.lib);
    const cur = () => v.problems.find(p => p.id === id);
    const upd = f => { const p = cur(); if (p) update(x => ({ ...x, problems: x.problems.map(q => (q.id === id ? f(p) : q)) })); };
    const open = expanded.has(id);
    const n = v.problems.findIndex(p => p.id === id) + 1;

    const card = h('section', { class: 'card problem' + (open ? ' open' : '') },
        h('div', { class: 'phd' },
            h('span', { class: 'pnum' }, n + '.'),
            h('button', { type: 'button', class: 'pname', onclick: () => problemMenu(id), title: 'Rename, move or remove' }, p0.name),
            grow(),
            chip(open ? 'Done' : 'Edit', () => toggleOpen(id), 'small' + (open ? ' primary' : ''), { 'aria-expanded': String(open) }),
            chip('⋯', () => problemMenu(id), 'small icon', { 'aria-label': 'Problem menu', title: 'Rename, move or remove' })));
    if (!p0.noStatus) card.append(h('div', { class: 'status' },
        seg(N.NOVELTY.map(s => [s, s]), () => cur()?.novelty || '', s => upd(p => ({ ...p, novelty: s })), 'nov', 'New or known'),
        seg(N.COURSE.map(s => [s, s]), () => cur()?.course || '', s => upd(p => ({ ...p, course: s })), 'course', 'Course'),
        seg(N.TREND.map(s => [s, s]), () => cur()?.trend || '', s => upd(p => ({ ...p, trend: s })), 'trend', 'Trend')));
    const sel = h('select', { class: 'cx', 'aria-label': 'MDM problem complexity', onchange: () => upd(p => ({ ...p, cx: sel.value })) },
        h('option', { value: '' }, 'Auto · ' + B.cx(B.autoCx(p0)).label),
        B.CX.map(c => h('option', { value: c.key }, c.label)));
    sel.dataset.id = id; sel.value = p0.cx || '';
    card.append(h('label', { class: 'mdm' }, h('span', {}, 'MDM'), sel));

    if (!open) {
        const rest = N.problemLines(p0).slice(1).join('\n').trim();
        card.append(h('div', { class: 'mini' + (rest ? '' : ' faint'), role: 'button', tabIndex: 0, onclick: () => toggleOpen(id),
            onkeydown: e => { if (e.key === 'Enter') toggleOpen(id); } }, rest || 'Tap to add notes, DDx, plan'));
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
            prefixes: Library.data.medVerbs, dash: true }).el,
        h('div', { class: 'pfoot' }, chip('Done', () => toggleOpen(id), 'small primary')));
    return card;
}

function toggleOpen(id) {
    const wasOpen = expanded.has(id);
    if (wasOpen) expanded.delete(id); else expanded.add(id);
    drawProblems();
    // Collapsing a long card can leave you far below it; bring its header back into view
    if (wasOpen) {
        const i = v.problems.findIndex(p => p.id === id);
        const el = R.problems.children[i];
        if (el && el.getBoundingClientRect().top < (app.querySelector('.top')?.offsetHeight || 0)) el.scrollIntoView({ block: 'start' });
    }
}

function ddxView(id, lib) {
    const box = h('div', { class: 'ddx' });
    const p = () => v.problems.find(x => x.id === id);
    const set = (label, items) => { const x = p(); if (x) update(vv => ({ ...vv, problems: vv.problems.map(q => (q.id === id ? N.withDdx(x, label, items) : q)) })); };
    /** Edit an item and add its reasoning: ">Iron deficiency anemia; most likely given ***" (the build spec's DDx form). */
    const annotate = (label, item) => {
        const t = h('input', { type: 'text', value: item });
        const why = phrase => {
            t.value = t.value.replace(/\s*[;(].*$/, '') + phrase;
            t.focus(); const j = t.value.indexOf('***'); if (j >= 0) t.setSelectionRange(j, j + 3);
        };
        const body = h('div', {}, t, pickBox(t, () => t.focus()), h('div', { class: 'flow' },
            chip('; most likely given ***', () => why('; most likely given ***'), 'small sugg'),
            chip('; considered but unlikely given ***, will ***', () => why('; considered but unlikely given ***, will ***'), 'small sugg')));
        modal({ title: 'DDx item', body, onOpen: () => t.focus(), actions: [
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
    const hint = matchMedia('(hover: hover)').matches ? 'right-click to add reasoning' : 'hold to add reasoning';
    function draw() {
        const x = p(); if (!x) return;
        const labels = [...new Set([...(lib?.ddx || []).map(g => g.label), ...x.ddx.map(g => g.label)])];
        box.replaceChildren(h('div', { class: 'sub' }, 'DDx', labels.length ? h('span', { class: 'faint' }, ` · tap to include · ${hint}`) : null));
        for (const g of labels) {
            if (g) box.append(h('div', { class: 'glabel' }, '>' + g));
            const opts = (lib?.ddx || []).find(d => d.label === g)?.items || [];
            const chosen = N.ddxItems(x, g);
            const matchOf = o => chosen.find(c => c === o || c.startsWith(o + ' (') || c.startsWith(o + ';'));
            const flow = h('div', { class: 'flow' });
            for (const o of opts) {
                const m = matchOf(o);
                const c = pill(m || o, !!m, () => { set(g, m ? chosen.filter(i => i !== m) : [...chosen, o]); draw(); }, 'small sugg');
                if (m) onHold(c, () => annotate(g, m));
                flow.append(c);
            }
            for (const extra of chosen.filter(c => !opts.some(o => c === o || c.startsWith(o + ' (') || c.startsWith(o + ';')))) {
                flow.append(onHold(pill(extra, true, () => { set(g, chosen.filter(i => i !== extra)); draw(); }, 'small sugg'), () => annotate(g, extra)));
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
    const name = h('input', { type: 'text', value: p.name, 'aria-label': 'Problem name' });
    const close = () => dlg.close();
    const rename = () => { const n = name.value.trim().replace(/^#/, ''); if (n) { update(x => ({ ...x, problems: x.problems.map(q => (q.id === id ? { ...q, name: n } : q)) })); drawProblems(); } };
    const dlg = modal({
        title: '#' + p.name, cancel: 'Close',
        body: h('div', { class: 'stack' },
            h('div', { class: 'addrow' }, name, chip('Rename', () => { rename(); close(); }, 'primary')),
            h('div', { class: 'menu' },
                i > 0 ? chip('Move up', () => { move(-1); close(); }) : null,
                i < v.problems.length - 1 ? chip('Move down', () => { move(1); close(); }) : null,
                dotInsert(p, () => { drawProblems(); close(); }),
                chip(p.noStatus ? 'Show status (count for billing)' : 'Hide status (not counted for billing)', () => { update(x => ({ ...x, problems: x.problems.map(q => (q.id === id ? { ...q, noStatus: !q.noStatus } : q)) })); drawProblems(); close(); }),
                chip('Remove problem', () => { update(x => ({ ...x, problems: x.problems.filter(q => q.id !== id) })); drawProblems(); close(); }, 'danger'))),
    });
    name.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); rename(); close(); } });
}

/** "Insert #abbr dotphrase" for a problem whose block has lines it doesn't have yet (e.g. one carried forward). */
function dotInsert(p, after) {
    const blk = Dot.find(p.lib, p.name);
    const has = new Set([...p.notes, ...p.plan, ...p.ddx.flatMap(g => g.items)]);
    if (!blk || [...blk.notes, ...(blk.ddx || []), ...blk.plan].every(l => has.has(l))) return null;
    return chip(`Insert ${blk.abbr} dotphrase`, () => {
        update(x => ({ ...x, problems: x.problems.map(q => (q.id === p.id ? Dot.fill(q, blk) : q)) }));
        expanded.add(p.id);
        after();
    });
}

function addProblem() {
    const q = h('input', { type: 'text', placeholder: 'Search, #dotphrase, or type a new problem', autocomplete: 'off', enterKeyHint: 'done' });
    const results = h('div', { class: 'results', role: 'listbox' });
    let first = null;
    let dlg = null;
    const add = (p0, block = Dot.find(p0.lib, p0.name)) => {
        const p = Dot.fill(p0, block);   // the problem's dotphrase fills its notes, DDx and plan
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
        // Show the alias the search matched ("annual" → Health maintenance · annual), else the first two
        const lq = s.toLowerCase();
        for (const l of Library.search(s)) {
            const hit = lq && !l.name.toLowerCase().includes(lq) ? (l.aliases || []).filter(a => a.includes(lq)).slice(0, 1) : [];
            rows.push([l.name, [Dot.find(l.key)?.abbr, ...(hit.length ? hit : (l.aliases || []).slice(0, 2))].filter(Boolean).join(', '), () => add(fromLib(l))]);
        }
        for (const d of Dot.search(s)) {
            rows.push([d.name, d.abbr + (d.title !== d.name ? ', ' + d.title : ''), () => add(N.newProblem({ name: d.name, noStatus: !!d.noStatus }), d)]);
        }
        for (const n of Store.customProblems().filter(n => !s || n.toLowerCase().includes(s.toLowerCase()))) rows.push([n, 'yours', () => add(N.newProblem({ name: n }))]);
        if (s && !Library.match(s) && !Dot.find('', s) && !Store.customProblems().some(n => n.toLowerCase() === s.toLowerCase())) {
            // Enter takes the first row: a library / earlier match when there is one, else this new problem
            rows.push([`+ Add "${s}"`, '', () => { Store.learn('names', 'problem', s); add(N.newProblem({ name: s })); }, 'accent']);
        }
        first = rows[0]?.[2] || null;
        results.replaceChildren(...rows.map(([t, note, f, cls], i) =>
            h('button', { type: 'button', class: 'result ' + (cls || '') + (i === 0 && s ? ' first' : ''), onclick: f }, t, note ? h('span', { class: 'faint' }, '  ·  ' + note) : null)));
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
            measureTop();
            toast(add.length ? `Added ${add.length} problems` : 'No problems found');
        } }],
    });
}

/** Copies one section and remembers its text, so the button shows when it changed since. */
function copySection(s) {
    copyText(s.text, s.title + ' copied');
    update(y => ({ ...y, copied: { ...(y.copied || {}), [s.key]: s.text }, copiedAt: Date.now() }));
}

/** The whole note with section titles (for pasting somewhere that isn't the EMR's sectioned form). */
function copyAll() {
    copyText(N.render(v, signature()), 'Whole note copied');
}

/** F/u with: typed, or a remembered name (hold or right-click to forget). */
function fuWithView() {
    const f = lfield('With', v.fuWith || '', s => update(x => ({ ...x, fuWith: s })), { placeholder: 'e.g. Dr. Richard' }, 'wide');
    const input = f.input;
    const box = h('div', { class: 'flow' });
    const draw = () => box.replaceChildren(...Store.learned('fu', 'with').map(n => {
        const el = pill(n, (v.fuWith || '').trim() === n, () => {
            const nv = (v.fuWith || '').trim() === n ? '' : n;
            input.value = nv; update(x => ({ ...x, fuWith: nv })); draw();
        }, 'small sugg learned');
        return onHold(el, () => { if (confirm(`Forget "${n}"?`)) { Store.forget('fu', 'with', n); draw(); } });
    }));
    input.addEventListener('change', () => { if (input.value.trim()) Store.learn('fu', 'with', input.value.trim()); draw(); });
    draw();
    return h('div', {}, f, box);
}

/**
 * Billing: the E/M level, recalculated on every change (billing.js). Problems come from the status pills
 * (or each problem's MDM menu), risk from the plan, data from the counters here.
 */
function billingView() {
    const box = h('div', { class: 'billing' });
    R.billing = block('billing', 'Billing', null, box);
    const setData = f => update(x => ({ ...x, data: f({ ...B.emptyData(), ...(x.data || {}) }) }));
    const counter = (label, value, set, note, reset) => h('div', { class: 'counter' },
        h('span', { class: 'grow' }, label, note ? h('span', { class: 'faint small' }, '  ' + note) : null),
        reset ? chip('auto', reset, 'small link') : null,
        chip('−', () => set(Math.max(0, value - 1)), 'small sq', { 'aria-label': 'Fewer ' + label.toLowerCase() }),
        h('b', { class: 'num', 'aria-live': 'polite' }, String(value)),
        chip('+', () => set(value + 1), 'small sq', { 'aria-label': 'More ' + label.toLowerCase() }));
    const row = (name, part) => h('div', { class: 'brow' },
        h('span', { class: 'bname' }, name), h('b', { class: 'blvl l' + part.lvl }, B.LEVELS[part.lvl]), h('span', { class: 'dim small bwhy' }, part.why.join('; ')));
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
                pill('Independent historian', d.historian, () => setData(x => ({ ...x, historian: !x.historian })), 'small sugg'),
                pill('Independent interpretation', d.interp, () => setData(x => ({ ...x, interp: !x.interp })), 'small sugg'),
                pill('Discussed w/ external MD', d.discuss, () => setData(x => ({ ...x, discuss: !x.discuss })), 'small sugg')),
            sub('Risk'),
            h('div', { class: 'flow' },
                pill('Auto', !v.risk, () => update(x => ({ ...x, risk: '' })), 'small'),
                B.RISKS.map(r => pill(r[0].toUpperCase() + r.slice(1), v.risk === r, () => update(x => ({ ...x, risk: x.risk === r ? '' : r })), 'small')),
                pill('SDOH limits dx/tx', !!v.sdoh, () => update(x => ({ ...x, sdoh: !x.sdoh })), 'small sugg')),
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
 * Editable list of lines (HPI, a problem's notes / plan, follow-up reasons). Tap a row to edit or move it; × deletes it.
 * Suggestion chips toggle that line in or out; a chip with *** goes into the field with the blank selected so you type over it.
 * Prefix chips (med verbs) start the field. Enter adds what's typed and keeps the keyboard up for the next line.
 * With a learnKey, typed lines are remembered and come back as chips (hold or right-click one to forget it).
 */
function Lines({ get, set, chips, learnKey = () => null, kind = '', placeholder, prefixes = [], dash = false }) {
    const rows = h('div', { class: 'rows' });
    const chipBox = h('div', { class: 'flow suggs' });
    const input = h('input', { type: 'text', placeholder, autocomplete: 'off', enterKeyHint: 'enter', autocapitalize: 'sentences', 'aria-label': placeholder });
    const add = () => {
        const t = input.value.trim(); if (!t) return;
        set([...get(), t]);
        const k = learnKey(); if (k) Store.learn(k, kind, t);
        input.value = '';
        draw();
        input.focus();
    };
    input.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); add(); } });

    /** Edit a line. A dotphrase "_a / b" list shows as a dropdown; *** blanks are selected to type over. */
    const edit = i => {
        const s = get()[i]; if (s === undefined) return;
        const t = h('textarea', { rows: 3, value: s });
        const blank = () => { t.focus(); const j = t.value.indexOf('***'); if (j >= 0) t.setSelectionRange(j, j + 3); };
        modal({ title: 'Edit line', body: h('div', {}, t, pickBox(t, blank)), onOpen: blank, actions: [
            i > 0 ? { label: 'Move up', onClick: () => { const l = [...get()]; [l[i - 1], l[i]] = [l[i], l[i - 1]]; set(l); draw(); } } : null,
            { label: 'Delete', cls: 'danger', onClick: () => { set(get().filter((_, j) => j !== i)); draw(); } },
            { label: 'Save', cls: 'primary', onClick: () => {
                const n = t.value.trim();
                set(n ? get().map((x, j) => (j === i ? n : x)) : get().filter((_, j) => j !== i)); draw();
            } },
        ].filter(Boolean) });
    };
    const remove = i => { set(get().filter((_, j) => j !== i)); draw(); };

    function draw() {
        rows.replaceChildren(...get().map((s, i) => h('div', { class: 'line' + (dash ? ' dash' : '') + (unfilled(s) ? ' tmpl' : '') },
            h('div', { class: 'linet', role: 'button', tabIndex: 0, onclick: () => edit(i),
                onkeydown: e => { if (e.key === 'Enter' && e.target === e.currentTarget) edit(i); },
                title: unfilled(s) ? 'Has blanks to fill (not counted for billing until filled)' : 'Edit' },
            withDropdowns(s, n => { set(get().map((x, j) => (j === i ? n : x))); draw(); })),
            h('button', { type: 'button', class: 'linex', onclick: () => remove(i), 'aria-label': 'Delete line', title: 'Delete' }, '×'))));
        const cur = get(); const base = chips(); const key = learnKey();
        const learned = key ? Store.learned(key, kind).filter(c => !base.includes(c)) : [];
        chipBox.replaceChildren(...[...new Set([...base, ...learned])].map(c => {
            const blank = c.includes('***'); const on = cur.includes(c);
            const el = pill(c, on, () => {
                if (blank && !on) focusSelect(input, c);
                else { set(on ? cur.filter(x => x !== c) : [...cur, c]); draw(); }
            }, 'small sugg' + (blank && !on ? ' blank' : '') + (learned.includes(c) ? ' learned' : ''));
            if (key && learned.includes(c)) onHold(el, () => { if (confirm(`Forget "${c}"?`)) { Store.forget(key, kind, c); draw(); } });
            return el;
        }));
    }

    const el = h('div', { class: 'lines' },
        rows,
        h('div', { class: 'addrow' }, input, chip('+', add, 'primary sq', { 'aria-label': 'Add line', title: 'Add (Enter)' })),
        prefixes.length ? h('div', { class: 'flow verbs' }, prefixes.map(p => chip(p.trim(), () => {
            const t = input.value; const pre = prefixes.find(x => t.startsWith(x));
            input.value = p + (pre ? t.slice(pre.length) : t);
            input.focus(); input.setSelectionRange(input.value.length, input.value.length);
        }, 'small verb'))) : null,
        chipBox);
    draw();
    return { el, draw };
}

// ================================================================ boot

async function boot() {
    try {
        Library.load(await (await fetch('library.json')).json());
        Dot.load(await (await fetch('dotphrases.json')).json().catch(() => null));
    } catch {
        app.replaceChildren(h('p', { class: 'empty' }, 'Could not load the problem library. Open the app once while online.'));
        return;
    }
    window.addEventListener('hashchange', route);
    window.addEventListener('scroll', () => { if (!spyQueued) { spyQueued = true; requestAnimationFrame(spy); } }, { passive: true });
    window.addEventListener('resize', measureTop);
    // While typing on a phone / iPad, the fixed copy bar would ride on top of the on-screen keyboard: hide it
    document.addEventListener('focusin', e => { if (e.target.matches?.('input, textarea, select')) document.body.classList.add('typing'); });
    document.addEventListener('focusout', () => document.body.classList.remove('typing'));
    route();
    if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
    navigator.storage?.persist?.();
}
boot();
