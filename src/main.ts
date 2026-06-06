import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import {
  getCurrentWindow,
  LogicalSize,
  PhysicalPosition,
  currentMonitor,
} from "@tauri-apps/api/window";
import "./styles.css";
import { renderCompact } from "./ui/compact";
import { renderExpanded } from "./ui/expanded";
import { renderSettings, type SettingsHandlers } from "./ui/settings";
import { describeKind } from "./ui/error";
import { initialState, reduce, type UiState } from "./state";
import type { Balance, BalanceError, Snapshot, WindowState } from "./types";

const win = getCurrentWindow();
const app = document.getElementById("app")!;

let state: UiState = initialState;
let historyLoaded = false;
let preSettingsPos: { x: number; y: number } | null = null;
const unlistens: UnlistenFn[] = [];

let saveWindowScheduled = false;
function scheduleWindowStateSave() {
  if (saveWindowScheduled) return;
  saveWindowScheduled = true;
  setTimeout(() => {
    saveWindowScheduled = false;
    saveWindowState();
  }, 500);
}

async function centerWindow() {
  try {
    const mon = await currentMonitor();
    if (!mon) return;
    const sf = mon.scaleFactor;
    const cx = Math.round((mon.position.x + mon.size.width / 2) / sf - 190);
    const cy = Math.round((mon.position.y + mon.size.height / 2) / sf - 220);
    await win.setPosition(new PhysicalPosition(cx, cy));
  } catch {}
}

let lastMode = state.mode;
function render() {
  // Center window when entering settings
  if (state.mode === "settings" && lastMode !== "settings") {
    (async () => {
      preSettingsPos = await win.outerPosition().then(p => ({ x: p.x, y: p.y })).catch(() => null);
      await centerWindow();
    })();
  }
  // Restore position when leaving settings
  if (lastMode === "settings" && state.mode !== "settings" && preSettingsPos) {
    (async () => {
      try { await win.setPosition(new PhysicalPosition(preSettingsPos.x, preSettingsPos.y)); } catch {}
      preSettingsPos = null;
    })();
  }
  lastMode = state.mode;

  if (state.mode === "compact") renderCompact(app, state);
  else if (state.mode === "expanded") renderExpanded(app, state);
  else if (state.mode === "settings") {
    renderSettings(app, state, settingsHandlers());
  }
  applyWindowSize();
  applyPinned();
  scheduleWindowStateSave();
}

function applyWindowSize() {
  if (state.mode === "compact") {
    void win.setSize(new LogicalSize(220, 60));
  } else {
    void win.setSize(new LogicalSize(360, 320));
  }
}

function applyPinned() {
  void win.setAlwaysOnTop(state.pinned);
}

async function saveWindowState() {
  try {
    const pos = await win.outerPosition();
    const factor = await win.scaleFactor();
    const x = Math.round(pos.x / factor);
    const y = Math.round(pos.y / factor);
    await invoke("save_window_state", {
      state: { position: { x, y }, mode: state.mode, pinned: state.pinned },
    });
  } catch {
    // ignore persistence errors
  }
}

const settingsHandlers = (): SettingsHandlers => ({
  onTest: async (key) => {
    if (!key.trim()) return { ok: false, error: "请先填写 API key" };
    try {
      const preview = await invoke<string>("test_api_key", { key });
      return { ok: true, preview };
    } catch (e) {
      const msg = String(e);
      if (msg.includes("401") || msg.includes("403") || msg.toLowerCase().includes("unauthorized")) {
        return { ok: false, error: "API key 无效或无权访问" };
      }
      if (msg.toLowerCase().includes("timeout") || msg.toLowerCase().includes("connect")) {
        return { ok: false, error: "网络不通，请检查连接" };
      }
      return { ok: false, error: msg };
    }
  },
  onSave: async (key) => {
    await invoke("save_api_key", { key });
    state = reduce(state, { type: "set_api_key_configured", configured: true });
    state = reduce(state, { type: "set_api_key", key });
    state = reduce(state, { type: "set_mode", mode: "compact" });
    state = reduce(state, { type: "refresh_started" });
    historyLoaded = false;
    render();
    await invoke("trigger_refresh", { key });
    await loadHistory();
  },
  onToggleAutostart: async (enabled) => {
    await invoke("set_autostart", { enabled });
    state = reduce(state, { type: "set_autostart", enabled });
  },
  onTogglePinned: async (enabled) => {
    state = reduce(state, { type: "set_pinned", pinned: enabled });
    render();
  },
  onReset: async () => {
    try { await invoke("delete_api_key"); } catch {}
    try {
      await invoke("reset_data");
    } catch {}
    location.reload();
  },
  onIntervalChange: async (secs: number) => {
    await invoke("set_refresh_interval", { secs });
    state = reduce(state, { type: "set_refresh_interval", secs });
  },
  onClose: async () => {
    if (preSettingsPos) {
      try { await win.setPosition(new PhysicalPosition(preSettingsPos.x, preSettingsPos.y)); } catch {}
      preSettingsPos = null;
    }
    state = reduce(state, { type: "set_mode", mode: "compact" });
    render();
  },
});

async function loadHistory() {
  if (historyLoaded) return;
  const h = (await invoke("get_history", { days: 30 })) as Snapshot[];
  state = reduce(state, { type: "load_history", history: h });
  historyLoaded = true;
}

async function init() {
  // 1. Register Tauri event listeners FIRST so events fired during the
  //    first-launch setup (e.g. balance:updated after the user saves a key)
  //    are not lost.
  unlistens.push(
    await listen<{ balance: Balance; ts_utc: number }>("balance:updated", (e) => {
      const { balance, ts_utc } = e.payload;
      state = reduce(state, {
        type: "balance_loaded",
        balance,
        snapshot: {
          ts_utc,
          balance: balance.available,
          currency: balance.currency,
          is_stale: false,
        },
      });
      render();
    }),
    await listen<BalanceError>("balance:error", (e) => {
      const raw = e.payload.message ?? "";
      const friendly = raw.includes("No matching entry found")
        ? "密钥未存储，请在设置中重新保存 API key"
        : raw;
      state = reduce(state, {
        type: "balance_error",
        kind: e.payload.kind,
        message: describeKind(e.payload.kind) + (friendly ? `（${friendly}）` : ""),
      });
      render();
    }),
    await listen<{ mode: string }>("mode:changed", async (e) => {
      const m = e.payload.mode;
      if (m === "compact" || m === "expanded" || m === "settings") {
        if (m === "settings") {
          if (state.apiKeyConfigured && !state.apiKey) {
            const key = await invoke<string | null>("get_api_key");
            if (key) state = reduce(state, { type: "set_api_key", key });
          }
          try {
            const a = await invoke<boolean>("get_autostart");
            state = reduce(state, { type: "set_autostart", enabled: a });
          } catch {}
        }
        state = reduce(state, { type: "set_mode", mode: m });
        render();
      }
    }),
    await listen<void>("balance:manual_refresh", async () => {
      state = reduce(state, { type: "refresh_started" });
      render();
      await invoke("trigger_refresh");
    }),
  );

  // 2. Register DOM input handlers (drag, dblclick, wheel, contextmenu).
  //    These must be in place for the compact bar to be draggable and
  //    double-clickable even on the first launch.
    // --- Drag (synchronous capture + offset tracking) ---
  let dragActive = false;
  let dragOffsetX = 0;   // cursor screenX - window origin (in dips)
  let dragOffsetY = 0;   // cursor screenY - window origin (in dips)
  let dragScale = 1;

  function moveWindow(sx: number, sy: number) {
    const px = Math.round((sx - dragOffsetX) * dragScale);
    const py = Math.round((sy - dragOffsetY) * dragScale);
    win.setPosition(new PhysicalPosition(px, py)).catch(() => {});
  }

  app.addEventListener("mousedown", (e) => {
    if (state.mode !== "compact") return;
    if (e.button !== 0) return;
    if (dragActive) return;

    // Capture synchronously — async event handlers recycle the event object
    const startScreenX = e.screenX;
    const startScreenY = e.screenY;

    (async () => {
      try {
        const [pos, sf] = await Promise.all([win.outerPosition(), win.scaleFactor()]);
        dragScale = sf;
        dragOffsetX = startScreenX - pos.x / sf;
        dragOffsetY = startScreenY - pos.y / sf;
        dragActive = true;
        moveWindow(startScreenX, startScreenY);
      } catch {}
    })();

    e.preventDefault();
  });

  window.addEventListener("mousemove", (e) => {
    if (!dragActive) return;
    moveWindow(e.screenX, e.screenY);
  });

  window.addEventListener("mouseup", () => {
    if (!dragActive) return;
    dragActive = false;
    setTimeout(() => saveWindowState(), 100);
  });


  app.addEventListener("dblclick", (e) => {
    if (state.mode !== "compact") return;
    if ((e.target as HTMLElement)?.tagName === "BUTTON") return;
    state = reduce(state, { type: "set_mode", mode: "expanded" });
    render();
  });

  app.addEventListener("wheel", (e) => {
    e.preventDefault();
    if (state.mode === "compact") state = reduce(state, { type: "set_mode", mode: "expanded" });
    else if (state.mode === "expanded") state = reduce(state, { type: "set_mode", mode: "compact" });
    render();
  }, { passive: false });

  app.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    showContextMenu(e.clientX, e.clientY);
  });

  // 3. Restore window state.
  try {
    const ws = (await invoke("get_window_state")) as WindowState;
    state = reduce(state, { type: "set_mode", mode: ws.mode });
    state = reduce(state, { type: "set_pinned", pinned: ws.pinned });
    if (ws.position) {
      const sf = await win.scaleFactor();
      await win.setPosition(new PhysicalPosition(ws.position.x * sf, ws.position.y * sf));
    }
  } catch {}

  // 4. Decide initial mode based on whether a key is configured.
  const status = (await invoke("get_api_key_status")) as { configured: boolean };
  state = reduce(state, { type: "set_api_key_configured", configured: status.configured });
  if (status.configured) {
    const key = await invoke<string | null>("get_api_key");
    if (key) state = reduce(state, { type: "set_api_key", key });
  }
  if (!status.configured) {
    state = reduce(state, { type: "set_mode", mode: "settings" });
    render();
    return;
  }

  // 5. Has key: load history, trigger first refresh.
  await loadHistory();
  await invoke("trigger_refresh");
  render();
}

function showContextMenu(x: number, y: number) {
  const m = document.createElement("div");
  m.className = "ctx-menu";
  m.style.left = `${x}px`;
  m.style.top = `${y}px`;
  m.innerHTML = `
    <button data-act="refresh">立即刷新</button>
    <button data-act="toggle">${state.mode === "compact" ? "展开" : "收起"}</button>
    <hr/>
    <button data-act="settings">设置…</button>

  `;
  document.body.appendChild(m);
  const close = () => m.remove();
  m.addEventListener("click", async (ev) => {
    const t = (ev.target as HTMLElement).dataset.act;
    if (t === "refresh") await invoke("trigger_refresh");
    else if (t === "toggle") {
      state = reduce(state, { type: "set_mode", mode: state.mode === "compact" ? "expanded" : "compact" });
    }     else if (t === "settings") {
      try {
        const a = await invoke<boolean>("get_autostart");
        state = reduce(state, { type: "set_autostart", enabled: a });
        const interval = await invoke<number>("get_refresh_interval");
        state = reduce(state, { type: "set_refresh_interval", secs: interval });
      } catch {}
      if (state.apiKeyConfigured && !state.apiKey) {
        const key = await invoke<string | null>("get_api_key");
        if (key) state = reduce(state, { type: "set_api_key", key });
      }
      const interval = await invoke<number>("get_refresh_interval");
      state = reduce(state, { type: "set_refresh_interval", secs: interval });
      state = reduce(state, { type: "set_mode", mode: "settings" });
    }
    close();
    render();
  });
  setTimeout(() => document.addEventListener("click", close, { once: true }), 0);
}

window.addEventListener("beforeunload", () => {
  for (const u of unlistens) u();
});

init().catch((e) => {
  app.textContent = `init failed: ${String(e)}`;
});
