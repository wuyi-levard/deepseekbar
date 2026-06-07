import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import {
  getCurrentWindow,
  LogicalSize,
  PhysicalPosition,
  currentMonitor,
} from "@tauri-apps/api/window";
import { register } from "@tauri-apps/plugin-global-shortcut";
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

function applyTheme(theme: string) {
  document.documentElement.setAttribute("data-theme", theme);
}

async function centerWindow() {
  try {
    const mon = await currentMonitor();
    if (!mon) return;
    const sf = mon.scaleFactor;
    const cx = Math.round((mon.position.x + mon.size.width / 2) / sf - 200);
    const cy = Math.round((mon.position.y + mon.size.height / 2) / sf - 280);
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
    win.setSize(new LogicalSize(180, 60)).catch((e: unknown) => console.warn("setSize compact:", e));
  } else if (state.mode === "settings") {
    win.setSize(new LogicalSize(420, 620)).catch((e: unknown) => console.warn("setSize settings:", e));
  } else {
    win.setSize(new LogicalSize(380, 560)).catch((e: unknown) => console.warn("setSize expanded:", e));
  }
}

function applyPinned() {
  win.setAlwaysOnTop(state.pinned).catch((e: unknown) => console.warn("setAlwaysOnTop:", e));
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
  } catch (e) {
    console.warn("saveWindowState failed:", e);
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
  onAlertThreshold: async (threshold: string) => {
    await invoke("set_alert_threshold", { threshold });
    state = reduce(state, { type: "set_alert_threshold", threshold });
  },
  onPrivacyToggle: async (enabled: boolean) => {
    await invoke("set_privacy_mode", { enabled });
    state = reduce(state, { type: "set_privacy_mode", enabled });
    render();
  },
  onThemeChange: async (theme: string) => {
    await invoke("set_theme", { theme });
    state = reduce(state, { type: "set_theme", theme });
    applyTheme(theme);
    render();
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

async function exportCSV(btnEl?: HTMLElement) {
  const revert = () => {
    if (btnEl) { btnEl.textContent = "导出"; btnEl.classList.remove("done"); }
  };
  try {
    // Feedback: show loading state
    if (btnEl) { btnEl.textContent = "导出中…"; btnEl.classList.add("pulse"); }

    const h = await invoke("get_history", { days: 365 }) as Snapshot[];
    if (!h.length) {
      if (btnEl) { btnEl.textContent = "无数据"; setTimeout(revert, 1500); }
      return;
    }
    let csv = "﻿时间,余额(元),货币\n";
    for (const r of h) {
      csv += new Date(r.ts_utc).toISOString() + "," + r.balance + "," + r.currency + "\n";
    }

    // Use native save dialog
    const { save } = await import("@tauri-apps/plugin-dialog");
    const defaultName = "deepseekbar_" + new Date().toISOString().slice(0, 10) + ".csv";
    const path = await save({
      defaultPath: defaultName,
      filters: [{ name: "CSV 文件", extensions: ["csv"] }],
    });
    if (!path) { revert(); return; } // user cancelled

    await invoke("save_file", { path, content: csv });

    // Success feedback
    if (btnEl) { btnEl.textContent = "已导出 ✓"; btnEl.classList.remove("pulse"); btnEl.classList.add("done"); setTimeout(revert, 2000); }
  } catch (e) {
    console.warn("exportCSV failed:", e);
    if (btnEl) { btnEl.textContent = "导出失败"; setTimeout(revert, 2000); }
  }
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
    await listen<{ message: string }>("balance:alert", (e) => {
      state = reduce(state, { type: "set_alert", message: e.payload.message });
      render();
      new Notification("DeepSeekBar 余额预警", { body: e.payload.message });
    }),
    await listen<{ mode: string }>("mode:changed", async (e) => {
      if (e.payload.mode === "settings") {
        const a = await invoke<boolean>("get_autostart");
        state = reduce(state, { type: "set_autostart", enabled: a });
        const interval = await invoke<number>("get_refresh_interval");
        state = reduce(state, { type: "set_refresh_interval", secs: interval });
        const alertThresh = await invoke<string | null>("get_alert_threshold");
        if (alertThresh) state = reduce(state, { type: "set_alert_threshold", threshold: alertThresh });
        const pm2 = await invoke<boolean>("get_privacy_mode");
        state = reduce(state, { type: "set_privacy_mode", enabled: pm2 });
        const theme2 = await invoke<string>("get_theme");
        state = reduce(state, { type: "set_theme", theme: theme2 });
        applyTheme(theme2);
        state = reduce(state, { type: "set_mode", mode: "settings" });
        render();
      } else if (e.payload.mode === "toggle_privacy") {
        const pm = !state.privacyMode;
        await invoke("set_privacy_mode", { enabled: pm });
        state = reduce(state, { type: "set_privacy_mode", enabled: pm });
        render();
      }
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

    // --- Drag: cached position eliminates async race on mousedown ---
  let dragActive = false;
  let dragPhysX = 0;  // cached window physical X
  let dragPhysY = 0;  // cached window physical Y
  let dragScale = 1;
  let dragOffX = 0;   // screen*scale - physical (computed on mousedown)
  let dragOffY = 0;

  async function cacheDragPos() {
    try {
      const [pos, sf] = await Promise.all([win.outerPosition(), win.scaleFactor()]);
      dragScale = sf;
      dragPhysX = pos.x;
      dragPhysY = pos.y;
    } catch {}
  }

  function moveWindow(sx: number, sy: number) {
    const px = Math.round(sx * dragScale - dragOffX);
    const py = Math.round(sy * dragScale - dragOffY);
    win.setPosition(new PhysicalPosition(px, py)).catch(() => {});
  }

  cacheDragPos(); // prime cache at startup

  app.addEventListener("mousedown", (e) => {
    if (state.mode !== "compact" && state.mode !== "expanded") return;
    if (e.button !== 0) return;
    if (dragActive) return;

    dragActive = true;
    dragOffX = e.screenX * dragScale - dragPhysX;
    dragOffY = e.screenY * dragScale - dragPhysY;
    e.preventDefault();
  });

  window.addEventListener("mousemove", (e) => {
    if (!dragActive) return;
    moveWindow(e.screenX, e.screenY);
  });

  window.addEventListener("mouseup", () => {
    if (!dragActive) return;
    dragActive = false;
    cacheDragPos().then(() => saveWindowState());
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

  // Register global hotkey (non-blocking, after critical handlers)
  setTimeout(async () => {
    try { await register("Ctrl+Shift+D", async () => { const vis = await win.isVisible(); if (vis) { await win.hide(); } else { await win.show(); await win.setFocus(); } }); } catch {}
  }, 1000);

  app.addEventListener("contextmenu", async (e) => {
    e.preventDefault();
    if (state.mode === "compact") {
      state = reduce(state, { type: "refresh_started" });
      render();
      await invoke("trigger_refresh");
    } else {
      showContextMenu(e.clientX, e.clientY);
    }
  });

  // Delegated click handler for expanded view buttons
  app.addEventListener("click", async (e) => {
    const target = e.target as HTMLElement;
    const btn = target.closest<HTMLElement>("[data-action], .close");
    if (!btn) return;
    e.stopPropagation();
    const action = btn.dataset.action || (btn.classList.contains("close") ? "close" : null);
    if (!action) return;
    if (action === "dismiss-alert") {
      state = reduce(state, { type: "clear_alert" });
      render();
      return;
    } else if (action === "refresh") {
      state = reduce(state, { type: "refresh_started" });
      render();
      await invoke("trigger_refresh");
    } else if (action === "settings") {
      const a = await invoke<boolean>("get_autostart");
      state = reduce(state, { type: "set_autostart", enabled: a });
      const interval = await invoke<number>("get_refresh_interval");
      state = reduce(state, { type: "set_refresh_interval", secs: interval });
      const thresh = await invoke<string | null>("get_alert_threshold");
      if (thresh) state = reduce(state, { type: "set_alert_threshold", threshold: thresh });
      const pm = await invoke<boolean>("get_privacy_mode");
      state = reduce(state, { type: "set_privacy_mode", enabled: pm });
      const theme = await invoke<string>("get_theme");
      state = reduce(state, { type: "set_theme", theme });
      applyTheme(theme);
      if (state.apiKeyConfigured && !state.apiKey) {
        const key = await invoke<string | null>("get_api_key");
        if (key) state = reduce(state, { type: "set_api_key", key });
      }
      state = reduce(state, { type: "set_mode", mode: "settings" });
      render();
    } else if (action === "export") {
      exportCSV(btn as HTMLElement);
      return;
    } else if (action === "close") {
      state = reduce(state, { type: "set_mode", mode: "compact" });
      render();
    }
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
  const theme = await invoke<string>("get_theme");
    applyTheme(theme);
    state = reduce(state, { type: "set_theme", theme });
    const pm = await invoke<boolean>("get_privacy_mode");
    state = reduce(state, { type: "set_privacy_mode", enabled: pm });

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
    <hr/>
    <button data-act="export">导出 CSV</button>

  `;
  document.body.appendChild(m);
  const close = () => m.remove();
  m.addEventListener("click", async (ev) => {
    const t = (ev.target as HTMLElement).dataset.act;
    if (t === "refresh") await invoke("trigger_refresh");
    else if (t === "toggle") {
      state = reduce(state, { type: "set_mode", mode: state.mode === "compact" ? "expanded" : "compact" });
    }     else if (t === "export") {
      exportCSV();
      close();
      return;
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
