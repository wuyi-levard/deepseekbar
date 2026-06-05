import { describe, expect, it } from "vitest";
import { formatBalance, formatDelta, toDecimal } from "./format";

describe("toDecimal", () => {
  it("parses string", () => {
    expect(toDecimal("12.34").toString()).toBe("12.34");
  });
  it("returns 0 for empty", () => {
    expect(toDecimal("").toString()).toBe("0");
  });
  it("returns 0 for null/undefined", () => {
    expect(toDecimal(null).toString()).toBe("0");
    expect(toDecimal(undefined).toString()).toBe("0");
  });
  it("returns 0 for garbage", () => {
    expect(toDecimal("abc").toString()).toBe("0");
  });
});

describe("formatBalance", () => {
  it("two decimals", () => {
    expect(formatBalance("12.34")).toBe("12.34");
    expect(formatBalance("0")).toBe("0.00");
  });
  it("preserves high precision up to 2dp visually", () => {
    expect(formatBalance("0.000123456789")).toBe("0.00");
  });
  it("empty -> 0.00", () => {
    expect(formatBalance("")).toBe("0.00");
  });
});

describe("formatDelta", () => {
  it("up arrow when positive", () => {
    expect(formatDelta("1.00", "1.50")).toBe("⌃0.50");
  });
  it("down arrow when negative", () => {
    expect(formatDelta("1.00", "0.50")).toBe("⌄0.50");
  });
  it("zero shown as ±0.00", () => {
    expect(formatDelta("1.00", "1.00")).toBe("±0.00");
  });
  it("empty when no prev", () => {
    expect(formatDelta(null, "1.00")).toBe("");
  });
});
