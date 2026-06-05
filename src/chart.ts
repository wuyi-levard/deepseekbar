// src/chart.ts
import Decimal from "decimal.js-light";
import { toDecimal } from "./format";

export interface LinePoint {
  ts_utc: number;
  balance: string;
}

export interface LineOpts {
  width: number;
  height: number;
  padding: number;
  stroke: string;
  fill: string;
}

const DEFAULTS: LineOpts = {
  width: 320,
  height: 100,
  padding: 8,
  stroke: "#3b82f6",
  fill: "rgba(59,130,246,0.10)",
};

export function renderLine(
  svg: SVGSVGElement,
  points: LinePoint[],
  opts: Partial<LineOpts> = {},
): void {
  const o = { ...DEFAULTS, ...opts };
  svg.setAttribute("viewBox", `0 0 ${o.width} ${o.height}`);
  svg.setAttribute("width", String(o.width));
  svg.setAttribute("height", String(o.height));
  svg.innerHTML = "";

  if (points.length === 0) return;

  const decimals = points.map((p) => toDecimal(p.balance));
  const minD = decimals.reduce((a, b) => (b.lessThan(a) ? b : a));
  const maxD = decimals.reduce((a, b) => (b.greaterThan(a) ? b : a));
  const range = maxD.minus(minD);
  const yRange = range.isZero() ? new Decimal(1) : range;

  const xStep = (o.width - 2 * o.padding) / Math.max(1, points.length - 1);
  const xAt = (i: number) => o.padding + i * xStep;
  const yAt = (d: ReturnType<typeof toDecimal>) =>
    o.height - o.padding - d.minus(minD).div(yRange).mul(o.height - 2 * o.padding).toNumber();

  const path = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${xAt(i).toFixed(1)},${yAt(toDecimal(p.balance)).toFixed(1)}`)
    .join(" ");

  const areaPath = `${path} L${xAt(points.length - 1).toFixed(1)},${(o.height - o.padding).toFixed(1)} L${xAt(0).toFixed(1)},${(o.height - o.padding).toFixed(1)} Z`;

  const ns = "http://www.w3.org/2000/svg";
  const area = document.createElementNS(ns, "path");
  area.setAttribute("d", areaPath);
  area.setAttribute("fill", o.fill);
  svg.appendChild(area);

  const line = document.createElementNS(ns, "path");
  line.setAttribute("d", path);
  line.setAttribute("stroke", o.stroke);
  line.setAttribute("stroke-width", "1.5");
  line.setAttribute("fill", "none");
  svg.appendChild(line);
}
