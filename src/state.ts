// src/state.ts
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
  | { type: "load_history"; history: Snapshot[] };

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
      return {
        ...s,
        balance: a.balance,
        prevAvailable: prev,
        history,
        error: null,
        refreshing: false,
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
  }
}
