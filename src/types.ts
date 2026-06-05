export interface Balance {
  currency: string;
  total: string;
  granted: string;
  topped_up: string;
  available: string;
}

export interface Snapshot {
  ts_utc: number;
  balance: string;
  currency: string;
  is_stale: boolean;
}

export interface Position {
  x: number;
  y: number;
}

export interface WindowState {
  position: Position | null;
  mode: "compact" | "expanded" | "settings";
  pinned: boolean;
}

export type ErrorKind = "auth" | "network" | "parse" | "internal";

export interface BalanceError {
  kind: ErrorKind;
  message: string;
}

export type UiMode = "compact" | "expanded" | "settings";
