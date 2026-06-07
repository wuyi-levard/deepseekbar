// src/state.ts
import { toDecimal } from "./format";
import type { Balance, ErrorKind, Snapshot, UiMode } from "./types";

export interface UiState {
  mode: UiMode;
  balance: Balance | null;
  prevAvailable: string | null;
  history: Snapshot[];
  error: { kind: ErrorKind; message: string } | null;
  refreshing: boolean;
  apiKeyConfigured: boolean;
  apiKey: string | null;
  pinned: boolean;
  autostartEnabled?: boolean;
  refreshInterval?: number;
  alertThreshold?: string;
  alertMessage: string | null;
  lastRefreshMs: number;
  updateStatus: "idle" | "checking" | "available" | "downloading" | "done" | "error";
  updateInfo: { version: string; body: string } | null;
  updateProgress: number;
  updateMessage: string;
  updatePath: string;
  privacyMode: boolean;
  theme: string;
}

export const initialState: UiState = {
  mode: "compact",
  balance: null,
  prevAvailable: null,
  history: [],
  error: null,
  refreshing: false,
  apiKeyConfigured: false,
  apiKey: null,
  pinned: true,
  alertMessage: null,
  lastRefreshMs: 0,
  updateStatus: "idle",
  updateInfo: null,
  updateProgress: 0,
  updateMessage: "",
  updatePath: "",
  privacyMode: false,
  theme: "deepseek",
};

export type Action =
  | { type: "set_mode"; mode: UiMode }
  | { type: "balance_loaded"; balance: Balance; snapshot: Snapshot | null }
  | { type: "balance_error"; kind: ErrorKind; message: string }
  | { type: "refresh_started" }
  | { type: "refresh_finished" }
  | { type: "set_api_key_configured"; configured: boolean }
  | { type: "set_api_key"; key: string | null }
  | { type: "set_pinned"; pinned: boolean }
  | { type: "set_autostart"; enabled: boolean }
  | { type: "load_history"; history: Snapshot[] }
  | { type: "set_refresh_interval"; secs: number }
  | { type: "set_alert_threshold"; threshold: string }
  | { type: "set_alert"; message: string }
  | { type: "clear_alert" }
  | { type: "set_update_checking" }
  | { type: "set_update_available"; info: { version: string; body: string } }
  | { type: "set_update_progress"; percent: number }
  | { type: "set_update_done"; path: string; version: string }
  | { type: "set_update_error"; message: string }
  | { type: "set_privacy_mode"; enabled: boolean }
  | { type: "set_theme"; theme: string };

export function reduce(s: UiState, a: Action): UiState {
  switch (a.type) {
    case "set_mode":
      return { ...s, mode: a.mode };
    case "balance_loaded": {
      const prev = s.balance?.available ?? s.prevAvailable;
      const history =
        a.snapshot && !s.history.find((h) => h.ts_utc === a.snapshot!.ts_utc)
          ? [...s.history, a.snapshot]
          : s.history;
      // Auto-clear alert when balance recovers above threshold
      let alertMessage = s.alertMessage;
      if (alertMessage && s.alertThreshold) {
        if (toDecimal(a.balance.available).greaterThanOrEqualTo(toDecimal(s.alertThreshold))) {
          alertMessage = null;
        }
      }
      return {
        ...s,
        balance: a.balance,
        prevAvailable: prev,
        history,
        error: null,
        refreshing: false,
        alertMessage,
        lastRefreshMs: a.snapshot?.ts_utc ?? Date.now(),
      };
    }
    case "balance_error":
      return {
        ...s,
        error: { kind: a.kind, message: a.message },
        refreshing: false,
      };
    case "refresh_started":
      return { ...s, refreshing: true };
    case "refresh_finished":
      return { ...s, refreshing: false };
    case "set_api_key_configured":
      if (a.configured) return { ...s, apiKeyConfigured: true };
      return { ...s, apiKeyConfigured: false, mode: "settings", balance: null, history: [] };
    case "set_api_key":
      return { ...s, apiKey: a.key };
    case "set_pinned":
      return { ...s, pinned: a.pinned };
    case "set_autostart":
      return { ...s, autostartEnabled: a.enabled };
    case "load_history":
      return { ...s, history: a.history };
    case "set_refresh_interval":
      return { ...s, refreshInterval: a.secs };
    case "set_alert_threshold":
      return { ...s, alertThreshold: a.threshold };
    case "set_alert":
      return { ...s, alertMessage: a.message };
    case "clear_alert":
      return { ...s, alertMessage: null };
    case "set_update_checking":
      return { ...s, updateStatus: "checking", updateMessage: "", updateProgress: 0 };
    case "set_update_available":
      return { ...s, updateStatus: "available", updateInfo: a.info };
    case "set_update_progress":
      return { ...s, updateStatus: "downloading", updateProgress: a.percent };
    case "set_update_done":
      return { ...s, updateStatus: "done", updatePath: a.path, updateMessage: a.version, updateProgress: 100 };
    case "set_update_error":
      return { ...s, updateStatus: "error", updateMessage: a.message };
    case "set_privacy_mode":
      return { ...s, privacyMode: a.enabled };
    case "set_theme":
      return { ...s, theme: a.theme };
  }
}
