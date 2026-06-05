import { formatBalance, formatDelta } from "../format";
import type { UiState } from "../state";

export function renderCompact(root: HTMLElement, s: UiState): void {
  const status =
    s.refreshing ? "pulse" :
    s.error ? (s.error.kind === "auth" ? "err-auth" : "err") :
    s.balance ? "ok" : "init";

  let display: string;
  if (s.error?.kind === "auth") display = "AUTH";
  else if (s.error && s.error.kind !== "auth") display = "——";
  else if (s.balance) display = `¥ ${formatBalance(s.balance.available)}`;
  else display = "——";

  const delta = s.balance && s.prevAvailable
    ? formatDelta(s.prevAvailable, s.balance.available)
    : "";

  const tooltip = s.error?.message ?? "";

  root.innerHTML = `
    <div class="compact" data-status="${status}" title="${escapeAttr(tooltip)}">
      <span class="dot" aria-hidden="true"></span>
      <span class="amount">${escapeText(display)}</span>
      <span class="delta">${escapeText(delta)}</span>
    </div>
  `;
}

function escapeText(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
function escapeAttr(s: string): string {
  return escapeText(s).replace(/"/g, "&quot;");
}
