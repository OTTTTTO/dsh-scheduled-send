// Host-side HTTP routes for the browser client. The web GUI cannot subscribe
// to host cordis events directly; the browser client polls GET state and
// calls POST/DELETE for scheduling. Payloads are display-safe only (no
// secrets ever leave the host).
//
//   GET    /plugin-data/dsh-scheduled-send/state          → {now, tasks[], modelSwitchPending[], recentDelivered[]}
//   POST   /plugin-data/dsh-scheduled-send/schedule       → create {content, sendAt, conversationId, model?}
//   DELETE /plugin-data/dsh-scheduled-send/schedule?id=…  → cancel
//   POST   /plugin-data/dsh-scheduled-send/model-selected → client confirms a model switch

export const STATE_PATH = '/plugin-data/dsh-scheduled-send/state';
export const SCHEDULE_PATH = '/plugin-data/dsh-scheduled-send/schedule';
export const MODEL_SELECTED_PATH = '/plugin-data/dsh-scheduled-send/model-selected';

/**
 * Client-cooperative model switch hub. At due time the host asks the browser
 * client (via the state route's modelSwitchPending list) to dir.select the
 * task's model; the client confirms through the model-selected route. If no
 * confirmation arrives within graceMs the switch is treated as failed and
 * delivery degrades to the current model.
 * @param {object} opts { clock:{now}, timers:{setTimeoutAt,clearTimeout}, graceMs }
 */
export function createModelSwitchHub({ clock = { now: () => Date.now() }, timers = null, graceMs = 15_000 } = {}) {
  const realTimers = timers || {
    setTimeoutAt: (fn, atMs) => { const t = setTimeout(fn, Math.max(0, atMs - Date.now())); t.unref?.(); return t; },
    clearTimeout: (t) => clearTimeout(t),
  };
  const pending = new Map(); // taskId → {entry, resolve, timerId}

  const settle = (taskId, ok) => {
    const rec = pending.get(taskId);
    if (!rec) return false;
    pending.delete(taskId);
    realTimers.clearTimeout(rec.timerId);
    rec.resolve(ok);
    return true;
  };

  return {
    /** Wait for the client to confirm the model switch for this task. */
    expect(task) {
      return new Promise((resolve) => {
        const timerId = realTimers.setTimeoutAt(() => settle(task.id, false), clock.now() + graceMs);
        pending.set(task.id, {
          entry: { taskId: task.id, model: task.model, conversationId: task.conversationId || null },
          resolve,
          timerId,
        });
      });
    },
    /** Client confirmed → true when a pending switch was settled. */
    confirm(taskId) {
      if (typeof taskId !== 'string' || !taskId) return Promise.resolve(false);
      return Promise.resolve(settle(taskId, true));
    },
    /** Switches the browser client still owes (state route payload). */
    pending() {
      return [...pending.values()].map((r) => ({ ...r.entry }));
    },
    async dispose() {
      for (const taskId of [...pending.keys()]) settle(taskId, false);
    },
  };
}

/**
 * Register all four routes on the host webServer.
 * @param {object} webServer ctx.webServer (dsh-host-webserver service)
 * @param {object} cache ctx.scheduledSend state: {scheduler, hub, recentDelivered, now}
 * @returns {() => void} disposer
 */
export function registerScheduledSendRoutes(webServer, cache) {
  const now = () => (typeof cache.now === 'function' ? cache.now() : Date.now());
  const sendJson = (res, status, payload) => {
    // dsh-host-webserver contract: the handler owns the raw node response —
    // it must writeHead/end itself; returning an object writes nothing.
    res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify(payload));
  };
  const readBody = async (req) => {
    let text = '';
    for await (const chunk of req || []) text += chunk;
    if (!text) return {};
    try { return JSON.parse(text); } catch { return null; }
  };

  const disposers = [];

  // FIX 3: recentDelivered entries are fallback notes with a limited
  // lifetime — prune expired ones on read so no note stays resident forever.
  const pruneNotes = () => {
    const ttl = typeof cache.noteTtlMs === 'number' ? cache.noteTtlMs : 600_000;
    const t = now();
    if (Array.isArray(cache.recentDelivered)) {
      cache.recentDelivered = cache.recentDelivered.filter((n) => t - (n.deliveredAt ?? 0) < ttl);
    }
    return cache.recentDelivered ?? [];
  };

  // GET state (fix 2: ?conversationId= filters every list to that conversation)
  disposers.push(webServer.register({
    kind: 'exact',
    path: STATE_PATH,
    handler: async (req = {}, res) => {
      if ((req.method || 'GET').toUpperCase() !== 'GET') {
        sendJson(res, 405, { error: 'method not allowed' });
        return;
      }
      const cid = new URL(req.url ?? '/', 'http://x').searchParams.get('conversationId');
      const own = (it) => !cid || it?.conversationId === cid;
      sendJson(res, 200, {
        now: now(),
        tasks: (cache.scheduler?.list?.() ?? []).filter(own),
        modelSwitchPending: (cache.hub?.pending?.() ?? []).filter(own),
        recentDelivered: pruneNotes().filter(own),
      });
    },
  }));

  // POST/DELETE schedule
  disposers.push(webServer.register({
    kind: 'exact',
    path: SCHEDULE_PATH,
    handler: async (req = {}, res) => {
      const method = (req.method || 'GET').toUpperCase();
      if (method !== 'POST' && method !== 'DELETE') {
        sendJson(res, 405, { error: 'method not allowed' });
        return;
      }
      if (method === 'DELETE') {
        const id = new URL(req.url ?? '/', 'http://x').searchParams.get('id');
        if (!id) { sendJson(res, 400, { error: '缺少 id 参数' }); return; }
        const ok = await cache.scheduler?.cancel?.(id);
        sendJson(res, ok ? 200 : 404, ok ? { cancelled: id } : { error: '任务不存在或已发送' });
        return;
      }
      const body = await readBody(req);
      if (body === null || typeof body !== 'object') { sendJson(res, 400, { error: '请求体必须是 JSON 对象' }); return; }
      const content = typeof body.content === 'string' ? body.content : '';
      const sendAt = body.sendAt;
      const conversationId = typeof body.conversationId === 'string' ? body.conversationId : '';
      if (!content.trim()) { sendJson(res, 400, { error: '定时内容不能为空' }); return; }
      if (typeof sendAt !== 'number' || !Number.isFinite(sendAt) || sendAt <= now()) {
        sendJson(res, 400, { error: 'sendAt 必须是未来的时间戳（epoch ms）' });
        return;
      }
      if (!conversationId) { sendJson(res, 400, { error: '缺少 conversationId（会话绑定）' }); return; }
      const model = body.model && typeof body.model === 'object' && body.model.model ? body.model : null;
      try {
        const task = await cache.scheduler.schedule({ content, sendAt, conversationId, model });
        sendJson(res, 200, { task });
      } catch (err) {
        sendJson(res, 400, { error: String(err?.message || err) });
      }
    },
  }));

  // POST model-selected (client confirms a pending model switch)
  disposers.push(webServer.register({
    kind: 'exact',
    path: MODEL_SELECTED_PATH,
    handler: async (req = {}, res) => {
      if ((req.method || 'POST').toUpperCase() !== 'POST') {
        sendJson(res, 405, { error: 'method not allowed' });
        return;
      }
      const body = await readBody(req);
      const ok = await cache.hub?.confirm?.(body?.taskId);
      sendJson(res, ok ? 200 : 404, ok ? { ok: true } : { error: '无待确认的模型切换' });
    },
  }));

  return () => { for (const d of disposers) d(); };
}
