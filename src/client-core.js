// Client-layer core for dsh-scheduled-send (browser side, framework-free and
// testable in Node). The lib/client.js bundle wraps this with React/slots.

export const COLLAPSE_THRESHOLD = 3;

/** Sort a task list by sendAt ascending (display order). */
export function sortTasks(tasks) {
  return [...(tasks || [])].sort((a, b) => (a.sendAt || 0) - (b.sendAt || 0));
}

/**
 * Collapse rule for the dock: more than COLLAPSE_THRESHOLD entries render as
 * a single "N 条定时任务 ⌄" summary row the user can expand.
 */
export function collapseState(tasks) {
  const list = tasks || [];
  if (list.length <= COLLAPSE_THRESHOLD) {
    return { collapsed: false, visibleCount: list.length, summary: null };
  }
  return { collapsed: true, visibleCount: list.length, summary: `${list.length} 条定时任务 ⌄` };
}

/** Local-timezone "YYYY-MM-DD HH:mm" for a planned send time. */
export function formatLocalTime(ms) {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return '';
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Countdown until sendAt ("N分N秒后" / "N小时N分后" / "即将发送"). */
export function formatCountdown(sendAt, now) {
  const ms = sendAt - now;
  if (ms <= 0) return '即将发送';
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}小时${m}分后`;
  if (m > 0) return `${m}分${s}秒后`;
  return `${s}秒后`;
}

/** Default confirmation time = now + 5 minutes. */
export function defaultSendAt(now = Date.now(), offsetMs = 5 * 60_000) {
  return now + offsetMs;
}

/**
 * Stateful client controller: polls the host state route, holds the visible
 * task list (optimistically extended right after POST so new entries show
 * WITHOUT a refresh), cooperates in due-time model switches (dir.select then
 * confirm), and exposes cancel.
 * @param {object} deps
 * @param {() => Promise<object>} deps.fetchState GET the host state route
 * @param {(payload:object)=>Promise<{task:object}>} deps.postSchedule
 * @param {(id:string)=>Promise<boolean>} deps.cancelSchedule
 * @param {(taskId:string)=>Promise<boolean>} [deps.confirmModelSwitch]
 * @param {(model:{provider:string,model:string})=>Promise<void>} [deps.selectModel]
 * @param {() => number} [deps.now]
 */
export function createScheduledClientState({ fetchState, postSchedule, cancelSchedule, confirmModelSwitch, selectModel, now = () => Date.now() } = {}) {
  let tasks = [];
  let modelSwitchPending = [];
  let delivered = [];
  let timer = null;
  let stopped = false;
  const handledSwitches = new Set();

  return {
    /** Pending tasks sorted ascending by sendAt. */
    visibleTasks() {
      return sortTasks(tasks);
    },
    /** Model-fallback notes for entries already delivered. */
    lastDelivered() {
      return delivered;
    },
    /** Switches the client still owes (own-session filtering at call time). */
    pendingSwitches() {
      return modelSwitchPending;
    },
    snapshot() {
      return { tasks: sortTasks(tasks), modelSwitchPending, recentDelivered: delivered, fetchedAt: now() };
    },

    async refresh() {
      const s = await fetchState();
      tasks = s?.tasks ?? [];
      modelSwitchPending = s?.modelSwitchPending ?? [];
      delivered = s?.recentDelivered ?? [];
      return this.snapshot();
    },

    /**
     * User-facing schedule entry: POST to the host route and locally enqueue
     * the returned task so it is visible IMMEDIATELY (无需刷新立即显示).
     */
    async scheduleMessage(payload) {
      if (!postSchedule) throw new Error('postSchedule 未配置');
      const result = await postSchedule(payload);
      const task = result?.task ?? result;
      if (task?.id && !tasks.some((t) => t.id === task.id)) tasks = [...tasks, task];
      return task;
    },

    /** Cancel a pending task: DELETE on the host + drop locally. */
    async cancelTask(id) {
      if (cancelSchedule) await cancelSchedule(id);
      tasks = tasks.filter((t) => t.id !== id);
    },

    /**
     * Due-time model switch cooperation: for each pending switch bound to
     * THIS session, dir.select the model then POST the confirmation. Each
     * taskId is handled at most once per client lifetime.
     */
    async handleModelSwitches(sessionId) {
      if (typeof selectModel !== 'function' || typeof confirmModelSwitch !== 'function') return;
      for (const entry of modelSwitchPending || []) {
        if (!entry?.taskId || handledSwitches.has(entry.taskId)) continue;
        if (entry.conversationId && sessionId && entry.conversationId !== sessionId) continue;
        handledSwitches.add(entry.taskId); // mark first: never double-select
        try {
          await selectModel(entry.model);
          await confirmModelSwitch(entry.taskId);
        } catch {
          // switch failed: leave the entry; host times out and degrades to
          // the current model with a surfaced note.
        }
      }
    },

    start(intervalMs = 4_000) {
      if (timer) return;
      stopped = false;
      const loop = async () => {
        if (stopped) return;
        await this.refresh().catch(() => {});
        timer = setTimeout(loop, intervalMs);
        timer.unref?.();
      };
      void loop();
    },

    stop() {
      stopped = true;
      clearTimeout(timer);
      timer = null;
    },
  };
}
