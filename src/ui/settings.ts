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
}

const THEMES = [
  { id: "deepseek", name: "深海蓝", colors: ["#4f8cff", "#1a1b2e"] },
  { id: "emerald", name: "翡翠绿", colors: ["#34d399", "#0f1a14"] },
  { id: "sunset", name: "日落橙", colors: ["#fb923c", "#1c1510"] },
  { id: "lavender", name: "薰衣草", colors: ["#a78bfa", "#171320"] },
];

export function renderSettings(
  root: HTMLElement,
  s: UiState,
  h: SettingsHandlers,
): void {
  root.innerHTML = `
    <div class="settings">
      <div class="row top">
        <span class="label">设置</span>
        <button class="close" aria-label="关闭">✕</button>
      </div>

      <label class="field">
        <span>API Key</span>
        <input type="password" data-role="key" autocomplete="off" spellcheck="false" />
        <button data-action="test">测试</button>
      </label>
      <div class="test-status" data-role="test-status">${escapeText(s.error?.message ?? "")}</div>

      <label class="check">
        <input type="checkbox" data-role="autostart" />
        <span>开机自启</span>
      </label>
      <label class="check">
        <input type="checkbox" data-role="pinned" ${s.pinned ? "checked" : ""} />
        <span>窗口置顶</span>
      </label>
      <label class="check">
        <input type="checkbox" data-role="privacy" ${s.privacyMode ? "checked" : ""} />
        <span>隐私模式</span>
      </label>

      <label class="field">
        <span>刷新间隔</span>
        <select data-role="interval">
          <option value="60">1 分钟</option>
          <option value="300" selected>5 分钟</option>
          <option value="900">15 分钟</option>
          <option value="1800">30 分钟</option>
          <option value="3600">1 小时</option>
        </select>
      </label>

      <label class="field">
        <span>余额预警</span>
        <input type="number" data-role="alert-threshold" min="0" step="0.01" placeholder="0=关闭" />
      </label>

      <label class="field">
        <span>主题</span>
        <div class="theme-picker" data-role="theme-picker">
          ${THEMES.map(t => `
            <label class="theme-opt ${s.theme === t.id ? "active" : ""}" data-theme="${t.id}">
              <span class="theme-dot" style="background:${t.colors[0]}"></span>
              ${t.name}
            </label>
          `).join("")}
        </div>
      </label>

      <div class="row actions">
        <button data-action="save" class="primary">保存</button>
      </div>
      <hr/>
      <div class="row actions">
        <button data-action="reset" class="danger">重置数据</button>
      </div>
      <div class="confirm-overlay" style="display:none">
        <div class="confirm-box">
          <p>确定要重置所有数据吗？</p>
          <p class="hint">这会删除 API key 和历史记录。</p>
          <div class="confirm-btns">
            <button class="confirm-cancel">取消</button>
            <button class="confirm-ok danger">确认重置</button>
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
    status.textContent = "测试中…";
    const r = await h.onTest(keyInput.value);
    testBtn.disabled = false;
    status.textContent = r.ok ? `✓ 连接成功，预览余额 ¥ ${r.preview ?? "?"}` : `✗ ${r.error ?? "测试失败"}`;
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
  alertInput.addEventListener("change", () => h.onAlertThreshold(alertInput.value || "0"));

  // Theme picker
  root.querySelectorAll<HTMLLabelElement>(".theme-opt").forEach(el => {
    el.addEventListener("click", () => {
      const t = el.dataset.theme!;
      root.querySelectorAll(".theme-opt").forEach(e => e.classList.remove("active"));
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
