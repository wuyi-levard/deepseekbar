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
}

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
      <hr/>
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
  const status = root.querySelector<HTMLDivElement>('div[data-role="test-status"]')!;
  const close = root.querySelector<HTMLButtonElement>('button.close')!;

  // Restore autostart state from saved config
  if (s.autostartEnabled !== undefined) {
    autostart.checked = s.autostartEnabled;
  }

  testBtn.addEventListener("click", async () => {
    testBtn.disabled = true;
    status.textContent = "测试中…";
    const r = await h.onTest(keyInput.value);
    testBtn.disabled = false;
    if (r.ok) {
      status.textContent = `✓ 连接成功，预览余额 ¥ ${r.preview ?? "?"}`;
    } else {
      status.textContent = `✗ ${r.error ?? "测试失败"}`;
    }
  });

  saveBtn.addEventListener("click", async () => {
    if (!keyInput.value) return;
    saveBtn.disabled = true;
    try {
      await h.onSave(keyInput.value);
    } finally {
      saveBtn.disabled = false;
    }
  });

  autostart.addEventListener("change", () => h.onToggleAutostart(autostart.checked));
  const intervalSelect = root.querySelector<HTMLSelectElement>('select[data-role="interval"]')!;
  if (s.refreshInterval !== undefined) {
    intervalSelect.value = String(s.refreshInterval);
  }
  intervalSelect.addEventListener("change", () => h.onIntervalChange(Number(intervalSelect.value)));
  pinned.addEventListener("change", () => h.onTogglePinned(pinned.checked));
    function showConfirm() {
    const overlay = root.querySelector<HTMLDivElement>(".confirm-overlay")!;
    overlay.style.display = "flex";
  }
  function hideConfirm() {
    const overlay = root.querySelector<HTMLDivElement>(".confirm-overlay")!;
    overlay.style.display = "none";
  }
  resetBtn.addEventListener("click", showConfirm);
  root.querySelector<HTMLButtonElement>(".confirm-cancel")!.addEventListener("click", hideConfirm);
  root.querySelector<HTMLButtonElement>(".confirm-ok")!.addEventListener("click", () => {
    hideConfirm();
    h.onReset();
  });
  close.addEventListener("click", () => h.onClose());
}


