import { formatBalance, toDecimal } from "../format";
import { renderLine } from "../chart";
import type { UiState } from "../state";
import { escapeText } from "../util";

export function renderExpanded(root: HTMLElement, s: UiState): void {
  const amount = s.balance
    ? `¥ ${formatBalance(s.balance.available)}`
    : s.error?.kind === "auth" ? "AUTH" : "——";

  const hasHistory = s.history.length > 0;
  const next = s.balance && !s.error ? "● 已同步" : `● 状态：${s.error?.message ?? "未知"}`;
  const empty = !hasHistory;

  root.innerHTML = `
    <div class="expanded">
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
      </div>
    </div>
  `;

  if (hasHistory) {
    const svg = root.querySelector<SVGSVGElement>('svg[data-role="chart"]');
    if (svg) {
      renderLine(
        svg,
        s.history.map((h) => ({ ts_utc: h.ts_utc, balance: h.balance })),
        { width: 320, height: 120, padding: 10 },
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


