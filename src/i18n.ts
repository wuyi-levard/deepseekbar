// src/i18n.ts — translatable strings. To add a language, add a new
// dictionary object and include it in LANGS + switchLang().

export type Lang = "zh" | "en";

export interface LangEntry {
  id: Lang;
  name: string;
}

export const LANGS: LangEntry[] = [
  { id: "zh", name: "中文" },
  { id: "en", name: "English" },
];

// ---------------------------------------------------------------------------
// Dictionaries
// ---------------------------------------------------------------------------
const zh = {
  // ---- compact bar ----
  compactAuth: "AUTH",
  compactEmpty: "——",

  // ---- expanded view ----
  expLabelBalance: "余额",
  expSynced: "已同步",
  expUnknown: "未知",
  expEmptyChart: "暂无趋势数据，下次刷新后将开始记录",
  expHigh: "高",
  expLow: "低",
  expBtnRefresh: "立即刷新",
  expBtnSettings: "设置",
  expBtnExport: "导出",

  // ---- time ago ----
  timeJustNow: "刚刚",
  timeMinAgo: (n: number) => `${n} 分钟前`,
  timeToday: "今天",

  // ---- settings ----
  setTitle: "设置",
  setApiKey: "API Key",
  setTest: "测试",
  setAutoStart: "开机自启",
  setPinned: "窗口置顶",
  setPrivacy: "隐私模式",
  setRefreshInterval: "刷新间隔",
  setAlertThreshold: "余额预警",
  setAlertPlaceholder: "留空=关闭预警",
  setTheme: "主题",
  setSave: "保存",
  setReset: "重置数据",
  setResetTitle: "确定要重置所有数据吗？",
  setResetHint: "这会删除 API key 和历史记录。",
  setResetCancel: "取消",
  setResetConfirm: "确认重置",
  setRecharge: "去充值 ↗",
  setTestTesting: "测试中…",
  setTestOK: (v: string) => `✓ 连接成功，预览余额 ¥ ${v}`,
  setTestFail: (e: string) => `✗ ${e}`,
  setTestEmpty: "请先填写 API key",

  // ---- interval options ----
  intv1m: "1 分钟",
  intv5m: "5 分钟",
  intv15m: "15 分钟",
  intv30m: "30 分钟",
  intv1h: "1 小时",

  // ---- themes ----
  themeDeepseek: "深海蓝",
  themeEmerald: "翡翠绿",
  themeSunset: "日落橙",
  themeLavender: "薰衣草",

  // ---- context menu ----
  ctxRefresh: "立即刷新",
  ctxExpand: "展开",
  ctxCollapse: "收起",
  ctxSettings: "设置…",
  ctxExport: "导出 CSV",

  // ---- errors ----
  errAuth: "API key 无效或已过期，请重新填写",
  errNetwork: "网络不通，请检查连接",
  errParse: "服务返回了无法识别的数据",
  errInternal: "本地错误，请尝试重置数据",

  // ---- notifications / alerts ----
  notifTitle: "DeepSeekBar 余额预警",
  msgKeyMissing: "密钥未存储，请在设置中重新保存 API key",
  msgInitFailed: (e: string) => `init failed: ${String(e)}`,

  // ---- export ----
  exporting: "导出中…",
  exportDone: "已导出 ✓",
  exportFail: "导出失败",
  exportNoData: "无数据",
  exportFileName: "deepseekbar",
  exportFilterName: "CSV 文件",
  exportCSVHeader: "时间,余额(元),货币",
  exportBtn: "导出",

  // ---- language ----
  langLabel: "语言",
};

const en: typeof zh = {
  compactAuth: "AUTH",
  compactEmpty: "——",

  expLabelBalance: "Balance",
  expSynced: "Synced",
  expUnknown: "Unknown",
  expEmptyChart: "No data yet. Chart will appear after the next refresh.",
  expHigh: "High",
  expLow: "Low",
  expBtnRefresh: "Refresh",
  expBtnSettings: "Settings",
  expBtnExport: "Export",

  timeJustNow: "just now",
  timeMinAgo: (n: number) => `${n} min ago`,
  timeToday: "Today",

  setTitle: "Settings",
  setApiKey: "API Key",
  setTest: "Test",
  setAutoStart: "Auto-start",
  setPinned: "Always on Top",
  setPrivacy: "Privacy Mode",
  setRefreshInterval: "Refresh Interval",
  setAlertThreshold: "Balance Alert",
  setAlertPlaceholder: "Empty = disable",
  setTheme: "Theme",
  setSave: "Save",
  setReset: "Reset Data",
  setResetTitle: "Reset all data?",
  setResetHint: "This will delete the API key and all history.",
  setResetCancel: "Cancel",
  setResetConfirm: "Confirm Reset",
  setRecharge: "Top Up ↗",
  setTestTesting: "Testing…",
  setTestOK: (v: string) => `✓ Connected. Balance: ¥ ${v}`,
  setTestFail: (e: string) => `✗ ${e}`,
  setTestEmpty: "Please enter an API key",

  intv1m: "1 min",
  intv5m: "5 min",
  intv15m: "15 min",
  intv30m: "30 min",
  intv1h: "1 hour",

  themeDeepseek: "Deep Blue",
  themeEmerald: "Emerald",
  themeSunset: "Sunset",
  themeLavender: "Lavender",

  ctxRefresh: "Refresh",
  ctxExpand: "Expand",
  ctxCollapse: "Collapse",
  ctxSettings: "Settings…",
  ctxExport: "Export CSV",

  errAuth: "API key is invalid or expired. Please re-enter it.",
  errNetwork: "Network unavailable. Check your connection.",
  errParse: "The server returned unrecognized data.",
  errInternal: "Local error. Try resetting data.",

  notifTitle: "DeepSeekBar Balance Alert",
  msgKeyMissing: "No API key stored. Please save one in Settings.",
  msgInitFailed: (e: string) => `init failed: ${String(e)}`,

  exporting: "Exporting…",
  exportDone: "Exported ✓",
  exportFail: "Export failed",
  exportNoData: "No data",
  exportFileName: "deepseekbar",
  exportFilterName: "CSV file",
  exportCSVHeader: "Time,Balance (¥),Currency",
  exportBtn: "Export",

  langLabel: "Language",
};

// ---------------------------------------------------------------------------
// Runtime language state
// ---------------------------------------------------------------------------
let cur: Lang =
  (typeof localStorage !== "undefined" && (localStorage.getItem("lang") as Lang)) || "zh";

/** Return the dictionary for the current language. */
export function t(): typeof zh {
  return cur === "en" ? en : zh;
}

export function lang(): Lang {
  return cur;
}

export function switchLang(l: Lang): void {
  cur = l;
  try { localStorage.setItem("lang", l); } catch { /* incognito */ }
}
