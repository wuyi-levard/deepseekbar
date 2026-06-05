import type { UiState } from "../state";

export interface SettingsHandlers {
  onTest(key: string): Promise<{ ok: boolean; preview?: string; error?: string }>;
  onSave(key: string): Promise<void>;
  onToggleAutostart(enabled: boolean): Promise<void>;
  onTogglePinned(enabled: boolean): Promise<void>;
  onReset(): Promise<void>;
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
    </div>
  `;

  const keyInput = root.querySelector<HTMLInputElement>('input[data-role="key"]')!;
  const testBtn = root.querySelector<HTMLButtonElement>('button[data-action="test"]')!;
  const saveBtn = root.querySelector<HTMLButtonElement>('button[data-action="save"]')!;
  const resetBtn = root.querySelector<HTMLButtonElement>('button[data-action="reset"]')!;
  const autostart = root.querySelector<HTMLInputElement>('input[data-role="autostart"]')!;
  const pinned = root.querySelector<HTMLInputElement>('input[data-role="pinned"]')!;
  const status = root.querySelector<HTMLDivElement>('div[data-role="test-status"]')!;
  const close = root.querySelector<HTMLButtonElement>('button.close')!;

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
  pinned.addEventListener("change", () => h.onTogglePinned(pinned.checked));
  resetBtn.addEventListener("click", () => {
    if (confirm("确定要重置所有数据吗？这会删除 API key 和历史。")) h.onReset();
  });
  close.addEventListener("click", () => h.onClose());
}

function escapeText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
