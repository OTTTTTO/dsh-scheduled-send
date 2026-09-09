// Bundle-level tests: lib/client.js registers via window.__ModuleLoader__.load,
// wires BOTH composer slots, the ⏰ flow (draft → confirm → POST + clear input,
// no immediate send) works end-to-end, the dock refreshes immediately on
// session switch (FIX1), the new collapse policy renders (FIX2), and the
// mobile layout applies (FIX5). Model switching is GONE (FIX3).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const STATE = '/plugin-data/dsh-scheduled-send/state';

function loadBundle(react) {
  let def = null;
  global.window = { __ModuleLoader__: { load: (d) => { def = d; } } };
  // eslint-disable-next-line no-eval
  eval(readFileSync(fileURLToPath(new URL('../lib/client.js', import.meta.url)), 'utf8'));
  assert.ok(def, 'bundle registered itself');
  assert.equal(def.id, 'dsh-scheduled-send');
  return def.factory((id) => {
    if (id === 'react' || id === 'react/jsx-runtime') return react;
    throw new Error('unexpected require: ' + id);
  });
}

const dumbReact = {
  createElement: () => null,
  useState: (v) => [typeof v === 'function' ? v() : v, () => {}],
  useEffect: () => {},
};

/** Minimal interactive React: state that persists across manual re-renders,
 *  plus a useEffect recorder whose pending callbacks tests run by hand. */
function makeInteractiveReact() {
  const self = {
    createElement(type, props, ...children) {
      return { type, props: { ...(props || {}), children } };
    },
    useState(v) {
      const i = self.__hi++;
      if (!self.__hooks[i]) self.__hooks[i] = { value: typeof v === 'function' ? v() : v };
      const slot = self.__hooks[i];
      return [slot.value, (nv) => { slot.value = typeof nv === 'function' ? nv(slot.value) : nv; }];
    },
    useEffect(fn, deps) {
      const i = self.__ei++;
      const slot = self.__effects[i] || (self.__effects[i] = { ran: false, last: undefined });
      const changed = !slot.ran || !deps || deps.some((d, j) => d !== slot.last?.[j]);
      if (changed) { slot.ran = true; slot.last = deps; self.__pending.push(fn); }
    },
    runEffects() { const fns = self.__pending; self.__pending = []; for (const fn of fns) fn(); },
    reset() { self.__hi = 0; self.__ei = 0; }, // keep hook slots: state persists across renders
    clear() { self.__hooks = []; self.__hi = 0; self.__effects = []; self.__ei = 0; self.__pending = []; },
    __hooks: [], __hi: 0, __effects: [], __ei: 0, __pending: [],
  };
  return self;
}

function applySlots(mod) {
  const captured = { right: null, dock: null, props: null };
  const fakeCtx = {
    inject: (names, fn) => fn({
      slots: {
        inject: (name, reg) => {
          const r = reg({});
          if (name === 'conversation.input.right') captured.right = r;
          if (name === 'conversation.input.dock') captured.dock = r;
        },
        register: (o, C) => { o.__comp = C; return o; },
      },
    }),
  };
  mod.apply(fakeCtx);
  captured.props = {
    right: captured.right.inject('sess-1'),
    dock: captured.dock.inject('sess-1'),
  };
  return captured;
}

function findAll(node, pred, out = [], depth = 0) {
  if (!node || typeof node !== 'object' || depth > 12) return out;
  if (Array.isArray(node)) { for (const k of node) findAll(k, pred, out, depth + 1); return out; }
  if (pred(node)) out.push(node);
  const kids = node.props?.children;
  const arr = Array.isArray(kids) ? kids : kids !== undefined ? [kids] : [];
  for (const k of arr) findAll(k, pred, out, depth + 1);
  return out;
}
const texts = (node) => findAll(node, (n) => typeof n === 'object' && Array.isArray(n.props?.children))
  .flatMap((n) => n.props.children.filter((c) => typeof c === 'string' || typeof c === 'number'));

function expandFn(node, depth = 0) {
  if (Array.isArray(node)) return node.map((k) => expandFn(k, depth + 1));
  if (!node || typeof node !== 'object' || depth > 10) return node;
  if (typeof node.type === 'function') return expandFn(node.type({ ...(node.props || {}) }), depth + 1);
  const kids = node.props?.children;
  const arr = Array.isArray(kids) ? kids : kids !== undefined ? [kids] : [];
  return { ...node, props: { ...node.props, children: arr.map((k) => (k && typeof k === 'object' ? expandFn(k, depth + 1) : k)) } };
}

test('bundle: slots wired (input.right + input.dock ONLY — modelDirectories gone), core hits the state route', async () => {
  const mod = loadBundle(dumbReact);
  assert.deepEqual([...mod.inject].sort(), ['slots'], 'FIX3: modelDirectories no longer injected');
  const captured = applySlots(mod);
  assert.equal(captured.right.name, 'conversation.input.right');
  assert.equal(captured.right.id, 'dsh-scheduled-send');
  assert.equal(captured.dock.name, 'conversation.input.dock');
  assert.equal(captured.props.right.sessionId, 'sess-1');
  assert.equal(captured.props.right.modelList, undefined, 'FIX3: no model dropdown data anymore');

  let called = null;
  globalThis.fetch = async (path) => {
    called = path;
    return { ok: true, json: async () => ({ now: 0, tasks: [] }) };
  };
  await mod.core.refresh();
  assert.equal(called, STATE + '?conversationId=sess-1', 'FIX2: state polled per current session');
});

test('bundle: core POSTs schedule to the schedule route and DELETEs on cancel', async () => {
  const mod = loadBundle(dumbReact);
  const calls = [];
  globalThis.fetch = async (path, opts = {}) => {
    calls.push({ path, method: opts.method || 'GET', body: opts.body });
    if ((opts.method || 'GET') === 'POST' && path.endsWith('/schedule')) {
      return { ok: true, json: async () => ({ task: { id: 't1', content: 'x', sendAt: 9, conversationId: 'sess-1' } }) };
    }
    if ((opts.method || 'GET') === 'DELETE') return { ok: true, json: async () => ({}) };
    return { ok: true, json: async () => ({ now: 0, tasks: [] }) };
  };
  const task = await mod.core.scheduleMessage({ content: 'x', sendAt: 9, conversationId: 'sess-1' });
  assert.equal(task.id, 't1');
  assert.equal(calls[0].path, STATE.replace(/\/state$/, '/schedule'));
  assert.equal(calls[0].method, 'POST');
  await mod.core.cancelTask('t1');
  const del = calls.find((c) => c.method === 'DELETE');
  assert.match(del.path, /schedule\?id=t1$/);
});

test('bundle: ⏰ flow — popover defaults to now+5min, NO model dropdown, confirm POSTs the DRAFT and clears the input', async () => {
  const react = makeInteractiveReact();
  const mod = loadBundle(react);
  const captured = applySlots(mod);
  const posted = [];
  const core = captured.props.right.core;
  core.scheduleMessage = async (p) => { posted.push(p); return { task: { id: 't1', ...p } }; };

  const draft = '第一行\n  缩进 markdown `code`';
  const props = {
    ...captured.props.right,
    useInput: (sel) => draft,
    inputActions: { setDraft: (t) => { props.__setDraft.push(t); }, submit: () => { throw new Error('must NOT send immediately'); } },
    __setDraft: [],
  };

  // initial render: only the ⏰ button
  react.reset();
  let tree = expandFn(captured.right.__comp(props));
  const alarm = findAll(tree, (n) => n.type === 'button' && texts(n).join('').includes('⏰'))[0];
  assert.ok(alarm, '⏰ button rendered in the composer tool row');
  assert.equal(findAll(tree, (n) => n.type === 'input' && n.props?.type === 'datetime-local').length, 0, 'popover closed initially');

  // click ⏰ → popover with time default now+5min, model dropdown GONE
  alarm.props.onClick();
  react.reset();
  tree = expandFn(captured.right.__comp(props));
  const timeInput = findAll(tree, (n) => n.type === 'input' && n.props?.type === 'datetime-local')[0];
  assert.ok(timeInput, 'time confirmation input appears');
  const expected = new Date(Date.now() + 5 * 60_000);
  const pad = (n) => String(n).padStart(2, '0');
  const want = `${expected.getFullYear()}-${pad(expected.getMonth() + 1)}-${pad(expected.getDate())}T${pad(expected.getHours())}:${pad(expected.getMinutes())}`;
  assert.equal(timeInput.props.value, want, 'default time = now + 5 minutes');
  assert.equal(findAll(tree, (n) => n.type === 'select').length, 0, 'FIX3: no model dropdown in the popover');
  assert.ok(!JSON.stringify(texts(tree)).includes('切换模型'), 'FIX3: no model-switch label anywhere');

  // confirm (no model to pick)
  const confirm = findAll(tree, (n) => n.type === 'button' && /确认|确定/.test(texts(n).join('')))[0];
  assert.ok(confirm, 'confirm button rendered');
  await confirm.props.onClick();

  assert.equal(posted.length, 1, 'exactly one POST');
  assert.equal(posted[0].content, draft, 'the composer DRAFT becomes the task content');
  assert.ok(posted[0].sendAt > Date.now(), 'sendAt in the future');
  assert.equal(posted[0].conversationId, 'sess-1');
  assert.equal(posted[0].model, undefined, 'FIX3: no model in the payload');
  assert.deepEqual(props.__setDraft, [''], 'input cleared via inputActions.setDraft("")');
});

test('bundle FIX1: dock re-fetches IMMEDIATELY when sessionId prop changes', async () => {
  const react = makeInteractiveReact();
  const mod = loadBundle(react);
  const captured = applySlots(mod);
  const core = captured.props.dock.core;
  const urls = [];
  const data = {
    'sess-1': { now: 0, tasks: [{ id: 'a', content: 'A', sendAt: 5, conversationId: 'sess-1' }] },
    'sess-2': { now: 0, tasks: [{ id: 'b', content: 'B', sendAt: 6, conversationId: 'sess-2' }] },
  };
  globalThis.fetch = async (path) => {
    urls.push(path);
    const cid = new URL(path, 'http://x').searchParams.get('conversationId');
    return { ok: true, json: async () => data[cid] ?? { now: 0, tasks: [] } };
  };

  const render = (sid) => {
    react.reset();
    return expandFn(captured.dock.__comp({ core, sessionId: sid }));
  };
  render('sess-1');
  react.runEffects(); // FIX1: session effect fetches right away
  await new Promise((r) => setTimeout(r, 5)); // let the async refresh settle
  assert.ok(urls.some((u) => u.includes('conversationId=sess-1')), 'immediate fetch on mount');
  assert.deepEqual(core.visibleTasks().map((t) => t.id), ['a']);

  // switch conversation: props.sessionId changes → effect re-runs immediately
  render('sess-2');
  const before = urls.length;
  react.runEffects();
  await new Promise((r) => setTimeout(r, 5));
  assert.ok(urls.length > before, 'FIX1: sessionId change triggers a fresh fetch');
  assert.deepEqual(core.visibleTasks().map((t) => t.id), ['b'], 'the NEW session list is shown instantly');
});

test('bundle FIX2: dock collapse policy — >1 shows ONLY the soonest entry + 「其余 N 条定时任务 ⌄」, expand/collapse works', async () => {
  const react = makeInteractiveReact();
  const mod = loadBundle(react);
  const captured = applySlots(mod);
  const core = captured.props.dock.core;
  const base = Date.now() + 60_000;
  const tasks = [
    { id: 't4', content: 'd', sendAt: base + 30_000, conversationId: 'sess-1' },
    { id: 't1', content: 'a', sendAt: base + 0, conversationId: 'sess-1' },
    { id: 't2', content: 'b', sendAt: base + 10_000, conversationId: 'sess-1' },
    { id: 't3', content: 'c', sendAt: base + 20_000, conversationId: 'sess-1' },
  ];
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ now: 0, tasks }) });
  await core.refresh();

  const render = () => {
    react.reset();
    return expandFn(captured.dock.__comp({ ...captured.props.dock }));
  };
  let tree = render();
  let mono = findAll(tree, (n) => n.props?.style?.fontFamily === 'monospace');
  assert.equal(mono.length, 1, 'only ONE entry visible by default (the soonest)');
  assert.equal((Array.isArray(mono[0].props.children) ? mono[0].props.children[0] : mono[0].props.children), 'a', 'soonest (sendAt-min) entry shown');
  const all = JSON.stringify(texts(tree));
  assert.match(all, /其余 3 条定时任务/, 'summary row for the remaining 3');

  // expand → all 4
  let toggle = findAll(tree, (n) => n.type === 'button' && /条定时任务/.test(texts(n).join('')))[0];
  toggle.props.onClick();
  tree = render();
  mono = findAll(tree, (n) => n.props?.style?.fontFamily === 'monospace');
  assert.equal(mono.length, 4, 'expanded shows the full list');
  const order = mono.map((n) => (Array.isArray(n.props.children) ? n.props.children[0] : n.props.children));
  assert.deepEqual(order, ['a', 'b', 'c', 'd'], 'entries in sendAt ascending order');

  // collapse again → back to 1 + summary
  toggle = findAll(tree, (n) => n.type === 'button' && /收起/.test(texts(n).join('')))[0];
  assert.ok(toggle, 'collapse toggle rendered while expanded');
  toggle.props.onClick();
  tree = render();
  mono = findAll(tree, (n) => n.props?.style?.fontFamily === 'monospace');
  assert.equal(mono.length, 1, 'collapsed again to the single soonest entry');

  // single entry: user had collapsed — summary shows it; expand reveals it;
  // collapse again hides it entirely (manual collapse works for ANY count)
  await core.cancelTask('t1'); await core.cancelTask('t2'); await core.cancelTask('t3');
  tree = render();
  assert.equal(findAll(tree, (n) => n.props?.style?.fontFamily === 'monospace').length, 0, 'single entry stays collapsed under the prior override');
  assert.match(JSON.stringify(texts(tree)), /1 条定时任务/, 'summary shows the hidden single task');
  toggle = findAll(tree, (n) => n.type === 'button' && /条定时任务/.test(texts(n).join('')))[0];
  toggle.props.onClick();
  tree = render();
  assert.equal(findAll(tree, (n) => n.props?.style?.fontFamily === 'monospace').length, 1, 'single entry visible once expanded');
  toggle = findAll(tree, (n) => n.type === 'button' && /收起/.test(texts(n).join('')))[0];
  toggle.props.onClick();
  tree = render();
  assert.equal(findAll(tree, (n) => n.props?.style?.fontFamily === 'monospace').length, 0, 'single entry collapsible to nothing');
  assert.match(JSON.stringify(texts(tree)), /1 条定时任务/);
});

test('bundle FIX5: mobile (≤480px) — dock fully collapsed by default; popover near-full-width; touch targets ≥40px', async () => {
  const react = makeInteractiveReact();
  const mod = loadBundle(react);
  global.window.matchMedia = (q) => ({ matches: String(q).includes('480') }); // AFTER loadBundle (it resets window)
  const captured = applySlots(mod);

  // dock: 1 task on mobile → fully collapsed (summary only)
  const core = captured.props.dock.core;
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ now: 0, tasks: [{ id: 't1', content: 'a', sendAt: Date.now() + 60_000, conversationId: 'sess-1' }] }),
  });
  await core.refresh();
  react.reset();
  let tree = expandFn(captured.dock.__comp({ ...captured.props.dock }));
  assert.equal(findAll(tree, (n) => n.props?.style?.fontFamily === 'monospace').length, 0, 'mobile: no entries by default');
  assert.match(JSON.stringify(texts(tree)), /1 条定时任务/, 'mobile: collapsed summary');

  // popover: near-full-width + ≥40px touch targets
  const bprops = { ...captured.props.right, useInput: () => 'x', inputActions: {} };
  react.reset();
  const alarm = findAll(expandFn(captured.right.__comp(bprops)), (n) => n.type === 'button' && texts(n).join('').includes('⏰'))[0];
  alarm.props.onClick();
  react.reset();
  tree = expandFn(captured.right.__comp(bprops));
  const pop = findAll(tree, (n) => n.type === 'div' && String(n.props?.style?.width || '').includes('100vw'))[0];
  assert.ok(pop, 'mobile: popover width uses ~100vw');
  const btns = findAll(tree, (n) => n.type === 'button' && /确认|取消/.test(texts(n).join('')));
  assert.ok(btns.length >= 2, 'confirm + cancel buttons present');
  for (const b of btns) assert.ok(Number(b.props.style.minHeight) >= 40, 'touch target ≥40px');
  const input = findAll(tree, (n) => n.type === 'input' && n.props?.type === 'datetime-local')[0];
  assert.ok(Number(input.props.style.minHeight) >= 40, 'input touch target ≥40px');

  delete global.window.matchMedia;
});

test('bundle FIX1: failed state fetch keeps the old list and shows an error line (no flash-to-empty)', async () => {
  const react = makeInteractiveReact();
  const mod = loadBundle(react);
  const captured = applySlots(mod);
  const core = captured.props.dock.core;
  let fail = false;
  globalThis.fetch = async () => {
    if (fail) return { ok: false, status: 500, json: async () => ({}) };
    return { ok: true, json: async () => ({ now: 0, tasks: [{ id: 'a', content: 'A', sendAt: Date.now() + 60_000, conversationId: 'sess-1' }] }) };
  };
  await core.refresh();
  fail = true;
  await core.refresh();
  react.reset();
  const tree = expandFn(captured.dock.__comp({ ...captured.props.dock }));
  assert.equal(findAll(tree, (n) => n.props?.style?.fontFamily === 'monospace').length, 1, 'old entry still rendered after a failed refresh');
  assert.match(JSON.stringify(texts(tree)), /加载失败/, 'error surfaced inline');
});
