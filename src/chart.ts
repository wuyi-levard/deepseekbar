// src/chart.ts — SVG line chart with Y-axis ticks + X-axis time labels
import Decimal from "decimal.js-light";
import { toDecimal } from "./format";

export interface LinePoint {
  ts_utc: number;
  balance: string;
}

export interface ChartOpts {
  width: number;
  height: number;
  marginLeft: number;
  marginRight: number;
  marginTop: number;
  marginBottom: number;
  stroke: string;
  fill: string;
  gridStroke: string;
  textFill: string;
}

const DEFAULTS: ChartOpts = {
  width: 350,
  height: 200,
  marginLeft: 50,
  marginRight: 14,
  marginTop: 10,
  marginBottom: 26,
  stroke: "#4f8cff",
  fill: "rgba(79,140,255,0.10)",
  gridStroke: "rgba(255,255,255,0.07)",
  textFill: "#9aa0b4",
};

// ---- helpers ----

/** Pick a nice tick step so we get ~4–6 ticks across the range. */
function niceStep(range: Decimal): Decimal {
  if (range.isZero() || range.lessThan(new Decimal("1e-12")))
    return new Decimal(1);
  const n = range.toNumber();
  const exp = Math.floor(Math.log10(n));
  const frac = n / Math.pow(10, exp);
  let nice: number;
  if (frac <= 1.5) nice = 0.2;
  else if (frac <= 3) nice = 0.5;
  else if (frac <= 7) nice = 1;
  else nice = 2;
  // scale back up
  return new Decimal(nice).mul(Math.pow(10, exp));
}

/** Format a Y-axis tick value: keep up to 6 decimal places, trim trailing zeros. */
function fmtY(v: Decimal): string {
  const s = v.toFixed(6);
  // strip trailing zeros, keep at least one decimal digit
  const m = /^(-?\d+\.\d*?)0*$/.exec(s);
  if (m) {
    const d = m[1];
    return d.endsWith(".") ? d + "0" : d;
  }
  return s;
}

/** Format a timestamp for the X axis. */
function fmtX(ts: number, sameDay: boolean): string {
  const d = new Date(ts);
  if (sameDay) {
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    return `${hh}:${mm}`;
  }
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function isSameDay(points: LinePoint[]): boolean {
  if (points.length < 2) return true;
  const d0 = new Date(points[0].ts_utc).toDateString();
  for (let i = 1; i < points.length; i++) {
    if (new Date(points[i].ts_utc).toDateString() !== d0) return false;
  }
  return true;
}

// ---- main render ----

export function renderLineChart(
  svg: SVGSVGElement,
  points: LinePoint[],
  opts: Partial<ChartOpts> = {},
): void {
  const o = { ...DEFAULTS, ...opts };
  svg.setAttribute("viewBox", `0 0 ${o.width} ${o.height}`);
  svg.setAttribute("width", String(o.width));
  svg.setAttribute("height", String(o.height));
  while (svg.firstChild) svg.removeChild(svg.firstChild);
  if (points.length === 0) return;

  const sorted = [...points].sort((a, b) => a.ts_utc - b.ts_utc);
  const plotX = o.marginLeft;
  const plotY = o.marginTop;
  const plotW = o.width - o.marginLeft - o.marginRight;
  const plotH = o.height - o.marginTop - o.marginBottom;

  // --- value domain ---
  const values = sorted.map((p) => toDecimal(p.balance));
  let minV = values.reduce((a, b) => (b.lessThan(a) ? b : a));
  let maxV = values.reduce((a, b) => (b.greaterThan(a) ? b : a));
  // add 5 % headroom so the line never touches the top edge
  const pad = maxV.minus(minV).isZero()
    ? new Decimal(0.1)
    : maxV.minus(minV).mul(0.05);
  minV = minV.minus(pad);
  if (minV.lessThan(0)) minV = new Decimal(0);
  maxV = maxV.plus(pad);
  const yRange = maxV.minus(minV).isZero() ? new Decimal(1) : maxV.minus(minV);

  const yAt = (d: Decimal) =>
    plotY + plotH - d.minus(minV).div(yRange).mul(plotH).toNumber();

  // --- time domain ---
  const tMin = sorted[0].ts_utc;
  const tMax = sorted[sorted.length - 1].ts_utc;
  const tSpan = tMax - tMin || 1;
  const xAt = (ts: number) =>
    plotX + ((ts - tMin) / tSpan) * plotW;

  // ===================================================================
  // Y-axis ticks + horizontal grid lines
  // ===================================================================
  const tickStep = niceStep(yRange);
  // start at the first tick boundary ≥ minV (use Math.ceil since
  // decimal.js-light may not expose .ceil() as an instance method)
  let tick = new Decimal(
    Math.ceil(minV.div(tickStep).toNumber()),
  ).mul(tickStep);
  const ns = "http://www.w3.org/2000/svg";

  while (tick.lessThanOrEqualTo(maxV.add(tickStep.div(2)))) {
    const y = yAt(tick);

    // grid line
    const gl = document.createElementNS(ns, "line");
    gl.setAttribute("x1", String(plotX));
    gl.setAttribute("x2", String(plotX + plotW));
    gl.setAttribute("y1", y.toFixed(1));
    gl.setAttribute("y2", y.toFixed(1));
    gl.setAttribute("stroke", o.gridStroke);
    gl.setAttribute("stroke-width", "0.5");
    svg.appendChild(gl);

    // tick label
    const txt = document.createElementNS(ns, "text");
    txt.setAttribute("x", String(plotX - 6));
    txt.setAttribute("y", (y + 4).toFixed(1));
    txt.setAttribute("text-anchor", "end");
    txt.setAttribute("fill", o.textFill);
    txt.setAttribute("font-size", "10");
    txt.setAttribute("font-family", "inherit");
    txt.textContent = `¥${fmtY(tick)}`;
    svg.appendChild(txt);

    tick = tick.plus(tickStep);
  }

  // ===================================================================
  // X-axis labels (pick ~5 evenly-spaced points)
  // ===================================================================
  const sameDay = isSameDay(sorted);
  const labelStep = Math.max(1, Math.ceil(sorted.length / 5));
  const shown = new Set<number>();

  for (let i = 0; i < sorted.length; i += labelStep) {
    shown.add(i);
  }
  // always include the last point
  if (sorted.length > 1) shown.add(sorted.length - 1);

  for (const idx of shown) {
    const p = sorted[idx];
    const x = xAt(p.ts_utc);

    // tick mark
    const mk = document.createElementNS(ns, "line");
    mk.setAttribute("x1", x.toFixed(1));
    mk.setAttribute("x2", x.toFixed(1));
    mk.setAttribute("y1", (plotY + plotH).toFixed(1));
    mk.setAttribute("y2", (plotY + plotH + 5).toFixed(1));
    mk.setAttribute("stroke", o.gridStroke);
    mk.setAttribute("stroke-width", "0.5");
    svg.appendChild(mk);

    // label
    const txt = document.createElementNS(ns, "text");
    txt.setAttribute("x", x.toFixed(1));
    txt.setAttribute("y", String(plotY + plotH + 17));
    txt.setAttribute("text-anchor", "middle");
    txt.setAttribute("fill", o.textFill);
    txt.setAttribute("font-size", "9");
    txt.setAttribute("font-family", "inherit");
    txt.textContent = fmtX(p.ts_utc, sameDay);
    svg.appendChild(txt);
  }

  // ===================================================================
  // Line + area paths
  // ===================================================================
  const pathD = sorted
    .map((p, i) => {
      const cmd = i === 0 ? "M" : "L";
      return `${cmd}${xAt(p.ts_utc).toFixed(1)},${yAt(toDecimal(p.balance)).toFixed(1)}`;
    })
    .join(" ");

  const lastX = xAt(sorted[sorted.length - 1].ts_utc).toFixed(1);
  const firstX = xAt(sorted[0].ts_utc).toFixed(1);
  const baseY = (plotY + plotH).toFixed(1);
  const areaD = `${pathD} L${lastX},${baseY} L${firstX},${baseY} Z`;

  const areaEl = document.createElementNS(ns, "path");
  areaEl.setAttribute("d", areaD);
  areaEl.setAttribute("fill", o.fill);
  svg.appendChild(areaEl);

  const lineEl = document.createElementNS(ns, "path");
  lineEl.setAttribute("d", pathD);
  lineEl.setAttribute("stroke", o.stroke);
  lineEl.setAttribute("stroke-width", "1.5");
  lineEl.setAttribute("fill", "none");
  lineEl.setAttribute("stroke-linejoin", "round");
  svg.appendChild(lineEl);
}
