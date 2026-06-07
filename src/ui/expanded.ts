import { formatBalance, toDecimal } from "../format";
import { renderLineChart } from "../chart";
import { t } from "../i18n";
import type { UiState } from "../state";
import { escapeText } from "../util";

function lastSyncText(ms: number): string {
  if (!ms) return "";
  const d = new Date(ms);
  const mon = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${mon}-${day} ${hh}:${mm}:${ss}`;
}

export function renderExpanded(root: HTMLElement, s: UiState): void {
  const m = t();
  const amount = s.balance
    ? `¥ ${formatBalance(s.balance.available)}`
    : s.error?.kind === "auth" ? m.compactAuth : m.compactEmpty;

  const hasHistory = s.history.length > 0;
  const sync = s.lastRefreshMs ? lastSyncText(s.lastRefreshMs) : "";
  const next = s.balance && !s.error
    ? `● ${m.expSynced}${sync ? `（${sync}）` : ""}`
    : `● ${m.expUnknown}${s.error?.message ? `：${s.error.message}` : ""}`;
  const empty = !hasHistory;

  root.innerHTML = `
    <div class="expanded">
      ${s.alertMessage ? `<div class="alert-banner">⚠ ${escapeText(s.alertMessage)}<button class="alert-dismiss" data-action="dismiss-alert">✕</button></div>` : ""}
      <div class="row top">
        <span class="label">${m.expLabelBalance}</span>
        <span class="amount">${amount}</span>
        <button class="close" aria-label="关闭">✕</button>
      </div>
      <hr/>
      <div class="chart-wrap">
        ${empty ? `<div class="empty">${m.expEmptyChart}</div>` : `<svg class="chart" data-role="chart"></svg>`}
        ${hasHistory ? `<div class="row stats">
          <span>${m.expHigh} ${formatBalance(max(s.history))}</span>
          <span>${m.expLow} ${formatBalance(min(s.history))}</span>
        </div>` : ""}
      </div>
      <div class="row status">${escapeText(next)}</div>
      <div class="row actions">
        <button data-action="refresh">${m.expBtnRefresh}</button>
        <button data-action="settings">${m.expBtnSettings}</button>
        <button data-action="export">${m.expBtnExport}</button>
      </div>
    </div>
  `;

  if (hasHistory) {
    const svg = root.querySelector<SVGSVGElement>('svg[data-role="chart"]');
    if (svg) {
      renderLineChart(
        svg,
        s.history.map((h) => ({ ts_utc: h.ts_utc, balance: h.balance })),
        { width: 350, height: 200 },
      );
    }
  }
}

function max(arr: { balance: string }[]): string {
  return arr
    .map((h) => toDecimal(h.balance))
    .reduce((a, b) => (b.greaterThan(a) ? b : a), toDecimal("0"))
    .toString();
}
function min(arr: { balance: string }[]): string {
  return arr
    .map((h) => toDecimal(h.balance))
    .reduce((a, b) => (b.lessThan(a) ? b : a), toDecimal("0"))
    .toString();
}


