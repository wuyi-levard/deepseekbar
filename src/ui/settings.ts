import { invoke } from "@tauri-apps/api/core";
import { t, LANGS, switchLang, lang } from "../i18n";
import type { UiState } from "../state";
import { escapeText } from "../util";

export interface SettingsHandlers {
  onTest(key: string): Promise<{ ok: boolean; preview?: string; error?: string }>;
  onSave(key: string): Promise<void>;
  onToggleAutostart(enabled: boolean): Promise<void>;
  onTogglePinned(enabled: boolean): Promise<void>;
  onReset(): Promise<void>;
  onIntervalChange(secs: number): Promise<void>;
  onClose(): void;
  onAlertThreshold(threshold: string): Promise<void>;
  onPrivacyToggle(enabled: boolean): Promise<void>;
  onThemeChange(theme: string): Promise<void>;
  onLangChange(lang: string): Promise<void>;
  onCheckUpdate(): Promise<void>;
  onDownloadUpdate(): Promise<void>;
  onInstallUpdate(): Promise<void>;
}

const THEMES = [
  { id: "deepseek", name: () => t().themeDeepseek, colors: ["#4f8cff", "#1a1b2e"] },
  { id: "emerald", name: () => t().themeEmerald, colors: ["#34d399", "#0f1a14"] },
  { id: "sunset", name: () => t().themeSunset, colors: ["#fb923c", "#1c1510"] },
  { id: "lavender", name: () => t().themeLavender, colors: ["#a78bfa", "#171320"] },
];

export function renderSettings(
  root: HTMLElement,
  s: UiState,
  h: SettingsHandlers,
): void {
  const m = t();
  root.innerHTML = `
    <div class="settings">
      <div class="row top">
        <span class="label">${m.setTitle}</span>
        <button class="close" aria-label="关闭">✕</button>
      </div>

      <label class="field">
        <span>${m.setApiKey}</span>
        <input type="password" data-role="key" autocomplete="off" spellcheck="false" />
        <button data-action="test">${m.setTest}</button>
      </label>
      <div class="test-status" data-role="test-status">${escapeText(s.error?.message ?? "")}</div>

      <label class="check">
        <input type="checkbox" data-role="autostart" />
        <span>${m.setAutoStart}</span>
      </label>
      <label class="check">
        <input type="checkbox" data-role="pinned" ${s.pinned ? "checked" : ""} />
        <span>${m.setPinned}</span>
      </label>
      <label class="check">
        <input type="checkbox" data-role="privacy" ${s.privacyMode ? "checked" : ""} />
        <span>${m.setPrivacy}</span>
      </label>

      <label class="field">
        <span>${m.setRefreshInterval}</span>
        <select data-role="interval">
          <option value="60">${m.intv1m}</option>
          <option value="300" selected>${m.intv5m}</option>
          <option value="900">${m.intv15m}</option>
          <option value="1800">${m.intv30m}</option>
          <option value="3600">${m.intv1h}</option>
        </select>
      </label>

      <label class="field">
        <span>${m.setAlertThreshold}</span>
        <input type="number" data-role="alert-threshold" min="0" step="0.01" placeholder="${m.setAlertPlaceholder}" />
      </label>

      <div class="row actions">
        <button data-action="recharge">${m.setRecharge}</button>
      </div>

      <hr/>
      <div class="row actions">
        <button data-action="check-update" id="btn-update">${m.setCheckUpdate}</button>
      </div>
      <div class="update-status" data-role="update-status">
        <div class="update-bar" id="update-bar"><div class="update-bar-fill" id="update-bar-fill" style="width:${s.updateProgress}%"></div></div>
        <div class="update-msg" id="update-msg"></div>
      </div>

      <label class="field">
        <span>${m.langLabel}</span>
        <select data-role="lang">
          ${LANGS.map(l => `<option value="${l.id}" ${lang() === l.id ? "selected" : ""}>${l.name}</option>`).join("")}
        </select>
      </label>

      <label class="field">
        <span>${m.setTheme}</span>
        <div class="theme-picker" data-role="theme-picker">
          ${THEMES.map(t => `
            <button type="button" class="theme-swatch ${s.theme === t.id ? "active" : ""}" data-theme="${t.id}" title="${t.name()}">
              <span class="swatch-bar" style="background:${t.colors[0]}"></span>
              <span class="swatch-bg" style="background:${t.colors[1]}"></span>
            </button>
          `).join("")}
        </div>
      </label>

      <div class="row actions">
        <button data-action="save" class="primary">${m.setSave}</button>
      </div>
      <hr/>
      <div class="row actions">
        <button data-action="reset" class="danger">${m.setReset}</button>
      </div>
      <div class="confirm-overlay" style="display:none">
        <div class="confirm-box">
          <p>${m.setResetTitle}</p>
          <p class="hint">${m.setResetHint}</p>
          <div class="confirm-btns">
            <button class="confirm-cancel">${m.setResetCancel}</button>
            <button class="confirm-ok danger">${m.setResetConfirm}</button>
          </div>
        </div>
      </div>
    </div>
  `;

  const keyInput = root.querySelector<HTMLInputElement>('input[data-role="key"]')!;
  if (s.apiKey) keyInput.value = s.apiKey;
  const testBtn = root.querySelector<HTMLButtonElement>('button[data-action="test"]')!;
  const saveBtn = root.querySelector<HTMLButtonElement>('button[data-action="save"]')!;
  const resetBtn = root.querySelector<HTMLButtonElement>('button[data-action="reset"]')!;
  const autostart = root.querySelector<HTMLInputElement>('input[data-role="autostart"]')!;
  const pinned = root.querySelector<HTMLInputElement>('input[data-role="pinned"]')!;
  const privacy = root.querySelector<HTMLInputElement>('input[data-role="privacy"]')!;
  const status = root.querySelector<HTMLDivElement>('div[data-role="test-status"]')!;
  const close = root.querySelector<HTMLButtonElement>('button.close')!;

  if (s.autostartEnabled !== undefined) autostart.checked = s.autostartEnabled;

  const intervalSelect = root.querySelector<HTMLSelectElement>('select[data-role="interval"]')!;
  if (s.refreshInterval !== undefined) intervalSelect.value = String(s.refreshInterval);

  const alertInput = root.querySelector<HTMLInputElement>('input[data-role="alert-threshold"]')!;
  if (s.alertThreshold) alertInput.value = s.alertThreshold;

  // Event listeners
  testBtn.addEventListener("click", async () => {
    testBtn.disabled = true;
    status.textContent = t().setTestTesting;
    const r = await h.onTest(keyInput.value);
    testBtn.disabled = false;
    status.textContent = r.ok ? t().setTestOK(r.preview ?? "?") : t().setTestFail(r.error ?? t().setTestEmpty);
  });

  saveBtn.addEventListener("click", async () => {
    if (!keyInput.value) return;
    saveBtn.disabled = true;
    try { await h.onSave(keyInput.value); } finally { saveBtn.disabled = false; }
  });

  autostart.addEventListener("change", () => h.onToggleAutostart(autostart.checked));
  pinned.addEventListener("change", () => h.onTogglePinned(pinned.checked));
  privacy.addEventListener("change", () => h.onPrivacyToggle(privacy.checked));
  intervalSelect.addEventListener("change", () => h.onIntervalChange(Number(intervalSelect.value)));
  alertInput.addEventListener("change", () => h.onAlertThreshold(alertInput.value));

  // Language selector
  root.querySelector<HTMLSelectElement>('select[data-role="lang"]')!
    .addEventListener("change", async (e) => {
      const l = (e.target as HTMLSelectElement).value;
      switchLang(l as "zh" | "en");
      await h.onLangChange(l);
    });

  // Recharge button
  root.querySelector<HTMLButtonElement>('[data-action="recharge"]')!
    .addEventListener("click", async () => {
      await invoke("open_url", { url: "https://platform.deepseek.com/usage" });
    });

  // Update button with refreshUpdateUI
  (function wireUpdateUI() {
    const updateBtn = root.querySelector<HTMLButtonElement>('button[data-action="check-update"]')!;
    const updateMsg = root.querySelector<HTMLDivElement>("#update-msg")!;
    const updateBar = root.querySelector<HTMLDivElement>("#update-bar")!;
    const updateBarFill = root.querySelector<HTMLDivElement>("#update-bar-fill")!;
    const refresh = () => {
      if (s.updateStatus === "checking") {
        updateBtn.textContent = t().setUpdateChecking; updateBtn.disabled = true;
        updateBar.style.display = "none"; updateMsg.textContent = "";
      } else if (s.updateStatus === "available" && s.updateInfo) {
        updateBtn.textContent = t().setUpdateDownload(s.updateInfo.version);
        updateBtn.disabled = false; updateBar.style.display = "none";
        updateMsg.textContent = s.updateInfo.version;
      } else if (s.updateStatus === "downloading") {
        updateBtn.textContent = t().setUpdateDownloading(s.updateProgress);
        updateBtn.disabled = true; updateBar.style.display = "block";
        updateBarFill.style.width = s.updateProgress + "%"; updateMsg.textContent = "";
      } else if (s.updateStatus === "done") {
        updateBtn.textContent = t().setUpdateInstall; updateBtn.disabled = false;
        updateBar.style.display = "block"; updateBarFill.style.width = "100%";
        updateMsg.textContent = "";
      } else if (s.updateStatus === "error") {
        updateBtn.textContent = t().setCheckUpdate; updateBtn.disabled = false;
        updateBar.style.display = "none"; updateMsg.textContent = s.updateMessage;
      } else {
        updateBtn.textContent = t().setCheckUpdate; updateBtn.disabled = false;
        updateBar.style.display = "none"; updateMsg.textContent = "";
      }
    };
    refresh();
    updateBtn.addEventListener("click", async () => {
      const st = s.updateStatus;
      if (st === "idle" || st === "error") {
        await h.onCheckUpdate();
        // refresh is called by render() re-invocation
      } else if (st === "available") {
        h.onDownloadUpdate!();
      } else if (st === "done") {
        await h.onInstallUpdate();
      }
    });
    // Expose refresh for re-call after render
    (window as any).__refreshUpdateUI = refresh;
  })();

  // Theme picker
  root.querySelectorAll<HTMLButtonElement>(".theme-swatch").forEach(el => {
    el.addEventListener("click", () => {
      const t = el.dataset.theme!;
      root.querySelectorAll(".theme-swatch").forEach(e => e.classList.remove("active"));
      el.classList.add("active");
      h.onThemeChange(t);
    });
  });

  // Confirm dialog
  const overlay = root.querySelector<HTMLDivElement>(".confirm-overlay")!;
  resetBtn.addEventListener("click", () => { overlay.style.display = "flex"; });
  root.querySelector(".confirm-cancel")!.addEventListener("click", () => { overlay.style.display = "none"; });
  root.querySelector(".confirm-ok")!.addEventListener("click", () => { overlay.style.display = "none"; h.onReset(); });
  close.addEventListener("click", () => h.onClose());
}
