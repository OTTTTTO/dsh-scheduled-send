// Red/green TDD: host plugin assembly — cordis contract (inject/name/apply
// returns nothing), provide('scheduledSend'), routes registered, dispose
// cleans up, and the full due-time path fires a kind:'user' bubble message.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fs } from '../src/deps.js';
import { apply, inject, name } from '../src/index.js';

const mkdtemp = async () => await fs.mkdtemp('/tmp/dss-plugin-');

function manualTimers() {
  const jobs = new Map();
  let seq = 0;
  return {
    setTimeoutAt: (fn) => { const id = ++seq; jobs.set(id, fn); return id; },
    clearTimeout: (id) => jobs.delete(id),
    async runAll() { for (const fn of [...jobs.values()]) await fn(); jobs.clear(); },
  };
}

function fakeCtx(opts = {}) {
  const routes = new Map();
  const disposers = [];
  const events = [];
  const ctx = {
    logger: { warn: () => {}, info: () => {} },
    on: (n, fn) => { disposers.push(fn); return () => {}; },
    emit: (n, p) => events.push({ name: n, payload: p }),
    provide: (k, v) => { ctx[`__provided_${k}`] = v; },
    webServer: {
      register: (r) => { routes.set(r.path, r); return () => routes.delete(r.path); },
    },
    __routes: routes,
    __events: events,
  };
  return ctx;
}

test('cordis contract: inject=[webServer], name, apply returns undefined', async () => {
  assert.deepEqual(inject, ['webServer']);
  assert.equal(name, 'dsh-scheduled-send');
  const dir = await mkdtemp();
  const ctx = fakeCtx();
  const ret = await apply(ctx, { dataDir: dir, clock: { now: () => 1_000 }, timers: manualTimers() }, { trackAgents: () => ({ live: () => [], dispose: () => {} }) });
  assert.ok(ret === undefined, 'apply must not return a plain object (Invalid effect)');
  assert.ok(ctx.__provided_scheduledSend, "state exposed via ctx.provide('scheduledSend')");
});

test('routes registered on webServer and removed on dispose', async () => {
  const dir = await mkdtemp();
  const ctx = fakeCtx();
  await apply(ctx, { dataDir: dir, clock: { now: () => 1_000 }, timers: manualTimers() }, { trackAgents: () => ({ live: () => [], dispose: () => {} }) });
  const paths = [...ctx.__routes.keys()];
  assert.ok(paths.includes('/plugin-data/dsh-scheduled-send/state'));
  assert.ok(paths.includes('/plugin-data/dsh-scheduled-send/schedule'));
  assert.ok(paths.includes('/plugin-data/dsh-scheduled-send/model-selected'));
  ctx.__emitDispose?.();
});

test('end-to-end: POST schedule → due → normal user bubble via runMaintenance+followup', async () => {
  const dir = await mkdtemp();
  const timers = manualTimers();
  const clock = { now: () => 1_000 };
  const messages = [];
  const agent = {
    id: 'sess-1',
    followup: (m) => messages.push(m),
    runMaintenance: async (fn) => fn(),
  };
  const ctx = fakeCtx();
  await apply(ctx, { dataDir: dir, clock, timers }, {
    trackAgents: () => ({ live: () => [agent], dispose: () => {} }),
  });

  // POST a task via the real route
  const route = ctx.__routes.get('/plugin-data/dsh-scheduled-send/schedule');
  const body = JSON.stringify({ content: '到点发这条', sendAt: 5_000, conversationId: 'sess-1' });
  const res = { status: 0, body: '', writeHead(s) { this.status = s; }, end(t) { this.body = t; } };
  await route.handler({ method: 'POST', url: '/x', [Symbol.asyncIterator]: async function* () { yield body; } }, res);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const taskId = JSON.parse(res.body).task.id;

  // due time arrives
  clock.now = () => 6_000;
  await timers.runAll();

  assert.equal(messages.length, 1, 'delivered exactly once');
  const msg = messages[0];
  assert.equal(msg.role, 'user');
  assert.equal(msg.source.kind, 'user', 'normal user bubble, NOT a plugin injection line');
  assert.equal(msg.content[0].text, '到点发这条');
  assert.ok(typeof msg.id === 'string' && msg.id.length > 10, 'real message id present');

  // task gone from state
  const stateRoute = ctx.__routes.get('/plugin-data/dsh-scheduled-send/state');
  const res2 = { status: 0, body: '', writeHead(s) { this.status = s; }, end(t) { this.body = t; } };
  await stateRoute.handler({ method: 'GET', url: '/x' }, res2);
  const state = JSON.parse(res2.body);
  assert.equal(state.tasks.length, 0, 'no pending task after delivery');
  assert.equal(state.recentDelivered.length, 0, 'FIX3: clean delivery leaves NO note (old bug: every delivery became a 常驻 note)');
});

test('FIX1+FIX3 end-to-end with model: host ctx override used; clean switch leaves no note', async () => {
  const dir = await mkdtemp();
  const timers = manualTimers();
  const clock = { now: () => 1_000 };
  const messages = [];
  const requests = [];
  requests.__listeners = [];
  requests.__emit = async (payload) => {
    const list = requests.__listeners;
    const run = async (i) => (i >= list.length ? { provider: 'base', model: 'base' } : list[i](payload, async () => run(i + 1)));
    return run(0);
  };
  const agent = {
    id: 'sess-1',
    followup: (m) => messages.push(m),
    runMaintenance: async (fn) => fn(),
    ctx: {
      on: (name, fn) => {
        requests.__listeners.push(fn);
        return () => { const i = requests.__listeners.indexOf(fn); if (i >= 0) requests.__listeners.splice(i, 1); };
      },
    },
  };
  const ctx = fakeCtx();
  await apply(ctx, { dataDir: dir, clock, timers, modelSwitchGraceMs: 50 }, {
    trackAgents: () => ({ live: () => [agent], dispose: () => {} }),
  });

  const route = ctx.__routes.get('/plugin-data/dsh-scheduled-send/schedule');
  const body = JSON.stringify({ content: '带模型', sendAt: 5_000, conversationId: 'sess-1', model: { provider: 'zai', model: 'glm-5.3-flash' } });
  const res = { status: 0, body: '', writeHead(s) { this.status = s; }, end(t) { this.body = t; } };
  await route.handler({ method: 'POST', url: '/x', [Symbol.asyncIterator]: async function* () { yield body; } }, res);
  assert.equal(res.status, 200);

  clock.now = () => 6_000;
  await timers.runAll(); // fires immediately: host switch needs no client round-trip
  assert.equal(messages.length, 1, 'delivered without waiting for any client confirmation');
  const req = await requests.__emit({ config: {} });
  assert.equal(req.provider, 'zai');
  assert.equal(req.model, 'glm-5.3-flash');

  const stateRoute = ctx.__routes.get('/plugin-data/dsh-scheduled-send/state');
  const res2 = { status: 0, body: '', writeHead(s) { this.status = s; }, end(t) { this.body = t; } };
  await stateRoute.handler({ method: 'GET', url: '/x' }, res2);
  const state = JSON.parse(res2.body);
  assert.equal(state.recentDelivered.length, 0, 'successful host switch → no failure note');
  assert.equal(state.modelSwitchPending.length, 0, 'client-cooperative hub never engaged');
});

test('FIX3 end-to-end: degraded switch (no ctx, client offline) → note appears once, expires after TTL', async () => {
  const dir = await mkdtemp();
  const timers = manualTimers();
  const clock = { now: () => 1_000 };
  const messages = [];
  const agent = { id: 'sess-1', followup: (m) => messages.push(m), runMaintenance: async (fn) => fn() }; // no ctx → hub fallback
  const ctx = fakeCtx();
  await apply(ctx, { dataDir: dir, clock, timers, modelSwitchGraceMs: 50, noteTtlMs: 100 }, {
    trackAgents: () => ({ live: () => [agent], dispose: () => {} }),
  });

  const route = ctx.__routes.get('/plugin-data/dsh-scheduled-send/schedule');
  const body = JSON.stringify({ content: '降级', sendAt: 5_000, conversationId: 'sess-1', model: { provider: 'p', model: 'm' } });
  const res = { status: 0, body: '', writeHead(s) { this.status = s; }, end(t) { this.body = t; } };
  await route.handler({ method: 'POST', url: '/x', [Symbol.asyncIterator]: async function* () { yield body; } }, res);

  clock.now = () => 6_000;
  const firing = timers.runAll();
  await new Promise((r) => setTimeout(r, 10)); // delivery now awaits the hub grace timer
  await timers.runAll(); // grace timer registered after the first snapshot → fires here → degrade
  await firing;
  assert.equal(messages.length, 1, 'still delivered on the current model');

  const stateRoute = ctx.__routes.get('/plugin-data/dsh-scheduled-send/state');
  const read = async () => {
    const r2 = { status: 0, body: '', writeHead(s) { this.status = s; }, end(t) { this.body = t; } };
    await stateRoute.handler({ method: 'GET', url: '/x' }, r2);
    return JSON.parse(r2.body);
  };
  let state = await read();
  assert.equal(state.recentDelivered.length, 1, 'fallback note present');
  assert.equal(state.recentDelivered[0].modelFallback, true);
  clock.now = () => 7_000; // past noteTtlMs (100)
  state = await read();
  assert.equal(state.recentDelivered.length, 0, 'note expired — never resident forever');
});

test('end-to-end with model: due → client switch confirmed → message delivered', async () => {
  const dir = await mkdtemp();
  const timers = manualTimers();
  const clock = { now: () => 1_000 };
  const messages = [];
  const agent = {
    id: 'sess-1',
    followup: (m) => messages.push(m),
    runMaintenance: async (fn) => fn(),
  };
  const ctx = fakeCtx();
  const state = await apply(ctx, { dataDir: dir, clock, timers }, {
    trackAgents: () => ({ live: () => [agent], dispose: () => {} }),
  });
  void state;

  const route = ctx.__routes.get('/plugin-data/dsh-scheduled-send/schedule');
  const body = JSON.stringify({ content: '带模型', sendAt: 5_000, conversationId: 'sess-1', model: { provider: 'zai', model: 'glm-5.3-flash' } });
  const res = { status: 0, body: '', writeHead(s) { this.status = s; }, end(t) { this.body = t; } };
  await route.handler({ method: 'POST', url: '/x', [Symbol.asyncIterator]: async function* () { yield body; } }, res);
  assert.equal(res.status, 200);

  clock.now = () => 6_000;
  const firing = timers.runAll(); // delivery starts and awaits the client switch

  // state route exposes the pending switch
  await new Promise((r) => setTimeout(r, 10));
  const stateRoute = ctx.__routes.get('/plugin-data/dsh-scheduled-send/state');
  const res2 = { status: 0, body: '', writeHead(s) { this.status = s; }, end(t) { this.body = t; } };
  await stateRoute.handler({ method: 'GET', url: '/x' }, res2);
  const pending = JSON.parse(res2.body).modelSwitchPending;
  assert.equal(pending.length, 1);
  assert.deepEqual(pending[0].model, { provider: 'zai', model: 'glm-5.3-flash' });

  // client confirms
  const confirmRoute = ctx.__routes.get('/plugin-data/dsh-scheduled-send/model-selected');
  const res3 = { status: 0, body: '', writeHead(s) { this.status = s; }, end(t) { this.body = t; } };
  await confirmRoute.handler({ method: 'POST', url: '/x', [Symbol.asyncIterator]: async function* () { yield JSON.stringify({ taskId: pending[0].taskId }); } }, res3);
  assert.equal(res3.status, 200);

  await firing;
  assert.equal(messages.length, 1, 'delivered after confirmed switch');
  assert.equal(messages[0].source.kind, 'user');
});
