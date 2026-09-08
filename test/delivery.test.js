// Red/green TDD: delivery — due tasks become NORMAL user bubbles via the
// live agent (runMaintenance + followup with a kind:'user' source message).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installAgentTracking, createFollowupDelivery, defaultCreateUserMessage } from '../src/delivery.js';

function mkCtx() {
  const listeners = new Map();
  return {
    on: (name, fn) => {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name).add(fn);
      return () => listeners.get(name)?.delete(fn);
    },
    emit: (name, payload) => { for (const fn of listeners.get(name) || []) fn(payload); },
  };
}

function mkAgent(id, extra = {}) {
  const agent = {
    id,
    messages: [],
    runMaintenance: extra.runMaintenance || (async (fn) => fn()),
    ...extra,
  };
  if (!extra.followup) agent.followup = (m) => agent.messages.push(m);
  return agent;
}

test('installAgentTracking adopts agents created after load, drops them on dispose', () => {
  const ctx = mkCtx();
  const t = installAgentTracking(ctx);
  const a = mkAgent('sess-1');
  ctx.emit('agent/created', { agent: a });
  assert.equal(t.live().length, 1);
  ctx.emit('agent/disposed', { agent: a });
  assert.equal(t.live().length, 0, 'disposed agent no longer live');
  t.dispose();
});

test('defaultCreateUserMessage: real user-message shape (id + role user + via source)', () => {
  const m = defaultCreateUserMessage({
    content: [{ type: 'text', text: 'hi' }],
    source: { kind: 'user', via: 'dsh-scheduled-send' },
  });
  assert.equal(m.role, 'user', 'role user → renders as a normal user bubble');
  assert.ok(typeof m.id === 'string' && m.id.length > 10, 'has a fresh message id (UUID)');
  assert.deepEqual(m.content, [{ type: 'text', text: 'hi' }]);
  assert.equal(m.source.kind, 'user');
  assert.equal(m.source.via, 'dsh-scheduled-send');
  const m2 = defaultCreateUserMessage({ content: [], source: { kind: 'user' } });
  assert.notEqual(m.id, m2.id, 'fresh id per message');
});

test('deliver injects a kind:user message through runMaintenance+followup', async () => {
  const ctx = mkCtx();
  const tracking = installAgentTracking(ctx);
  const agent = mkAgent('sess-1');
  ctx.emit('agent/created', { agent });
  const deliver = createFollowupDelivery({ tracking });
  const ok = await deliver({ id: 't1', content: '到点内容', conversationId: 'sess-1' });
  assert.equal(ok, true);
  assert.equal(agent.messages.length, 1);
  const msg = agent.messages[0];
  assert.equal(msg.role, 'user');
  assert.equal(msg.source.kind, 'user', 'NOT plugin-source (that renders as an injected line, not a bubble)');
  assert.equal(msg.content[0].text, '到点内容');
});

test('deliver binds to the task conversationId, not just any live agent', async () => {
  const ctx = mkCtx();
  const tracking = installAgentTracking(ctx);
  const other = mkAgent('sess-other');
  const mine = mkAgent('sess-mine');
  ctx.emit('agent/created', { agent: other });
  ctx.emit('agent/created', { agent: mine });
  const deliver = createFollowupDelivery({ tracking });
  await deliver({ id: 't1', content: 'x', conversationId: 'sess-mine' });
  assert.equal(mine.messages.length, 1);
  assert.equal(other.messages.length, 0, 'wrong session untouched');
});

test('no live agent for the conversation → NO_LIVE_AGENT error keeps the task queued', async () => {
  const ctx = mkCtx();
  const tracking = installAgentTracking(ctx);
  ctx.emit('agent/created', { agent: mkAgent('sess-1') });
  const deliver = createFollowupDelivery({ tracking });
  await assert.rejects(
    () => deliver({ id: 't1', content: 'x', conversationId: 'sess-gone' }),
    (err) => err.code === 'NO_LIVE_AGENT',
  );
});

test('model task: switches model first when the client confirms; failure degrades with a note', async () => {
  const ctx = mkCtx();
  const tracking = installAgentTracking(ctx);
  const agent = mkAgent('sess-1');
  ctx.emit('agent/created', { agent });
  const model = { provider: 'p', model: 'flash' };

  const okSwitch = createFollowupDelivery({
    tracking,
    switchModel: async () => ({ ok: true }),
  });
  const r1 = await okSwitch({ id: 't1', content: 'a', conversationId: 'sess-1', model });
  assert.equal(r1, true);

  const failSwitch = createFollowupDelivery({
    tracking,
    switchModel: async () => ({ ok: false, error: 'client offline' }),
  });
  const r2 = await failSwitch({ id: 't2', content: 'b', conversationId: 'sess-1', model });
  assert.deepEqual(r2, { modelFallback: true, modelError: 'client offline' }, 'degrades to current model with a surfaced note');
  assert.equal(agent.messages.length, 2, 'message still delivered after failed switch');
});

test('busy agent (runMaintenance throws) propagates so the scheduler retries', async () => {
  const ctx = mkCtx();
  const tracking = installAgentTracking(ctx);
  const agent = mkAgent('sess-1', { runMaintenance: async () => { throw new Error('busy'); } });
  ctx.emit('agent/created', { agent });
  const deliver = createFollowupDelivery({ tracking });
  await assert.rejects(() => deliver({ id: 't1', content: 'x', conversationId: 'sess-1' }), /busy/);
});

// --- FIX 1: host-side model switch -------------------------------------------
function mkWaterfallCtx() {
  const listeners = new Map();
  const ctx = {
    on: (name, fn) => {
      if (!listeners.has(name)) listeners.set(name, []);
      const list = listeners.get(name);
      list.push(fn);
      return () => { const i = list.indexOf(fn); if (i >= 0) list.splice(i, 1); };
    },
  };
  ctx.__emitRequest = async (payload) => {
    const list = listeners.get('agent/request') || [];
    const run = async (i) => (i >= list.length ? { provider: 'base', model: 'base-model' } : list[i](payload, async () => run(i + 1)));
    return run(0);
  };
  return ctx;
}

test('FIX1 host-side switch: agent/request override applies the model to the next request, one-shot', async () => {
  const ctx = mkCtx();
  const tracking = installAgentTracking(ctx);
  const waterfall = mkWaterfallCtx();
  const agent = mkAgent('sess-1');
  agent.ctx = waterfall;
  ctx.emit('agent/created', { agent });

  let hookUsed = false;
  const deliver = createFollowupDelivery({
    tracking,
    switchModel: async () => { hookUsed = true; return { ok: true }; },
  });
  const r = await deliver({ id: 't1', content: 'x', conversationId: 'sess-1', model: { provider: 'zai', model: 'glm-5.3-flash' } });
  assert.equal(r, true, 'no fallback when the host switch installs');
  assert.equal(hookUsed, false, 'client-cooperative hook is only the fallback, never used when the host path works');

  const first = await waterfall.__emitRequest({ config: {} });
  assert.equal(first.provider, 'zai', 'next request routed to the selected provider');
  assert.equal(first.model, 'glm-5.3-flash');

  const second = await waterfall.__emitRequest({ config: {} });
  assert.equal(second.provider, 'base', 'override is one-shot: later requests keep their own config');
  assert.equal(agent.messages.length, 1, 'message delivered');
});

test('FIX1 host-side switch: override disposed when the turn cannot start (busy agent)', async () => {
  const ctx = mkCtx();
  const tracking = installAgentTracking(ctx);
  const waterfall = mkWaterfallCtx();
  const agent = mkAgent('sess-1', { runMaintenance: async () => { throw new Error('busy'); } });
  agent.ctx = waterfall;
  ctx.emit('agent/created', { agent });
  const deliver = createFollowupDelivery({ tracking });
  await assert.rejects(() => deliver({ id: 't1', content: 'x', conversationId: 'sess-1', model: { provider: 'p', model: 'm' } }), /busy/);
  const req = await waterfall.__emitRequest({ config: {} });
  assert.equal(req.provider, 'base', 'override cleaned up so it cannot leak into a later unrelated request');
});

test('FIX1 host-side switch unavailable (no agent.ctx) → client-cooperative fallback + degrade note', async () => {
  const ctx = mkCtx();
  const tracking = installAgentTracking(ctx);
  const agent = mkAgent('sess-1'); // no ctx → host path unavailable
  ctx.emit('agent/created', { agent });
  const deliver = createFollowupDelivery({ tracking, switchModel: async () => ({ ok: false, error: 'client offline' }) });
  const r = await deliver({ id: 't1', content: 'x', conversationId: 'sess-1', model: { provider: 'p', model: 'm' } });
  assert.deepEqual(r, { modelFallback: true, modelError: 'client offline' });
});
