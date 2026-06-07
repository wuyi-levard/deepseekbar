import { formatBalance, toDecimal } from "../format";
import { renderLineChart } from "../chart";
import type { UiState } from "../state";
import { escapeText } from "../util";

function lastSyncText(ms: number): string {
  if (!ms) return "";
  const now = Date.now();
  const diff = now - ms;
  if (diff < 60_000) return "刚刚";
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)} 分钟前`;
  const d = new Date(ms);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) {
    return `今天 ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  }
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function renderExpanded(root: HTMLElement, s: UiState): void {
  const amount = s.balance
    ? `¥ ${formatBalance(s.balance.available)}`
    : s.error?.kind === "auth" ? "AUTH" : "——";

  const hasHistory = s.history.length > 0;
  const sync = s.lastRefreshMs ? lastSyncText(s.lastRefreshMs) : "";
  const next = s.balance && !s.error
    ? `● 已同步${sync ? `（${sync}）` : ""}`
    : `● 状态：${s.error?.message ?? "未知"}`;
  const empty = !hasHistory;

  root.innerHTML = `
    <div class="expanded">
      ${s.alertMessage ? `<div class="alert-banner">⚠ ${escapeText(s.alertMessage)}<button class="alert-dismiss" data-action="dismiss-alert">✕</button></div>` : ""}
      <div class="row top">
        <span class="label">余额</span>
        <span class="amount">${amount}</span>
        <button class="close" aria-label="关闭">✕</button>
      </div>
      <hr/>
      <div class="chart-wrap">
        ${empty ? `<div class="empty">暂无趋势数据，下次刷新后将开始记录</div>` : `<svg class="chart" data-role="chart"></svg>`}
        ${hasHistory ? `<div class="row stats">
          <span>高 ${formatBalance(max(s.history))}</span>
          <span>低 ${formatBalance(min(s.history))}</span>
        </div>` : ""}
      </div>
      <div class="row status">${escapeText(next)}</div>
      <div class="row actions">
        <button data-action="refresh">立即刷新</button>
        <button data-action="settings">设置</button>
        <button data-action="export">导出</button>
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


