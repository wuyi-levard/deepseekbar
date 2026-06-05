// src/chart.test.ts
import { describe, expect, it, beforeEach } from "vitest";
import { renderLine } from "./chart";

describe("renderLine", () => {
  let svg: SVGSVGElement;
  beforeEach(() => {
    svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  });

  it("renders nothing for empty input", () => {
    renderLine(svg, []);
    expect(svg.children.length).toBe(0);
  });

  it("renders area + line for non-empty input", () => {
    renderLine(svg, [
      { ts_utc: 1, balance: "10" },
      { ts_utc: 2, balance: "20" },
      { ts_utc: 3, balance: "15" },
    ]);
    expect(svg.children.length).toBe(2);
    expect(svg.getAttribute("viewBox")).toBe("0 0 320 100");
  });

  it("handles flat (all-equal) range without divide-by-zero", () => {
    renderLine(svg, [
      { ts_utc: 1, balance: "5" },
      { ts_utc: 2, balance: "5" },
    ]);
    expect(svg.children.length).toBe(2);
  });
});
