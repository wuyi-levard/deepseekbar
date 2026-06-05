// src/state.test.ts
import { describe, expect, it } from "vitest";
import { initialState, reduce } from "./state";

describe("reduce", () => {
  it("set_mode updates mode", () => {
    const s = reduce(initialState, { type: "set_mode", mode: "expanded" });
    expect(s.mode).toBe("expanded");
  });

  it("balance_loaded updates balance and preserves prev", () => {
    const s1 = reduce(initialState, {
      type: "balance_loaded",
      balance: { currency: "CNY", total: "10", granted: "0", topped_up: "10", available: "10" },
      snapshot: null,
    });
    expect(s1.balance?.available).toBe("10");
    expect(s1.prevAvailable).toBeNull();

    const s2 = reduce(s1, {
      type: "balance_loaded",
      balance: { currency: "CNY", total: "12", granted: "0", topped_up: "12", available: "12" },
      snapshot: null,
    });
    expect(s2.prevAvailable).toBe("10");
    expect(s2.balance?.available).toBe("12");
  });

  it("balance_loaded appends snapshot to history (dedup)", () => {
    const snap = { ts_utc: 1, balance: "10", currency: "CNY", is_stale: false };
    const s1 = reduce(initialState, {
      type: "balance_loaded",
      balance: { currency: "CNY", total: "10", granted: "0", topped_up: "10", available: "10" },
      snapshot: snap,
    });
    const s2 = reduce(s1, {
      type: "balance_loaded",
      balance: { currency: "CNY", total: "10", granted: "0", topped_up: "10", available: "10" },
      snapshot: snap,
    });
    expect(s2.history.length).toBe(1);
  });

  it("balance_error sets error and clears refreshing", () => {
    const s1 = reduce(initialState, { type: "refresh_started" });
    const s2 = reduce(s1, { type: "balance_error", kind: "auth", message: "bad key" });
    expect(s2.error).toEqual({ kind: "auth", message: "bad key" });
    expect(s2.refreshing).toBe(false);
  });

  it("set_api_key_configured false resets to settings mode", () => {
    const s1 = reduce(initialState, { type: "set_mode", mode: "expanded" });
    const s2 = reduce(s1, { type: "set_api_key_configured", configured: false });
    expect(s2.mode).toBe("settings");
    expect(s2.apiKeyConfigured).toBe(false);
  });

  it("set_pinned updates pinned", () => {
    const s = reduce(initialState, { type: "set_pinned", pinned: false });
    expect(s.pinned).toBe(false);
  });

  it("load_history replaces history", () => {
    const h = [
      { ts_utc: 1, balance: "1", currency: "CNY", is_stale: false },
      { ts_utc: 2, balance: "2", currency: "CNY", is_stale: false },
    ];
    const s = reduce(initialState, { type: "load_history", history: h });
    expect(s.history).toEqual(h);
  });
});
