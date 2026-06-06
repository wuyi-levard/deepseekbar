// src/chart.test.ts
import { describe, expect, it, beforeEach } from "vitest";
import { renderLineChart } from "./chart";

describe("renderLineChart", () => {
  let svg: SVGSVGElement;
  beforeEach(() => {
    svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  });

  it("renders nothing for empty input", () => {
    renderLineChart(svg, []);
    expect(svg.children.length).toBe(0);
  });

  it("renders area + line + axis labels for non-empty input", () => {
    renderLineChart(svg, [
      { ts_utc: 1700000000000, balance: "10" },
      { ts_utc: 1700001000000, balance: "20" },
      { ts_utc: 1700002000000, balance: "15" },
    ]);
    // At minimum: area + line + Y-axis labels + X-axis labels
    expect(svg.children.length).toBeGreaterThan(2);
    expect(svg.getAttribute("viewBox")).toBe("0 0 350 200");

    // Verify paths are present (area + line)
    const paths = svg.querySelectorAll("path");
    expect(paths.length).toBe(2);
  });

  it("handles flat (all-equal) values without divide-by-zero", () => {
    renderLineChart(svg, [
      { ts_utc: 1700000000000, balance: "5" },
      { ts_utc: 1700001000000, balance: "5" },
    ]);
    expect(svg.children.length).toBeGreaterThan(2);
  });

  it("renders Y-axis tick labels starting with ¥", () => {
    renderLineChart(svg, [
      { ts_utc: 1700000000000, balance: "1.23" },
      { ts_utc: 1700001000000, balance: "4.56" },
    ]);
    const texts = svg.querySelectorAll("text");
    const yLabels = Array.from(texts).filter(
      (t) => t.textContent?.startsWith("¥"),
    );
    expect(yLabels.length).toBeGreaterThan(0);
  });

  it("renders X-axis time labels (MM/DD or HH:MM)", () => {
    const ts = Date.now();
    renderLineChart(svg, [
      { ts_utc: ts, balance: "10" },
      { ts_utc: ts + 86_400_000, balance: "20" },
      { ts_utc: ts + 2 * 86_400_000, balance: "15" },
    ]);
    const texts = svg.querySelectorAll("text");
    // Find at least one X-axis label (not starting with ¥)
    const xLabels = Array.from(texts).filter(
      (t) => !t.textContent?.startsWith("¥"),
    );
    expect(xLabels.length).toBeGreaterThan(0);
  });

  it("uses time format when all points are same day", () => {
    const base = new Date("2026-06-06T10:00:00Z").getTime();
    renderLineChart(svg, [
      { ts_utc: base, balance: "10" },
      { ts_utc: base + 3_600_000, balance: "20" },
      { ts_utc: base + 7_200_000, balance: "15" },
    ]);
    const texts = svg.querySelectorAll("text");
    const xLabels = Array.from(texts).filter(
      (t) => !t.textContent?.startsWith("¥"),
    );
    // Should be HH:MM format (contains colon)
    const hasTime = xLabels.some((t) => t.textContent?.includes(":"));
    expect(hasTime).toBe(true);
  });

  it("renders grid lines", () => {
    renderLineChart(svg, [
      { ts_utc: 1700000000000, balance: "1" },
      { ts_utc: 1700001000000, balance: "10" },
    ]);
    const lines = svg.querySelectorAll("line");
    // Should have horizontal grid lines + X-axis tick marks
    expect(lines.length).toBeGreaterThan(1);
  });

  it("handles single point without error", () => {
    renderLineChart(svg, [{ ts_utc: 1700000000000, balance: "10" }]);
    // Should render something without crashing
    expect(svg.children.length).toBeGreaterThan(0);
  });

  it("respects custom dimensions", () => {
    renderLineChart(
      svg,
      [
        { ts_utc: 1700000000000, balance: "1" },
        { ts_utc: 1700001000000, balance: "5" },
      ],
      { width: 400, height: 250 },
    );
    expect(svg.getAttribute("viewBox")).toBe("0 0 400 250");
  });

  it("sorts points by timestamp before drawing", () => {
    const ts = Date.now();
    renderLineChart(svg, [
      { ts_utc: ts + 2000, balance: "15" },
      { ts_utc: ts, balance: "5" },
      { ts_utc: ts + 1000, balance: "10" },
    ]);
    // Should render without error — order corrected internally
    const paths = svg.querySelectorAll("path");
    expect(paths.length).toBe(2);
  });
});
