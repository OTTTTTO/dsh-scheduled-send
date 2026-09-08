// Red/green TDD: host routes — state GET / schedule POST / cancel DELETE /
// model-selected POST on the host webServer. Display-safe: no secrets.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fs } from '../src/deps.js';
import { registerScheduledSendRoutes, STATE_PATH, SCHEDULE_PATH, MODEL_SELECTED_PATH } from '../src/host-routes.js';
import { createScheduler } from '../src/scheduler.js';
import { createModelSwitchHub } from '../src/host-routes.js';

// --- tiny fakes ------------------------------------------------------------
function fakeWebServer() {
  const routes = new Map();
  return {
    routes,
    register(route) { routes.set(route.path, route); return () => routes.delete(route.path); },
  };
}
const fakeReq = async (method, url, body) => {
  const req = { method, url };
  if (body !== undefined) {
    const text = JSON.stringify(body);
    req[Symbol.asyncIterator] = async function* () { yield text; };
  }
  return req;
};
const fakeRes = () => {
  const r = { status: 0, headers: null, body: '', ended: false };
  r.writeHead = (status, headers) => { r.status = status; r.headers = headers; };
  r.end = (text) => { r.body = String(text ?? ''); r.ended = true; };
  return r;
};
const jsonOf = (r) => JSON.parse(r.body);

const mkdtemp = async () => await fs.mkdtemp('/tmp/dss-routes-');

async function mkStack(opts = {}) {
  const ws = fakeWebServer();
  const dir = await mkdtemp();
  const clock = { now: () => 1_000 };
  const hub = opts.hub || createModelSwitchHub({ clock, graceMs: 60_000, timers: manualTimers() });
  const scheduler = await createScheduler({ dataDir: dir, clock, timers: manualTimers(), deliver: opts.deliver || (async () => {}) });
  const cache = { scheduler, hub, recentDelivered: [], now: () => clock.now() };
  registerScheduledSendRoutes(ws, cache);
  const call = async (method, url, body) => {
    const route = [...ws.routes.values()].find((r) => url.startsWith(r.path.split('?')[0]));
    const res = fakeRes();
    await route.handler(await fakeReq(method, url, body), res);
    return res;
  };
  return { ws, scheduler, hub, cache, call, clock, dir };
}
function manualTimers() {
  const jobs = new Map();
  let seq = 0;
  return {
    setTimeoutAt: (fn) => { const id = ++seq; jobs.set(id, fn); return id; },
    clearTimeout: (id) => jobs.delete(id),
    async runAll() { for (const fn of [...jobs.values()]) await fn(); jobs.clear(); },
  };
}

// --- tests -----------------------------------------------------------------
test('paths are namespaced to this plugin', () => {
  assert.equal(STATE_PATH, '/plugin-data/dsh-scheduled-send/state');
  assert.equal(SCHEDULE_PATH, '/plugin-data/dsh-scheduled-send/schedule');
  assert.equal(MODEL_SELECTED_PATH, '/plugin-data/dsh-scheduled-send/model-selected');
});

test('GET state returns tasks (ascending) + now, display-safe', async () => {
  const { call } = await mkStack();
  await call('POST', SCHEDULE_PATH, { content: 'b', sendAt: 9_000, conversationId: 's' });
  await call('POST', SCHEDULE_PATH, { content: 'a', sendAt: 4_000, conversationId: 's' });
  const res = await call('GET', STATE_PATH);
  assert.equal(res.status, 200);
  assert.equal(res.headers['cache-control'], 'no-store');
  const body = jsonOf(res);
  assert.equal(body.now, 1_000);
  assert.deepEqual(body.tasks.map((t) => t.content), ['a', 'b'], 'tasks sorted ascending by sendAt');
  assert.ok(!JSON.stringify(body).match(/apiKey|token|password/i), 'no secret-ish keys anywhere');
});

test('POST schedule validates: empty content / past sendAt / missing conversationId → 400', async () => {
  const { call, scheduler } = await mkStack();
  assert.equal((await call('POST', SCHEDULE_PATH, { content: '  ', sendAt: 5_000, conversationId: 's' })).status, 400);
  assert.equal((await call('POST', SCHEDULE_PATH, { content: 'x', sendAt: 999, conversationId: 's' })).status, 400, 'past sendAt rejected');
  assert.equal((await call('POST', SCHEDULE_PATH, { content: 'x', sendAt: 5_000 })).status, 400, 'missing conversationId rejected');
  assert.equal(scheduler.list().length, 0, 'nothing enqueued');
});

test('POST schedule success: 200 with the created task (model kept)', async () => {
  const { call } = await mkStack();
  const model = { provider: 'p', model: 'flash' };
  const res = await call('POST', SCHEDULE_PATH, { content: 'hello', sendAt: 5_000, conversationId: 'sess-1', model });
  assert.equal(res.status, 200);
  const task = jsonOf(res).task;
  assert.equal(task.content, 'hello');
  assert.equal(task.conversationId, 'sess-1');
  assert.deepEqual(task.model, model);
});

test('POST schedule rejects a non-JSON body with 400', async () => {
  const { call, ws } = await mkStack();
  const route = ws.routes.get(SCHEDULE_PATH);
  const res = fakeRes();
  await route.handler({ method: 'POST', url: SCHEDULE_PATH, [Symbol.asyncIterator]: async function* () { yield '{oops'; } }, res);
  assert.equal(res.status, 400);
});

test('DELETE ?id cancels: 200 when removed, 404 otherwise', async () => {
  const { call } = await mkStack();
  const res = await call('POST', SCHEDULE_PATH, { content: 'x', sendAt: 5_000, conversationId: 's' });
  const id = jsonOf(res).task.id;
  assert.equal((await call('DELETE', SCHEDULE_PATH + '?id=' + encodeURIComponent(id))).status, 200);
  assert.equal((await call('DELETE', SCHEDULE_PATH + '?id=' + encodeURIComponent(id))).status, 404);
  assert.equal((await call('DELETE', SCHEDULE_PATH)).status, 400, 'missing id → 400');
});

test('unsupported methods → 405', async () => {
  const { call } = await mkStack();
  assert.equal((await call('PUT', SCHEDULE_PATH, {})).status, 405);
  assert.equal((await call('POST', STATE_PATH, {})).status, 405);
});

test('model-switch hub: expect/confirm + timeout fallback, exposed via state', async () => {
  const timers = manualTimers();
  const clock = { now: () => 0 };
  const hub = createModelSwitchHub({ clock, timers, graceMs: 10_000 });
  const p = hub.expect({ id: 't1', model: { provider: 'p', model: 'm' }, conversationId: 's' });
  assert.deepEqual(hub.pending(), [{ taskId: 't1', model: { provider: 'p', model: 'm' }, conversationId: 's' }]);
  assert.equal(await hub.confirm('t1'), true);
  assert.equal(await p, true, 'confirmed switch resolves true');
  assert.deepEqual(hub.pending(), [], 'cleared after confirm');

  const p2 = hub.expect({ id: 't2', model: { provider: 'p', model: 'm' }, conversationId: 's' });
  clock.now = () => 20_000; // past grace
  await timers.runAll();
  assert.equal(await p2, false, 'timeout resolves false → degrade to current model');
  assert.deepEqual(hub.pending(), []);
  assert.equal(await hub.confirm('t2'), false, 'late confirm after timeout is a no-op');
});

test('POST model-selected confirms a pending switch', async () => {
  const timers = manualTimers();
  const hub = createModelSwitchHub({ clock: { now: () => 0 }, timers, graceMs: 60_000 });
  const p = hub.expect({ id: 't9', model: { provider: 'p', model: 'm' }, conversationId: 's' });
  const ws = fakeWebServer();
  registerScheduledSendRoutes(ws, { scheduler: { list: () => [] }, hub, recentDelivered: [], now: () => 0 });
  const route = ws.routes.get(MODEL_SELECTED_PATH);
  const res = fakeRes();
  await route.handler(await fakeReq('POST', MODEL_SELECTED_PATH, { taskId: 't9' }), res);
  assert.equal(res.status, 200);
  assert.equal(await p, true);
  const res2 = fakeRes();
  await route.handler(await fakeReq('POST', MODEL_SELECTED_PATH, { taskId: 'nope' }), res2);
  assert.equal(res2.status, 404);
});
