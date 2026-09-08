// Real injection channel for scheduled tasks. When a task comes due, we
// build a REAL user message (role 'user', fresh id, source kind 'user' with a
// `via` tag — NOT kind 'plugin', which the UI renders as an injected line
// instead of a normal user bubble) and hand it to the live agent of the task's
// ORIGINAL conversation via agent.runMaintenance(() => agent.followup(msg)).
// This mirrors the host's real prompt path
// (@deepseek-ai/dsh-api-session-controller prompt(): createUserMessage with
// kind:"user" source + followup). If the session is not live or the agent is
// busy, delivery throws so the scheduler keeps the task queued and retries.

export const PLUGIN_NAME = 'dsh-scheduled-send';

/**
 * Inline equivalent of @deepseek-ai/dsh-llm createUserMessage: completes the
 * message with role 'user' and a fresh stable UUID id, then freezes it before
 * publication (same contract as the host's createUserMessage, which is not
 * resolvable from a plugin directory).
 */
export function defaultCreateUserMessage(spec) {
  const message = {
    id: crypto.randomUUID(),
    role: 'user',
    content: spec.content,
    source: spec.source,
  };
  return Object.freeze(message);
}

/**
 * Track root agents published after plugin load (same install rule as
 * dsh-schedule: agents live at load time are not adopted). agent.id IS the
 * conversation/session id (dsh-agent: agent id must equal session id), so
 * tasks bind back to their original conversation after restarts.
 * @param {object} ctx host plugin context exposing ctx.on
 * @returns {{agents:()=>any[], live:()=>any[], dispose:()=>void}}
 */
export function installAgentTracking(ctx) {
  const agents = new Set();
  let stopped = false;
  const offCreated = ctx?.on?.('agent/created', ({ agent }) => {
    if (stopped || !agent || typeof agent.followup !== 'function') return;
    agents.add(agent);
  });
  const offDisposed = ctx?.on?.('agent/disposed', ({ agent }) => {
    agents.delete(agent);
  });
  return {
    agents: () => [...agents],
    live: () => [...agents].filter((a) => typeof a.followup === 'function'),
    dispose: () => {
      stopped = true; // stop accepting new ones
      if (typeof offCreated === 'function') offCreated();
      if (typeof offDisposed === 'function') offDisposed();
    },
  };
}

/**
 * HOST-side model switch (fix 1). Mirrors the host's own write path —
 * @deepseek-ai/dsh-agent installModelSelection (lib/index.js:272) couples
 * model selection to the agent-scoped `agent/request` waterfall, and
 * dsh-api-session-controller selectModel (lib/index.js:596) installs the
 * selection for the NEXT request of the live agent. We register the same
 * one-shot `agent/request` override on agent.ctx: the very next LLM request
 * of that agent is routed to {provider, model}, then the listener removes
 * itself. Works with the GUI closed (no browser round-trip).
 * @param {object} agent live agent (needs agent.ctx.on, the scoped context)
 * @param {{provider:string, model:string}} model
 * @returns {{dispose:()=>void}} capability to drop the override early
 */
export function installHostModelOverride(agent, model) {
  const agentCtx = agent && agent.ctx;
  if (!agentCtx || typeof agentCtx.on !== 'function') {
    throw new Error('宿主代理上下文不可用，无法执行宿主侧模型切换');
  }
  let off = null;
  const dispose = () => {
    if (off) { const fn = off; off = null; fn(); }
  };
  off = agentCtx.on('agent/request', async (_payload, next) => {
    const resolved = await next();
    dispose(); // one-shot: only the next request is switched
    return {
      ...resolved,
      provider: model.provider,
      model: model.model,
    };
  });
  return { dispose };
}

/**
 * Build the delivery callback for the scheduler: inject one due task into the
 * live session of its conversation as a follow-up user message.
 * @param {object} p
 * @param {{live:()=>any[]}} p.tracking agent tracking from installAgentTracking
 * @param {(spec:object)=>object} [p.createUserMessage] message factory (injectable)
 * @param {(agent:object, model:object)=>{dispose:()=>void}} [p.installModelOverride]
 *        host-side switch (default installHostModelOverride); throws/returns
 *        falsy when unavailable → falls back to the client-cooperative hook.
 * @param {(item:object)=>Promise<{ok:boolean, error?:string}>} [p.switchModel]
 *        client-cooperative FALLBACK hook (dir.select); optional.
 * @param {string} [p.pluginName]
 * @returns {(item:{id:string, content:string, conversationId?:string, model?:object}) => Promise<true|{modelFallback:true, modelError:string}>}
 */
export function createFollowupDelivery({
  tracking,
  createUserMessage = defaultCreateUserMessage,
  installModelOverride = installHostModelOverride,
  switchModel = null,
  pluginName = PLUGIN_NAME,
} = {}) {
  return async function deliver(item) {
    const live = tracking.live();
    // bind to the task's conversation (agent.id === conversationId): a task
    // bound to a conversation NEVER falls through to another live session
    // (会话绑定); only legacy tasks without a conversationId may use any agent.
    const agent = item.conversationId
      ? live.find((a) => a.id === item.conversationId) ?? null
      : live[0] ?? null;
    if (!agent) {
      const err = new Error('当前无活跃会话代理，任务保留在队列等待会话恢复后补发');
      err.code = 'NO_LIVE_AGENT';
      throw err;
    }
    // model pre-switch (fix 1): prefer the HOST-side one-shot agent/request
    // override (works headless, GUI closed); the client-cooperative hook is
    // only a fallback; total failure degrades to the CURRENT model with a
    // dismissible note on the task entry (spec: 切换失败降级).
    let modelFallback = null;
    let override = null;
    if (item.model) {
      try {
        if (typeof installModelOverride === 'function') override = installModelOverride(agent, item.model);
      } catch {
        override = null; // host path unavailable → try the fallback below
      }
      if (!override) {
        if (typeof switchModel === 'function') {
          const r = await switchModel(item).catch((err) => ({ ok: false, error: String(err?.message || err) }));
          if (!r || r.ok !== true) modelFallback = { modelError: r?.error || 'model switch failed' };
        } else {
          modelFallback = { modelError: '无可用模型切换通道' };
        }
      }
    }
    const message = createUserMessage({
      content: [{ type: 'text', text: item.content }],
      source: { kind: 'user', via: pluginName },
    });
    // runMaintenance throws when the agent is mid-turn (busy) — the throw
    // propagates so the scheduler re-queues with backoff. The pending host
    // override is dropped so it cannot leak into a later unrelated request
    // (the retry re-installs it).
    try {
      await agent.runMaintenance(async () => {
        agent.followup(message);
        return true;
      });
    } catch (err) {
      override?.dispose?.();
      throw err;
    }
    if (modelFallback) return { modelFallback: true, modelError: modelFallback.modelError };
    return true;
  };
}
