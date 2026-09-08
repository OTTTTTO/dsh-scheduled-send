// Red/green TDD: client core — pure logic testable in Node (sorting, collapse,
// immediate local enqueue after POST, model-switch cooperation, cancel).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  sortTasks, collapseState, formatLocalTime, formatCountdown,
  createScheduledClientState, defaultSendAt,
} from '../src/client-core.js';

test('sortTasks orders by sendAt ascending', () => {
  const tasks = [
    { id: 'b', sendAt: 3 }, { id: 'a', sendAt: 1 }, { id: 'c', sendAt: 2 },
  ];
  assert.deepEqual(sortTasks(tasks).map((t) => t.id), ['a', 'c', 'b']);
  assert.deepEqual(sortTasks(null), []);
});

test('collapseState: ≤3 entries shown flat; >3 collapse into a summary row', () => {
  const three = [{ id: 1 }, { id: 2 }, { id: 3 }];
  assert.deepEqual(collapseState(three), { collapsed: false, visibleCount: 3, summary: null });
  const four = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }];
  const st = collapseState(four);
  assert.equal(st.collapsed, true);
  assert.equal(st.visibleCount, 4);
  assert.equal(st.summary, '4 条定时任务 ⌄');
});

test('formatLocalTime renders local YYYY-MM-DD HH:mm', () => {
  const d = new Date(2026, 0, 5, 7, 9);
  assert.equal(formatLocalTime(d.getTime()), '2026-01-05 07:09');
});

test('formatCountdown renders remaining time until sendAt', () => {
  const now = 1_000_000;
  assert.equal(formatCountdown(now + 90_000, now), '1分30秒后');
  assert.equal(formatCountdown(now + 3_600_000, now), '1小时0分后');
  assert.equal(formatCountdown(now - 5, now), '即将发送');
});

test('defaultSendAt = now + 5 minutes', () => {
  assert.equal(defaultSendAt(1_000), 1_000 + 5 * 60_000);
});

test('scheduleMessage POSTs and shows the task IMMEDIATELY (no refresh needed)', async () => {
  const posted = [];
  const core = createScheduledClientState({
    fetchState: async () => ({ now: 0, tasks: [], modelSwitchPending: [], recentDelivered: [] }),
    postSchedule: async (payload) => {
      posted.push(payload);
      return { task: { id: 't1', ...payload } };
    },
    cancelSchedule: async () => true,
    now: () => 0,
  });
  const task = await core.scheduleMessage({ content: 'hi', sendAt: 5_000, conversationId: 's1', model: { provider: 'p', model: 'm' } });
  assert.equal(task.id, 't1');
  assert.deepEqual(posted[0], { content: 'hi', sendAt: 5_000, conversationId: 's1', model: { provider: 'p', model: 'm' } });
  assert.equal(core.visibleTasks().length, 1, 'locally enqueued right after POST');
  assert.equal(core.visibleTasks()[0].content, 'hi');
});

test('cancelTask removes the entry locally', async () => {
  const core = createScheduledClientState({
    fetchState: async () => ({ now: 0, tasks: [], modelSwitchPending: [], recentDelivered: [] }),
    postSchedule: async (p) => ({ task: { id: 't1', ...p } }),
    cancelSchedule: async () => true,
    now: () => 0,
  });
  await core.scheduleMessage({ content: 'x', sendAt: 5_000, conversationId: 's' });
  await core.cancelTask('t1');
  assert.equal(core.visibleTasks().length, 0);
});

test('refresh replaces the task list with the server view (sorted)', async () => {
  let server = { now: 0, tasks: [], modelSwitchPending: [], recentDelivered: [] };
  const core = createScheduledClientState({
    fetchState: async () => server,
    postSchedule: async () => ({}),
    cancelSchedule: async () => true,
    now: () => 0,
  });
  server = { now: 0, tasks: [{ id: 'z', sendAt: 9 }, { id: 'y', sendAt: 2 }], modelSwitchPending: [], recentDelivered: [] };
  await core.refresh();
  assert.deepEqual(core.visibleTasks().map((t) => t.id), ['y', 'z']);
  assert.equal(core.lastDelivered().length, 0);
  const note = { id: 'z', content: 'x', modelFallback: true, modelError: 'offline', deliveredAt: 5 };
  server = { now: 6, tasks: [], modelSwitchPending: [], recentDelivered: [note] };
  await core.refresh();
  assert.deepEqual(core.lastDelivered(), [note], 'model-fallback notes surface for the dock');
});

test('model-switch cooperation: switches via dir.select then confirms, once per taskId, own session only', async () => {
  let server = {
    now: 0,
    tasks: [],
    modelSwitchPending: [
      { taskId: 't1', model: { provider: 'p', model: 'flash' }, conversationId: 'my-sess' },
      { taskId: 't2', model: { provider: 'p', model: 'flash' }, conversationId: 'other-sess' },
    ],
    recentDelivered: [],
  };
  const selected = [];
  const confirmed = [];
  const core = createScheduledClientState({
    fetchState: async () => server,
    postSchedule: async () => ({}),
    cancelSchedule: async () => true,
    confirmModelSwitch: async (taskId) => { confirmed.push(taskId); return true; },
    selectModel: async (model) => { selected.push(model); },
    now: () => 0,
  });
  await core.refresh();
  await core.handleModelSwitches('my-sess');
  assert.deepEqual(selected, [{ provider: 'p', model: 'flash' }], 'only own-session switch executed');
  assert.deepEqual(confirmed, ['t1']);
  await core.handleModelSwitches('my-sess');
  assert.equal(selected.length, 1, 'no duplicate switch for the same taskId');
});

test('start/stop poll loop drives refresh', async () => {
  let fetched = 0;
  const core = createScheduledClientState({
    fetchState: async () => { fetched++; return { now: 0, tasks: [], modelSwitchPending: [], recentDelivered: [] }; },
    postSchedule: async () => ({}),
    cancelSchedule: async () => true,
    now: () => 0,
  });
  core.start(5);
  await new Promise((r) => setTimeout(r, 20));
  core.stop();
  assert.ok(fetched >= 1, 'at least one fetch happened');
});
