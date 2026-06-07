import { formatBalance, formatDelta } from "../format";
import { t } from "../i18n";
import { escapeAttr, escapeText } from "../util";
import type { UiState } from "../state";

export function renderCompact(root: HTMLElement, s: UiState): void {
  const hasAlert = !!s.alertMessage;
  const status =
    hasAlert ? "warn" :
    s.refreshing ? "pulse" :
    s.error ? (s.error.kind === "auth" ? "err-auth" : "err") :
    s.balance ? "ok" : "init";

  let display: string;
  if (s.privacyMode) display = "●●●";
  else if (s.error?.kind === "auth") display = t().compactAuth;
  else if (s.error) display = t().compactEmpty;
  else if (s.balance) display = `¥ ${formatBalance(s.balance.available)}`;
  else display = t().compactEmpty;

  const delta = s.balance && s.prevAvailable
    ? formatDelta(s.prevAvailable, s.balance.available)
    : "";

  const tooltip = hasAlert ? s.alertMessage! : (s.error?.message ?? "");

  root.innerHTML = `
    <div class="compact" data-status="${status}" title="${escapeAttr(tooltip)}">
      <span class="dot" aria-hidden="true"></span>
      <span class="amount">${escapeText(display)}</span>
      ${hasAlert ? `<span class="alert-badge">⚠</span>` : ""}
      <span class="delta">${escapeText(delta)}</span>
    </div>
  `;
}


