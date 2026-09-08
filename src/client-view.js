// Browser view layer for dsh-scheduled-send.
// This file is CONCATENATED into lib/client.js by scripts/build-client.mjs
// together with src/client-core.js — it must stay import/export-free plain JS.
// Inside the bundle it references: React (platform module) and the client-core
// helpers (sortTasks/collapseState/formatLocalTime/formatCountdown/…).

/* ==== view ==== */
function createClientPluginBody(React) {
  const h = React.createElement;

  function pad2(n) { return String(n).padStart(2, "0"); }

  function toDatetimeLocalValue(ms) {
    const d = new Date(ms);
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate())
      + "T" + pad2(d.getHours()) + ":" + pad2(d.getMinutes());
  }

  /* --- ⏰ composer button (conversation.input.right) -------------------- */
  function ScheduleButton(props) {
    const core = props.core;
    const [open, setOpen] = React.useState(false);
    const [timeValue, setTimeValue] = React.useState("");
    const [modelKey, setModelKey] = React.useState("");
    const [busy, setBusy] = React.useState(false);
    const [error, setError] = React.useState(null);
    // standard session props: useInput(s => s.draft) reads the composer draft
    const draft = typeof props.useInput === "function"
      ? (props.useInput((s) => (s == null ? "" : s.draft)) ?? "")
      : "";

    const openPopover = () => {
      setTimeValue(toDatetimeLocalValue(typeof core.defaultSendAt === "function" ? core.defaultSendAt() : Date.now() + 5 * 60_000));
      setModelKey("");
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
        if (modelKey) {
          const i = modelKey.indexOf("::");
          payload.model = { provider: modelKey.slice(0, i), model: modelKey.slice(i + 2) };
        }
        await core.scheduleMessage(payload);
        // spec: 内容转为定时任务并清空输入框 — 绝不立即发送（不调 submit）
        if (props.inputActions && typeof props.inputActions.setDraft === "function") props.inputActions.setDraft("");
        setOpen(false);
      } catch (err) {
        setError(String(err?.message || err));
      } finally {
        setBusy(false);
      }
    };

    const btnStyle = {
      cursor: "pointer", flexShrink: 0, border: "none", background: "transparent",
      color: "inherit", fontSize: 14, lineHeight: "20px", padding: "0 4px",
      opacity: open ? 1 : 0.75,
    };
    const inputStyle = {
      border: "1px solid rgba(128,128,128,.4)", borderRadius: 8, padding: "3px 8px",
      fontSize: 12, background: "transparent", color: "inherit",
    };

    return h("div", { "data-plugin": "dsh-scheduled-send-button", style: { display: "inline-flex", alignItems: "center", gap: 6 } }, [
      h("button", {
        key: "alarm", type: "button", onClick: open ? () => setOpen(false) : openPopover,
        title: "定时发送", "aria-label": "定时发送", style: btnStyle,
      }, "⏰"),
      open
        ? h("div", { key: "pop", style: { display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", fontSize: 12 } }, [
            h("input", {
              key: "t", type: "datetime-local", value: timeValue,
              onChange: (e) => setTimeValue(e?.target?.value ?? e), style: inputStyle,
            }),
            h("select", {
              key: "m", value: modelKey,
              onChange: (e) => setModelKey(e?.target?.value ?? e), style: inputStyle,
              title: "到点切换模型（可选）",
            }, h("option", { key: "none", value: "" }, "不切换模型"),
              ...(props.modelList || []).map((m) =>
                h("option", { key: m.provider + "::" + m.model, value: m.provider + "::" + m.model },
                  (m.name || m.model) + "（" + m.provider + "）"))),
            h("button", {
              key: "ok", type: "button", disabled: busy, onClick: submit,
              style: { cursor: busy ? "wait" : "pointer", border: "none", borderRadius: 999, padding: "3px 12px", fontSize: 12, fontWeight: 600, color: "#fff", background: "#3b82f6", opacity: busy ? .6 : 1 },
            }, busy ? "提交中…" : "确认"),
            h("button", {
              key: "no", type: "button", onClick: () => setOpen(false),
              style: { cursor: "pointer", border: "1px solid rgba(128,128,128,.4)", borderRadius: 999, padding: "3px 12px", fontSize: 12, background: "transparent", color: "inherit" },
            }, "取消"),
            error ? h("span", { key: "e", style: { color: "#dc2626" } }, error) : null,
          ])
        : null,
    ]);
  }

  /* --- pending-task dock (conversation.input.dock) ---------------------- */
  function ScheduledDock(props) {
    const core = props.core;
    const [, setTick] = React.useState(0);
    const [expanded, setExpanded] = React.useState(false);
    React.useEffect(() => {
      let stopped = false;
      let timer = null;
      const loop = async () => {
        if (stopped) return;
        await core.refresh().catch(() => {});
        // cooperate in due-time model switches for THIS session (dir.select +
        // confirm), then re-check shortly after each poll
        await core.handleModelSwitches(props.sessionId);
        if (!stopped) { timer = setTimeout(loop, 3000); timer.unref?.(); }
      };
      void loop();
      const t = setInterval(() => setTick((n) => n + 1), 1000); // countdown ticker
      return () => {
        stopped = true;
        clearTimeout(timer);
        clearInterval(t);
      };
    }, []);

    const tasks = core.visibleTasks();
    const notes = core.lastDelivered();
    if (!tasks.length && !notes.length) return null;
    const st = collapseState(tasks);
    const showEntries = !st.collapsed || expanded;

    const rowStyle = {
      display: "flex", flexDirection: "column", gap: 2, width: "100%", maxWidth: "48rem",
      margin: "2px auto 0", fontSize: 12, lineHeight: "18px",
    };
    const entryStyle = {
      display: "flex", flexDirection: "column", gap: 2, padding: "4px 8px", borderRadius: 8,
      background: "rgba(59,130,246,.10)", border: "1px solid rgba(59,130,246,.22)",
    };
    const srcStyle = {
      margin: 0, whiteSpace: "pre-wrap", fontFamily: "monospace", fontSize: 12,
      wordBreak: "break-word",
    };
    const metaStyle = { display: "flex", alignItems: "center", gap: 8, color: "rgba(128,128,128,1)", flexWrap: "wrap" };
    const cancelBtn = (id) => h("button", {
      key: "x", type: "button", onClick: () => { core.cancelTask(id); },
      style: { cursor: "pointer", border: "1px solid rgba(128,128,128,.4)", borderRadius: 999, padding: "0 8px", fontSize: 11, background: "transparent", color: "inherit" },
    }, "取消");

    return h("div", { "data-plugin": "dsh-scheduled-send-dock", style: rowStyle }, [
      st.collapsed
        ? h("button", {
            key: "sum", type: "button", onClick: () => setExpanded(!expanded),
            style: { cursor: "pointer", alignSelf: "center", border: "1px solid rgba(59,130,246,.35)", borderRadius: 999, padding: "1px 10px", fontSize: 11, fontWeight: 600, background: "rgba(59,130,246,.10)", color: "inherit" },
          }, st.summary)
        : null,
      showEntries
        ? tasks.map((t) => h("div", { key: t.id, style: entryStyle }, [
            h("div", { key: "src", style: srcStyle }, t.content),
            h("div", { key: "meta", style: metaStyle }, [
              h("span", { key: "at" }, formatLocalTime(t.sendAt)),
              h("span", { key: "cd" }, formatCountdown(t.sendAt, Date.now())),
              t.model ? h("span", { key: "m" }, "模型 " + t.model.model) : null,
              h("span", { key: "sp", style: { marginLeft: "auto" } }, cancelBtn(t.id)),
            ]),
          ]))
        : null,
      notes.slice(0, 3).map((n) => h("div", {
        key: "note-" + n.id,
        style: { padding: "3px 8px", borderRadius: 8, background: "rgba(234,179,8,.14)", color: "inherit" },
      }, "⚠ 模型切换失败，已按当前模型发送：" + (n.modelError || "未知原因") + "（" + String(n.content ?? "").slice(0, 40) + "）")),
    ]);
  }

  /** Client plugin body. Returns the cordis plugin ({inject, apply}). */
  return function buildPlugin({ stateRoutePath, fetchImpl }) {
    const schedulePath = stateRoutePath.replace(/\/state$/, "/schedule");
    const modelSelectedPath = stateRoutePath.replace(/\/state$/, "/model-selected");
    const doFetch = fetchImpl || ((...a) => fetch(...a));

    let currentSessionId = null;
    let directoryFor = null; // set in apply() where modelDirectories lives

    const core = createScheduledClientState({
      fetchState: async () => {
        const res = await doFetch(stateRoutePath, { headers: { accept: "application/json" } });
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
      confirmModelSwitch: async (taskId) => {
        const res = await doFetch(modelSelectedPath, {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ taskId }),
        });
        return res.ok;
      },
      selectModel: async (model) => {
        if (!directoryFor || !currentSessionId) throw new Error("model directory not ready");
        await directoryFor(currentSessionId).select(model); // real client switch entry
      },
    });
    core.defaultSendAt = () => defaultSendAt();

    const inject = ["slots", "modelDirectories"];
    function apply(ctx) {
      ctx.inject(inject, (scope) => {
        directoryFor = (sid) => scope.modelDirectories.directoryFor(sid);
        const modelListFor = (sid) => {
          const snap = scope.modelDirectories.directoryFor(sid)?.store?.getSnapshot?.();
          const out = [];
          for (const g of snap?.groups || []) {
            for (const m of g.models || []) out.push({ provider: g.id, model: m.id, name: m.name || m.id });
          }
          return out;
        };
        scope.slots.inject("conversation.input.right", () => scope.slots.register({
          name: "conversation.input.right",
          id: "dsh-scheduled-send",
          order: 100,
          inject: (sessionId) => {
            currentSessionId = sessionId;
            return { sessionId, core, modelList: modelListFor(sessionId) };
          },
        }, ScheduleButton));
        scope.slots.inject("conversation.input.dock", () => scope.slots.register({
          name: "conversation.input.dock",
          id: "dsh-scheduled-send",
          order: 30,
          inject: (sessionId) => {
            currentSessionId = sessionId;
            return { sessionId, core };
          },
        }, ScheduledDock));
      });
    }
    return { core, inject, apply };
  };
}
