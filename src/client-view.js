// Browser view layer for dsh-scheduled-send.
// This file is CONCATENATED into lib/client.js by scripts/build-client.mjs
// together with src/client-core.js — it must stay import/export-free plain JS.
// Inside the bundle it references: React (platform module) and the client-core
// helpers (sortTasks/collapseState/formatLocalTime/formatCountdown/…).

/* ==== view ==== */
function createClientPluginBody(React) {
  const h = React.createElement;
  const TOUCH_MIN = 40; // FIX 5: touch target height on mobile

  function pad2(n) { return String(n).padStart(2, "0"); }

  function toDatetimeLocalValue(ms) {
    const d = new Date(ms);
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate())
      + "T" + pad2(d.getHours()) + ":" + pad2(d.getMinutes());
  }

  function isMobile() {
    return isMobileViewport(typeof window !== "undefined" ? window.matchMedia : null);
  }

  /* --- ⏰ composer button (conversation.input.right) -------------------- */
  function ScheduleButton(props) {
    const core = props.core;
    const [open, setOpen] = React.useState(false);
    const [timeValue, setTimeValue] = React.useState("");
    const [busy, setBusy] = React.useState(false);
    const [error, setError] = React.useState(null);
    // standard session props: useInput(s => s.draft) reads the composer draft
    const draft = typeof props.useInput === "function"
      ? (props.useInput((s) => (s == null ? "" : s.draft)) ?? "")
      : "";
    const mobile = isMobile();

    const openPopover = () => {
      setTimeValue(toDatetimeLocalValue(typeof core.defaultSendAt === "function" ? core.defaultSendAt() : Date.now() + 5 * 60_000));
      setError(null);
      setOpen(true);
    };

    const submit = async () => {
      if (busy) return;
      const content = String(draft ?? "");
      if (!content.trim()) { setError("输入框内容为空，请先输入要定时发送的内容"); return; }
      const at = timeValue ? new Date(timeValue).getTime() : NaN;
      if (!Number.isFinite(at) || at <= Date.now()) { setError("发送时间必须是未来时间"); return; }
      setBusy(true);
      setError(null);
      try {
        const payload = { content, sendAt: at, conversationId: props.sessionId };
        await core.scheduleMessage(payload);
        // sidebar panel has its own state: refresh it NOW (its 8s poll would
        // otherwise lag ~10s behind a fresh task)
        if (props.onTaskCreated) void props.onTaskCreated();
        // spec: 内容转为定时任务并清空输入框 — 绝不立即发送（不调 submit）
        if (props.inputActions && typeof props.inputActions.setDraft === "function") props.inputActions.setDraft("");
        setOpen(false);
      } catch (err) {
        // FIX 4 failure mode: nothing was enqueued — keep the popover open
        // with the form (time + draft) intact and surface the error.
        setError(String(err?.message || err));
      } finally {
        setBusy(false);
      }
    };

    const btnStyle = {
      cursor: "pointer", flexShrink: 0, border: "1px solid " + (open ? "#3b82f6" : "transparent"),
      background: open ? "rgba(59,130,246,.12)" : "transparent",
      color: open ? "#3b82f6" : "inherit",
      borderRadius: 999, fontSize: 12, fontWeight: 600, lineHeight: "18px", padding: "1px 8px",
      display: "inline-flex", alignItems: "center", gap: 3,
      opacity: open ? 1 : 0.8,
      ...(mobile ? { minHeight: TOUCH_MIN } : {}),
    };
    const isDark = typeof window !== "undefined" && window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
    // FIX 5: on ≤480px the popover spans (nearly) the full viewport width.
    const popCard = {
      position: "absolute", bottom: "100%", right: 0, marginBottom: 6, zIndex: 30,
      minWidth: 280, padding: "10px 12px", fontSize: 12,
      borderRadius: 12, border: "1px solid " + (isDark ? "rgba(255,255,255,.14)" : "rgba(0,0,0,.10)"),
      background: isDark ? "#1c1c1e" : "#fff",
      boxShadow: "0 8px 24px rgba(0,0,0,.18)",
      color: isDark ? "#eee" : "#111",
      ...(mobile ? { left: 0, right: 0, minWidth: 0, width: "calc(100vw - 16px)", maxWidth: "calc(100vw - 16px)", boxSizing: "border-box" } : {}),
    };
    const fieldLbl = { display: "block", fontSize: 11, opacity: .65, margin: "6px 0 3px" };
    const fieldIn = {
      width: "100%", boxSizing: "border-box",
      border: "1px solid " + (isDark ? "rgba(255,255,255,.2)" : "rgba(0,0,0,.18)"),
      borderRadius: 8, padding: "5px 8px", fontSize: 12,
      background: isDark ? "rgba(255,255,255,.05)" : "#fff", color: "inherit",
      ...(mobile ? { minHeight: TOUCH_MIN } : {}),
    };
    const actionBtn = (extra) => ({
      cursor: "pointer", borderRadius: 999, padding: "5px 16px", fontSize: 12, ...(extra || {}),
      ...(mobile ? { minHeight: TOUCH_MIN, boxSizing: "border-box" } : {}),
    });

    return h("div", { "data-plugin": "dsh-scheduled-send-button", style: { position: "relative", display: "inline-flex", alignItems: "center", gap: 6 } }, [
      open
        ? h("span", { key: "badge", style: { flexShrink: 0 } },
            h("span", { style: {
              display: "inline-flex", alignItems: "center", borderRadius: 999,
              padding: "1px 8px", fontSize: 11, fontWeight: 700,
              background: "rgba(59,130,246,.16)", color: "#3b82f6",
            } }, "⏳ 定时发送中"))
        : null,
      h("button", {
        key: "alarm", type: "button", onClick: open ? () => setOpen(false) : openPopover,
        title: "定时发送", "aria-label": "定时发送", style: btnStyle,
      }, "⏰ 定时"),
      open
        ? h("div", { key: "pop", style: popCard }, [
            h("div", { key: "title", style: { fontWeight: 700, fontSize: 13 } }, "定时发送"),
            h("label", { key: "lt", style: fieldLbl }, "发送时间（默认当前 +5 分钟）"),
            h("input", {
              key: "t", type: "datetime-local", value: timeValue,
              onChange: (e) => setTimeValue(e?.target?.value ?? e), style: fieldIn,
            }),
            h("div", { key: "act", style: { display: "flex", gap: 8, marginTop: 10, alignItems: "center", flexWrap: "wrap" } }, [
              h("button", {
                key: "ok", type: "button", disabled: busy, onClick: submit,
                style: actionBtn({ border: "none", fontWeight: 600, color: "#fff", background: "#3b82f6", opacity: busy ? .6 : 1, cursor: busy ? "wait" : "pointer" }),
              }, busy ? "提交中…" : "确认"),
              h("button", {
                key: "no", type: "button", onClick: () => setOpen(false),
                style: actionBtn({ border: "1px solid " + (isDark ? "rgba(255,255,255,.2)" : "rgba(0,0,0,.18)"), background: "transparent", color: "inherit", cursor: "pointer" }),
              }, "取消"),
              error ? h("span", { key: "e", style: { color: "#dc2626", wordBreak: "break-word" } }, error) : null,
            ]),
          ])
        : null,
    ]);
  }

  /* --- pending-task dock (conversation.input.dock) ---------------------- */
  function ScheduledDock(props) {
    const core = props.core;
    const [, setTick] = React.useState(0);
    // FIX 2: tri-state user override — null = default policy, 'expanded',
    // 'collapsed' (manual collapse-all works for ANY count).
    const [user, setUser] = React.useState(null);
    const mobile = isMobile();

    // FIX 1: react to sessionId changes — bind the core to the NEW session
    // and refresh IMMEDIATELY (no waiting for the next poll tick).
    React.useEffect(() => {
      let stopped = false;
      let timer = null;
      core.setSession(props.sessionId);
      const loop = async () => {
        if (stopped) return;
        await core.refresh().catch(() => {});
        if (!stopped) setTick((n) => n + 1);
        if (!stopped) { timer = setTimeout(loop, 3000); timer.unref?.(); }
      };
      void loop();
      return () => {
        stopped = true;
        clearTimeout(timer);
      };
    }, [props.sessionId]);
    // countdown ticker
    React.useEffect(() => {
      const t = setInterval(() => setTick((n) => n + 1), 1000);
      t.unref?.(); // never hold the host loop for a UI countdown
      return () => clearInterval(t);
    }, []);

    const tasks = core.visibleTasks();
    const err = core.lastError();
    const st = collapseState(tasks, { user, mobile });
    const visible = tasks.slice(0, st.visibleCount);
    const showToggle = tasks.length > 0;
    if (!tasks.length && !err) return null;

    const rowStyle = {
      display: "flex", flexDirection: "column", gap: 2, width: "100%", maxWidth: "48rem",
      margin: "2px auto 0", fontSize: 12, lineHeight: "18px",
      boxSizing: "border-box",
    };
    const entryStyle = {
      display: "flex", flexDirection: "column", gap: 2, padding: "4px 8px", borderRadius: 8,
      background: "rgba(59,130,246,.10)", border: "1px solid rgba(59,130,246,.22)",
      maxWidth: "100%", width: "100%", boxSizing: "border-box", overflowWrap: "break-word",
    };
    const srcStyle = {
      margin: 0, whiteSpace: "pre-wrap", fontFamily: "monospace", fontSize: 12,
      wordBreak: "break-word", maxWidth: "100%",
    };
    const metaStyle = { display: "flex", alignItems: "center", gap: 8, color: "rgba(128,128,128,1)", flexWrap: "wrap", maxWidth: "100%" };
    const cancelBtn = (id) => h("button", {
      key: "x", type: "button", onClick: () => { core.cancelTask(id); },
      style: {
        cursor: "pointer", border: "1px solid rgba(128,128,128,.4)", borderRadius: 999, padding: "0 8px",
        fontSize: 11, background: "transparent", color: "inherit", flexShrink: 0,
        ...(mobile ? { minHeight: TOUCH_MIN } : {}),
      },
    }, "取消");

    return h("div", { "data-plugin": "dsh-scheduled-send-dock", style: rowStyle }, [
      err
        ? h("div", {
            key: "err",
            style: { padding: "3px 8px", borderRadius: 8, background: "rgba(220,38,38,.10)", color: "#dc2626", wordBreak: "break-word" },
          }, "⚠ 加载失败，显示上一次列表：" + err)
        : null,
      showToggle && st.summary
        ? h("button", {
            key: "sum", type: "button",
            onClick: () => { setUser(st.display === "expanded" ? "collapsed" : "expanded"); setTick((n) => n + 1); },
            style: {
              cursor: "pointer", alignSelf: "center", border: "1px solid rgba(59,130,246,.35)", borderRadius: 999,
              padding: "1px 10px", fontSize: 11, fontWeight: 600, background: "rgba(59,130,246,.10)", color: "inherit",
              ...(mobile ? { minHeight: TOUCH_MIN, boxSizing: "border-box" } : {}),
            },
          }, st.summary)
        : null,
      visible.map((t) => h("div", { key: t.id, style: entryStyle }, [
          h("div", { key: "src", style: srcStyle }, t.content),
          h("div", { key: "meta", style: metaStyle }, [
            h("span", { key: "at" }, formatLocalTime(t.sendAt)),
            h("span", { key: "cd" }, formatCountdown(t.sendAt, Date.now())),
            h("span", { key: "sp", style: { marginLeft: "auto" } }, cancelBtn(t.id)),
          ]),
        ])),
    ]);
  }

  /* --- sidebar footer「定时任务」panel (0.3.0) ---------------------------- */
  function ScheduledTasksPanel(props) {
    const core = props.panelCore;
    const [open, setOpen] = React.useState(false);
    const [tick, setTick] = React.useState(0);
    const [hover, setHover] = React.useState(false);
    const mobile = isMobile();

    // keep the badge alive even while the panel is closed: poll the FULL
    // (unfiltered) state — every conversation's pending tasks, 8s cadence.
    React.useEffect(() => {
      let stopped = false;
      let timer = null;
      const loop = async () => {
        if (stopped) return;
        await core.refresh().catch(() => {});
        if (!stopped) setTick((n) => n + 1);
        if (!stopped) { timer = setTimeout(loop, 8000); timer.unref?.(); }
      };
      void loop();
      return () => { stopped = true; clearTimeout(timer); };
    }, []);

    const all = core.visibleTasks(); // ALL sessions, sendAt ascending
    const err = core.lastError();
    const MAX_ROWS = 100;
    const annotated = annotateSessions(all.slice(0, MAX_ROWS), props.sessionById ? props.sessionById() : null);
    const overflow = Math.max(0, all.length - annotated.length);

    const isDark = typeof window !== "undefined" && window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
    const entryBtn = {
      cursor: "pointer", display: "flex", alignItems: "center", gap: 8,
      width: "100%", boxSizing: "border-box", textAlign: "left",
      border: "none", background: hover ? "rgba(128,128,128,.16)" : "transparent", color: "inherit",
      fontSize: 12, fontWeight: 600, padding: "6px 10px", borderRadius: 8, whiteSpace: "nowrap",
      ...(mobile ? { minHeight: TOUCH_MIN } : {}),
    };
    const iconBox = { display: "inline-flex", width: 16, justifyContent: "center", flexShrink: 0 };
    const badge = (n) => h("span", {
      key: "b", "data-badge": n,
      style: {
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        minWidth: 16, height: 16, padding: "0 4px", borderRadius: 999,
        background: "#3b82f6", color: "#fff", fontSize: 10, fontWeight: 700,
      },
    }, String(n));

    const jump = (t) => {
      // failure mode: jump unavailable/unknown session → keep the panel open,
      // keep the row (still cancellable); never throw into the click handler.
      const ok = props.openSession ? props.openSession(t.conversationId) : false;
      if (ok) setOpen(false);
    };
    const cancelBtn = (t) => h("button", {
      key: "x", type: "button",
      onClick: (e) => {
        if (e && typeof e.stopPropagation === "function") e.stopPropagation();
        core.cancelTask(t.id).catch(() => {});
        setTick((n) => n + 1);
      },
      style: {
        cursor: "pointer", border: "1px solid rgba(128,128,128,.4)", borderRadius: 999,
        padding: "0 8px", fontSize: 11, background: "transparent", color: "inherit", flexShrink: 0,
        ...(mobile ? { minHeight: TOUCH_MIN, boxSizing: "border-box" } : {}),
      },
    }, "取消");

    const footer = open
      ? h("div", {
          key: "panel", "data-plugin": "dsh-scheduled-send-sidebar-panel",
          style: {
            position: "fixed", bottom: 56, left: 12, zIndex: 50,
            width: 340, maxWidth: "calc(100vw - 24px)", maxHeight: "70vh", overflowY: "auto",
            boxSizing: "border-box", padding: "10px 12px", fontSize: 12,
            borderRadius: 12, border: "1px solid " + (isDark ? "rgba(255,255,255,.14)" : "rgba(0,0,0,.10)"),
            background: isDark ? "#1c1c1e" : "#fff",
            boxShadow: "0 8px 24px rgba(0,0,0,.18)",
            color: isDark ? "#eee" : "#111",
            ...(mobile ? { left: 8, width: "calc(100vw - 16px)", maxWidth: "calc(100vw - 16px)" } : {}),
          },
        }, [
          h("div", {
            key: "head", style: { display: "flex", alignItems: "center", gap: 8, marginBottom: 6 },
          }, [
            h("span", { key: "t", style: { fontWeight: 700, fontSize: 13 } }, "⏰ 定时任务"),
            h("span", { key: "n", style: { opacity: .6 } }, all.length ? `${all.length} 条待发送` : ""),
            h("button", {
              key: "close", type: "button", onClick: () => setOpen(false),
              style: { cursor: "pointer", marginLeft: "auto", border: "none", background: "transparent", color: "inherit", fontSize: 14, lineHeight: 1 },
            }, "✕"),
          ]),
          err
            ? h("div", {
                key: "err",
                style: { padding: "3px 8px", borderRadius: 8, background: "rgba(220,38,38,.10)", color: "#dc2626", wordBreak: "break-word" },
              }, "⚠ 加载失败，显示上一次列表：" + err)
            : null,
          !all.length && !err
            ? h("div", { key: "empty", style: { padding: "18px 0", textAlign: "center", opacity: .6 } }, [
                h("div", { key: "l1" }, "暂无定时任务"),
                h("div", { key: "l2", style: { marginTop: 4 } }, "在会话输入框点击 ⏰ 定时 即可创建"),
              ])
            : null,
          annotated.map((t) => h("div", {
            key: t.id, "data-task": t.id,
            onClick: () => { if (t.sessionExists) jump(t); },
            title: t.sessionExists ? "打开对应会话" : "会话不存在，仅可取消",
            style: {
              display: "flex", flexDirection: "column", gap: 2, padding: "6px 8px", marginBottom: 4,
              borderRadius: 8, background: "rgba(59,130,246,.10)", border: "1px solid rgba(59,130,246,.22)",
              cursor: t.sessionExists ? "pointer" : "default",
              opacity: t.sessionExists ? 1 : 0.5,
              wordBreak: "break-word", maxWidth: "100%", boxSizing: "border-box",
            },
          }, [
            h("div", { key: "c", style: { whiteSpace: "pre-wrap", fontFamily: "monospace" } },
              summarizeContent(t.content) || "(空内容)"),
            h("div", { key: "m", style: { display: "flex", alignItems: "center", gap: 8, color: "rgba(128,128,128,1)", flexWrap: "wrap" } }, [
              h("span", { key: "s", style: { maxWidth: "60%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } },
                t.sessionExists ? t.sessionTitle : "会话不存在"),
              h("span", { key: "at" }, formatLocalTime(t.sendAt)),
              h("span", { key: "cd" }, formatCountdown(t.sendAt, Date.now())),
              h("span", { key: "sp", style: { marginLeft: "auto" } }, cancelBtn(t)),
            ]),
          ])),
          overflow > 0
            ? h("div", { key: "more", style: { textAlign: "center", opacity: .6, padding: "4px 0" } },
                `仅显示最近 ${annotated.length} 条（共 ${all.length} 条）`)
            : null,
        ])
      : null;

    return h("div", { "data-plugin": "dsh-scheduled-send-sidebar", style: { width: "100%" } }, [
      null,
      h("button", {
        key: "btn", type: "button",
        onMouseEnter: () => setHover(true),
        onMouseLeave: () => setHover(false),
        onClick: () => { setOpen(!open); setTick((n) => n + 1); },
        title: "定时任务", "aria-label": "定时任务", style: entryBtn,
      }, [
        h("span", { key: "i", style: iconBox }, "⏰"),
        h("span", { key: "l" }, "定时任务"),
        all.length ? h("span", { key: "bs", style: { marginLeft: "auto", display: "inline-flex" } }, badge(all.length)) : null,
      ]),
      footer,
    ]);
  }

  /** Client plugin body. Returns the cordis plugin ({inject, apply}). */
  return function buildPlugin({ stateRoutePath, fetchImpl }) {
    const schedulePath = stateRoutePath.replace(/\/state$/, "/schedule");
    const doFetch = fetchImpl || ((...a) => fetch(...a));

    let currentSessionId = null;

    const doCancel = async (id) => {
      const res = await doFetch(schedulePath + "?id=" + encodeURIComponent(id), { method: "DELETE" });
      return res.ok;
    };

    // 0.3.0 panel core: UNBOUND (session null) — fetches the FULL task list
    // (no conversationId filter) for the sidebar badge + panel; cancel reuses
    // the same DELETE route (cross-conversation).
    const panelCore = createScheduledClientState({
      fetchState: async () => {
        const res = await doFetch(stateRoutePath, { headers: { accept: "application/json" } });
        if (!res.ok) throw new Error("state HTTP " + res.status);
        return res.json();
      },
      cancelSchedule: doCancel,
    });
    panelCore.setSession(null);

    const core = createScheduledClientState({
      fetchState: async () => {
        // ask the host for THIS conversation's view (the core's bound session
        // is authoritative — the view binds it before every refresh); the
        // core still filters strictly client-side against stale caches.
        const sid = core.currentSession();
        const q = sid ? "?conversationId=" + encodeURIComponent(sid) : "";
        const res = await doFetch(stateRoutePath + q, { headers: { accept: "application/json" } });
        if (!res.ok) throw new Error("state HTTP " + res.status);
        return res.json();
      },
      postSchedule: async (payload) => {
        const res = await doFetch(schedulePath, {
          method: "POST", headers: { "content-type": "application/json", accept: "application/json" },
          body: JSON.stringify(payload),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error || ("HTTP " + res.status));
        return body;
      },
      cancelSchedule: async (id) => {
        const res = await doFetch(schedulePath + "?id=" + encodeURIComponent(id), { method: "DELETE" });
        return res.ok;
      },
    });
    core.defaultSendAt = () => defaultSendAt();

    const inject = ["slots", "sessions"]; // sessions: sidebar panel jump (0.3.0)
    function apply(ctx) {
      // due-time delivery: refresh the sidebar panel the moment a task fires
      ctx.on?.('guard/scheduled-due', () => { void panelCore.refresh(); });
      ctx.on?.('guard/scheduled-dropped', () => { void panelCore.refresh(); });
      ctx.inject(inject, (scope) => {
        // 0.3.0 session navigation, sourced from the sessions service:
        //  - open(id) selects a session as current (unknown ids throw → false)
        //  - list.getSnapshot().byId maps id → {displayTitle} for row labels
        const svc = scope.sessions;
        const openSession = (sid) => {
          try {
            if (svc && typeof svc.open === "function" && sid) { svc.open(sid); return true; }
          } catch (err) { /* unknown session — degrade, row stays cancellable */ }
          return false;
        };
        const sessionById = () => {
          try { return (svc && svc.list && svc.list.getSnapshot && svc.list.getSnapshot().byId) || {}; }
          catch (err) { return {}; }
        };
        scope.slots.inject("sidebar.footer.action", () => scope.slots.register({
          name: "sidebar.footer.action",
          id: "@ottttto/dsh-scheduled-send",
          order: 20,
        }, (slotProps) => ScheduledTasksPanel({ ...(slotProps || {}), panelCore, openSession, sessionById })));
        scope.slots.inject("conversation.input.right", () => scope.slots.register({
          name: "conversation.input.right",
          id: "@ottttto/dsh-scheduled-send",
          order: 100,
          inject: (sessionId) => {
            currentSessionId = sessionId;
            core.setSession(sessionId); // dock/button are conversation-scoped
            return { sessionId, core, onTaskCreated: () => panelCore.refresh() };
          },
        }, ScheduleButton));
        scope.slots.inject("conversation.input.dock", () => scope.slots.register({
          name: "conversation.input.dock",
          id: "@ottttto/dsh-scheduled-send",
          order: 30,
          inject: (sessionId) => {
            currentSessionId = sessionId;
            core.setSession(sessionId);
            return { sessionId, core, onTaskCreated: () => panelCore.refresh() };
          },
        }, ScheduledDock));
      });
    }
    return { core, inject, apply };
  };
}
