// dsh-scheduled-send — host-side cordis plugin entry.
// Assembles the scheduled-send service: persistent task queue (scheduler),
// due-time delivery into the ORIGINAL conversation as a normal user bubble
// (delivery), and the host HTTP routes the browser client talks to
// (host-routes). Model switching has been REMOVED: legacy tasks carrying a
// `model` field deliver normally with the field ignored.

import { createScheduler } from './scheduler.js';
import { installAgentTracking, createFollowupDelivery } from './delivery.js';
import { registerScheduledSendRoutes } from './host-routes.js';

/**
 * Cordis plugin metadata: the loader reads the named `inject` export to wire
 * required host services into ctx before apply() runs. Without it, reading
 * `ctx.webServer` throws "cannot get property without inject" at boot.
 */
export const inject = ['webServer'];
export const name = 'dsh-scheduled-send';

/**
 * @param {object} ctx host plugin context
 * @param {object} [config] {dataDir} overrides
 * @param {object} [deps] test hooks: trackAgents(ctx), createUserMessage(spec),
 *        deliverDue(item), clock, timers.
 */
export async function apply(ctx, config = {}, deps = {}) {
  const dataDir = config.dataDir || `${process.env.HOME}/.dsh/dsh-scheduled-send`;
  const clock = deps.clock || config.clock || { now: () => Date.now() };
  const timers = deps.timers || config.timers || undefined;

  // agent tracking: agent.id IS the conversation id, so tasks bind back to
  // their original conversation even across restarts (会话绑定+补发).
  const tracking = deps.trackAgents ? deps.trackAgents(ctx) : installAgentTracking(ctx);

  const cache = {
    dataDir,
    now: () => clock.now(),
  };

  const deliverDue = deps.deliverDue ?? createFollowupDelivery({
    tracking,
    createUserMessage: deps.createUserMessage,
  });

  cache.scheduler = await createScheduler({
    dataDir,
    clock,
    timers,
    deliver: deliverDue,
  });
  cache.agentTracking = tracking;

  // cordis Context is a proxy: arbitrary properties must be registered as
  // services via ctx.provide() — a bare `ctx.scheduledSend = cache` throws
  // "cannot set property without provide" at plugin load time.
  if (typeof ctx.provide === 'function') ctx.provide('scheduledSend', cache);
  else ctx.scheduledSend = cache; // test/plain-object contexts

  if (ctx.webServer?.register) {
    cache.disposeRoutes = registerScheduledSendRoutes(ctx.webServer, cache);
  } else {
    ctx.logger?.warn?.('[dsh-scheduled-send] webServer 不可用，客户端路由未注册');
  }

  ctx.on?.('dispose', () => {
    cache.scheduler?.dispose?.();
    tracking.dispose?.();
    cache.disposeRoutes?.();
  });

  // cordis treats apply()'s return value as an effect disposer: a plain
  // object here throws "TypeError: Invalid effect" at boot. Cleanup is
  // registered via ctx.on('dispose'); the state is exposed as the
  // 'scheduledSend' service above. Return nothing.
}
