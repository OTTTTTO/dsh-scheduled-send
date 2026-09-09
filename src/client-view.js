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

  /** Client plugin body. Returns the cordis plugin ({inject, apply}). */
  return function buildPlugin({ stateRoutePath, fetchImpl }) {
    const schedulePath = stateRoutePath.replace(/\/state$/, "/schedule");
    const doFetch = fetchImpl || ((...a) => fetch(...a));

    let currentSessionId = null;

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

    const inject = ["slots"];
    function apply(ctx) {
      ctx.inject(inject, (scope) => {
        scope.slots.inject("conversation.input.right", () => scope.slots.register({
          name: "conversation.input.right",
          id: "@ottttto/dsh-scheduled-send",
          order: 100,
          inject: (sessionId) => {
            currentSessionId = sessionId;
            core.setSession(sessionId); // dock/button are conversation-scoped
            return { sessionId, core };
          },
        }, ScheduleButton));
        scope.slots.inject("conversation.input.dock", () => scope.slots.register({
          name: "conversation.input.dock",
          id: "@ottttto/dsh-scheduled-send",
          order: 30,
          inject: (sessionId) => {
            currentSessionId = sessionId;
            core.setSession(sessionId);
            return { sessionId, core };
          },
        }, ScheduledDock));
      });
    }
    return { core, inject, apply };
  };
}
