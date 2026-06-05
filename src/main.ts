import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import {
  getCurrentWindow,
  LogicalSize,
  PhysicalPosition,
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
const unlistens: UnlistenFn[] = [];

function render() {
  if (state.mode === "compact") renderCompact(app, state);
  else if (state.mode === "expanded") renderExpanded(app, state);
  else if (state.mode === "settings") {
    renderSettings(app, state, settingsHandlers());
  }
  applyWindowSize();
  applyPinned();
  saveWindowState();
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
    try {
      await invoke("save_api_key", { key });
      const b = (await invoke("get_current_balance")) as Balance | null;
      if (!b) {
        await new Promise((r) => setTimeout(r, 1500));
        const b2 = (await invoke("get_current_balance")) as Balance | null;
        if (!b2) {
          await invoke("delete_api_key");
          return { ok: false, error: "未拿到余额，请检查 key" };
        }
        return { ok: true, preview: b2.available };
      }
      return { ok: true, preview: b.available };
    } catch (e) {
      try { await invoke("delete_api_key"); } catch {}
      return { ok: false, error: String(e) };
    }
  },
  onSave: async (key) => {
    await invoke("save_api_key", { key });
    state = reduce(state, { type: "set_api_key_configured", configured: true });
    state = reduce(state, { type: "set_mode", mode: "compact" });
    historyLoaded = false;
    await loadHistory();
    render();
  },
  onToggleAutostart: async (enabled) => {
    await invoke("set_autostart", { enabled });
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
  onClose: () => {
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
  try {
    const ws = (await invoke("get_window_state")) as WindowState;
    state = reduce(state, { type: "set_mode", mode: ws.mode });
    state = reduce(state, { type: "set_pinned", pinned: ws.pinned });
    if (ws.position) {
      const sf = await win.scaleFactor();
      await win.setPosition(new PhysicalPosition(ws.position.x * sf, ws.position.y * sf));
    }
  } catch {}

  const status = (await invoke("get_api_key_status")) as { configured: boolean };
  state = reduce(state, { type: "set_api_key_configured", configured: status.configured });
  if (!status.configured) {
    state = reduce(state, { type: "set_mode", mode: "settings" });
    render();
    return;
  }

  await loadHistory();
  await invoke("trigger_refresh");
  render();

  unlistens.push(
    await listen<Balance>("balance:updated", (e) => {
      state = reduce(state, {
        type: "balance_loaded",
        balance: e.payload,
        snapshot: {
          ts_utc: Date.now(),
          balance: e.payload.available,
          currency: e.payload.currency,
          is_stale: false,
        },
      });
      render();
    }),
    await listen<BalanceError>("balance:error", (e) => {
      state = reduce(state, {
        type: "balance_error",
        kind: e.payload.kind,
        message: describeKind(e.payload.kind) + (e.payload.message ? `（${e.payload.message}）` : ""),
      });
      render();
    }),
    await listen<{ mode: string }>("mode:changed", (e) => {
      const m = e.payload.mode;
      if (m === "compact" || m === "expanded" || m === "settings") {
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

  let dragOffset: { x: number; y: number } | null = null;
  app.addEventListener("mousedown", (e) => {
    if (state.mode !== "compact") return;
    if (e.clientY > 6) return;
    dragOffset = { x: e.clientX, y: e.clientY };
  });
  window.addEventListener("mousemove", async (e) => {
    if (!dragOffset) return;
    const dx = e.clientX - dragOffset.x;
    const dy = e.clientY - dragOffset.y;
    dragOffset = { x: e.clientX, y: e.clientY };
    try {
      const pos = await win.outerPosition();
      const sf = await win.scaleFactor();
      await win.setPosition(new PhysicalPosition(pos.x + dx * sf, pos.y + dy * sf));
    } catch {}
  });
  window.addEventListener("mouseup", () => { dragOffset = null; });

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
    <hr/>
    <button data-act="quit">退出</button>
  `;
  document.body.appendChild(m);
  const close = () => m.remove();
  m.addEventListener("click", async (ev) => {
    const t = (ev.target as HTMLElement).dataset.act;
    if (t === "refresh") await invoke("trigger_refresh");
    else if (t === "toggle") {
      state = reduce(state, { type: "set_mode", mode: state.mode === "compact" ? "expanded" : "compact" });
    } else if (t === "settings") state = reduce(state, { type: "set_mode", mode: "settings" });
    else if (t === "quit") {
      // window.close() is intercepted by the Rust close handler (hide-only),
      // so this won't actually exit. The tray's "退出" menu item is the real exit path.
      window.close();
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
