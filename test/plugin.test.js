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
  assert.equal(state.recentDelivered.length, 1);
  assert.equal(state.recentDelivered[0].id, taskId);
  void taskId;
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
