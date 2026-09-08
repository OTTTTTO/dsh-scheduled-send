// Bundle-level tests: lib/client.js registers via window.__ModuleLoader__.load,
// wires BOTH composer slots, and the ⏰ flow (draft → confirm → POST + clear
// input, no immediate send) works end-to-end with an interactive React stub.
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

/** Minimal interactive React: state that persists across manual re-renders. */
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
    useEffect() {},
    reset() { self.__hi = 0; }, // keep hook slots: state persists across renders
    clear() { self.__hooks = []; self.__hi = 0; },
    __hooks: [], __hi: 0,
  };
  return self;
}

function applySlots(mod, extraModels) {
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
      modelDirectories: {
        directoryFor: (sid) => ({
          store: { getSnapshot: () => ({ groups: [{ id: 'zai', models: [{ id: 'glm-5.3', name: 'GLM' }, { id: 'glm-5.3-flash', name: 'Flash' }] }] }) },
          select: extraModels?.select || (async () => {}),
        }),
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

test('bundle: slots wired (input.right + input.dock), core hits the state route', async () => {
  const mod = loadBundle(dumbReact);
  assert.deepEqual([...mod.inject].sort(), ['modelDirectories', 'slots'].sort());
  const captured = applySlots(mod);
  assert.equal(captured.right.name, 'conversation.input.right');
  assert.equal(captured.right.id, 'dsh-scheduled-send');
  assert.equal(captured.dock.name, 'conversation.input.dock');
  assert.equal(captured.props.right.sessionId, 'sess-1');
  assert.ok(Array.isArray(captured.props.right.modelList) && captured.props.right.modelList.length === 2, 'model dropdown data via inject');

  let called = null;
  globalThis.fetch = async (path) => {
    called = path;
    return { ok: true, json: async () => ({ now: 0, tasks: [], modelSwitchPending: [], recentDelivered: [] }) };
  };
  await mod.core.refresh();
  assert.equal(called, STATE);
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
    if (path.endsWith('/model-selected')) return { ok: true, json: async () => ({ ok: true }) };
    return { ok: true, json: async () => ({ now: 0, tasks: [], modelSwitchPending: [], recentDelivered: [] }) };
  };
  const task = await mod.core.scheduleMessage({ content: 'x', sendAt: 9, conversationId: 'sess-1' });
  assert.equal(task.id, 't1');
  assert.equal(calls[0].path, STATE.replace(/\/state$/, '/schedule'));
  assert.equal(calls[0].method, 'POST');
  await mod.core.cancelTask('t1');
  const del = calls.find((c) => c.method === 'DELETE');
  assert.match(del.path, /schedule\?id=t1$/);
});

test('bundle: ⏰ flow — popover defaults to now+5min, confirm POSTs the DRAFT and clears the input, never sends', async () => {
  const react = makeInteractiveReact();
  const mod = loadBundle(react);
  const captured = applySlots(mod);
  const posted = [];
  const core = captured.props.right.core;
  core.scheduleMessage = async (p) => { posted.push(p); return { task: { id: 't1', ...p } }; };
  core.refresh = async () => ({ tasks: [], modelSwitchPending: [], recentDelivered: [] });

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

  // click ⏰ → popover with time default now+5min and model dropdown
  alarm.props.onClick();
  react.reset();
  tree = expandFn(captured.right.__comp(props));
  const timeInput = findAll(tree, (n) => n.type === 'input' && n.props?.type === 'datetime-local')[0];
  assert.ok(timeInput, 'time confirmation input appears');
  const expected = new Date(Date.now() + 5 * 60_000);
  const pad = (n) => String(n).padStart(2, '0');
  const want = `${expected.getFullYear()}-${pad(expected.getMonth() + 1)}-${pad(expected.getDate())}T${pad(expected.getHours())}:${pad(expected.getMinutes())}`;
  assert.equal(timeInput.props.value, want, 'default time = now + 5 minutes');
  const modelSel = findAll(tree, (n) => n.type === 'select')[0];
  assert.ok(modelSel, 'optional model dropdown rendered');
  assert.equal(modelSel.props.children.length, 3, 'placeholder + 2 models');

  // pick a model + confirm
  modelSel.props.onChange({ target: { value: 'zai::glm-5.3-flash' } });
  react.reset();
  tree = expandFn(captured.right.__comp(props));
  const confirm = findAll(tree, (n) => n.type === 'button' && /确认|确定/.test(texts(n).join('')))[0];
  assert.ok(confirm, 'confirm button rendered');
  await confirm.props.onClick();

  assert.equal(posted.length, 1, 'exactly one POST');
  assert.equal(posted[0].content, draft, 'the composer DRAFT becomes the task content');
  assert.ok(posted[0].sendAt > Date.now(), 'sendAt in the future');
  assert.equal(posted[0].conversationId, 'sess-1');
  assert.deepEqual(posted[0].model, { provider: 'zai', model: 'glm-5.3-flash' }, 'selected model stored in the task');
  assert.deepEqual(props.__setDraft, [''], 'input cleared via inputActions.setDraft("")');
});

test('bundle: dock renders pending entries (monospace source + time + countdown + cancel), collapses beyond 3', async () => {
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
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ now: 0, tasks, modelSwitchPending: [], recentDelivered: [{ id: 't9', content: 'x', modelFallback: true, modelError: 'offline', deliveredAt: 1 }] }),
  });
  await core.refresh();

  react.reset();
  const tree = expandFn(captured.dock.__comp({ ...captured.props.dock }));
  const all = JSON.stringify(texts(tree));
  assert.match(all, /4 条定时任务/, 'collapsed summary row for >3 entries');
  assert.ok(!/'a'|'d'/.test(JSON.stringify(findAll(tree, (n) => n.props?.style?.fontFamily === 'monospace'))), 'entries hidden while collapsed');

  // expand
  const toggle = findAll(tree, (n) => n.type === 'button' && /条定时任务/.test(texts(n).join('')))[0];
  toggle.props.onClick();
  react.reset();
  const tree2 = expandFn(captured.dock.__comp({ ...captured.props.dock }));
  const mono = findAll(tree2, (n) => n.props?.style?.fontFamily === 'monospace');
  assert.equal(mono.length, 4, 'one monospace source block per entry');
  assert.equal(mono[0].props.style.whiteSpace, 'pre-wrap', 'source keeps newlines/indentation');
  const order = mono.map((n) => (Array.isArray(n.props.children) ? n.props.children[0] : n.props.children));
  assert.deepEqual(order, ['a', 'b', 'c', 'd'], 'entries in sendAt ascending order');
  const flat = JSON.stringify(texts(tree2));
  assert.match(flat, /\d{4}-\d{2}-\d{2} \d{2}:\d{2}/, 'planned local time rendered');
  assert.match(flat, /后/, 'countdown rendered');
  assert.match(flat, /取消/, 'cancel button rendered');
  assert.match(flat, /模型切换失败/, 'model-fallback note surfaced on the entry list');
});
