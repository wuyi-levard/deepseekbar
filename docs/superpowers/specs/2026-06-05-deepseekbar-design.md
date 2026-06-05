# DeepSeekBar 设计规格

**状态**: 草案 v1
**日期**: 2026-06-05
**目标平台**: Windows 10 1809+ / Windows 11

## 1. 目标

`deepseekbar` 是一个常驻 Windows 桌面的悬浮小组件，主要功能是**展示 DeepSeek 账户余额和近 30 天余额变化趋势**。它结合桌面悬浮窗与系统托盘两种形态：

- 默认开机自启并显示一个紧凑的窄条。
- 通过系统托盘菜单控制窗口显隐、立即刷新、设置、退出。

### 1.1 范围

**v1 在范围内**：

- 单 DeepSeek 账户。
- 通过 DeepSeek 官方 `GET /user/balance` 接口拉取余额。
- 余额以人民币元显示，含 30 天趋势折线。
- 启动时引导填 API key，key 加密落盘。
- 系统托盘 + 单一无边框悬浮窗（带 compact / expanded 两种显示态）。
- 开机自启可开关。

**v1 不做（YAGNI）**：

- 今日 API 调用量 / token 消耗统计（DeepSeek 官方未提供公开接口）。
- 多账户切换。
- 国际化（文案写死中文）。
- 自动更新（用户手动下载新版本）。
- 代码签名（Windows SmartScreen 提示由用户放行）。
- 导出历史 / 通知提醒 / 主题切换。

## 2. 技术栈

- **应用框架**: Tauri 2（Rust 后端 + Web 前端）。
- **前端**: 原生 TypeScript + Vite，零框架。
- **图表**: 自绘 SVG sparkline + 折线，零依赖。
- **存储**: SQLite（`rusqlite`，bundle 模式）。
- **HTTP**: `reqwest`（rustls，禁用 native-tls）。
- **异步运行时**: `tokio`。
- **日志**: `tracing` + `tracing-appender`。
- **API key 存储**: `keyring` crate（Windows Credential Manager，账户名 `com.deepseekbar.app`，条目 `api_key`）。
- **非敏感配置**（窗口位置、模式、autostart 开关）：SQLite `app_state` 表。
- **自启**: `tauri-plugin-autostart`。
- **精度**: `rust_decimal`（余额解析） + 前端 `decimal.js-light`。

## 3. 架构

### 3.1 进程与模块

单个 Tauri 应用进程，分两层：

**Rust 后端**（`src-tauri/src/`）：

| 模块 | 职责 |
|---|---|
| `main.rs` | 入口、`setup()` 钩子、注册窗口 / 托盘 / 命令 / 事件 |
| `state.rs` | `AppState`（`Arc<RwLock<...>>`）：内存余额缓存、API key 状态、scheduler handle |
| `deepseek.rs` | DeepSeek API 客户端（`fetch_balance()` + 错误分类） |
| `store.rs` | SQLite 封装（schema、写入、清理、读历史）+ keyring 包装（API key 读/写） |
| `scheduler.rs` | tokio 定时任务：每 5 分钟一次拉取 + 手动触发串行化 |
| `tray.rs` | 系统托盘菜单（显示/隐藏 / 刷新 / 设置 / 退出） |
| `commands.rs` | Tauri command 函数集合（前端调用入口） |
| `error.rs` | `AppError` + `classify_error()` |

**Web 前端**（`src/`）：

| 文件 | 职责 |
|---|---|
| `main.ts` | 入口、注册 Tauri 事件监听、初始化状态机 |
| `state.ts` | 前端状态机（`mode: 'compact' \| 'expanded' \| 'settings'`） |
| `ui/compact.ts` | 窄条视图渲染 |
| `ui/expanded.ts` | 展开视图渲染（含折线） |
| `ui/settings.ts` | 设置面板（key 输入、测试、保存、自启开关、重置） |
| `ui/error.ts` | 错误 banner / 状态点着色 |
| `chart.ts` | 自绘 SVG 折线（30 天趋势） |
| `format.ts` | 数字格式化（`Decimal` 包装，固定 2 位） |
| `styles.css` | 全部样式 |

### 3.2 窗口

- **单 Tauri Webview 窗口**，无原生装饰（`decorations: false`），默认 `always_on_top: true`。
- 关闭按钮 = 隐藏到托盘，**不**退出进程。仅托盘菜单的"退出"才真正退出。
- 位置 / 模式 / 尺寸由前端控制，记忆到 `app_state` 表。
- `dpiAwareness: "PerMonitorV2"`。

### 3.3 系统托盘

- 托盘图标常驻。
- 菜单：显示 / 隐藏窗口 · 立即刷新 · ─── · 设置… · ─── · 退出。
- 点击托盘图标：若窗口隐藏则显示，若可见则隐藏。

## 4. Tauri 接口

### 4.1 Commands（前端 → 后端）

| 命令 | 入参 | 出参 | 说明 |
|---|---|---|---|
| `get_api_key_status` | — | `{ configured: boolean }` | 用于首启动判断 |
| `save_api_key` | `key: string` | `Result<()>` | 加密落盘 + 触发一次拉取 |
| `delete_api_key` | — | `Result<()>` | 清掉 key，scheduler 停 |
| `get_current_balance` | — | `Result<Balance \| null>` | 读内存缓存，可能为 null（未拉过） |
| `trigger_refresh` | — | `Result<()>` | 手动刷新，异步执行 |
| `get_history` | `days: u32` | `Vec<Snapshot>` | 默认 30 |
| `get_window_state` | — | `{ position, mode, pinned }` | 启动时恢复窗口用 |
| `save_window_state` | `state: WindowState` | `Result<()>` | 拖动 / 模式切换时调 |
| `set_autostart` | `enabled: boolean` | `Result<()>` | 改 `tauri-plugin-autostart` 开关 |

### 4.2 Events（后端 → 前端）

| 事件 | 负载 | 触发时机 |
|---|---|---|
| `balance:updated` | `Balance` | 拉取成功、缓存更新 |
| `balance:error` | `{ kind: 'auth' \| 'network' \| 'parse' \| 'internal', message: string }` | 拉取失败 |
| `history:appended` | `Snapshot` | 写入新快照时 |
| `mode:changed` | `{ mode }` | 外部（托盘菜单）触发模式切换 |

### 4.3 数据结构

```rust
struct Balance {
    currency: String,    // "CNY"
    total: String,       // Decimal-as-string
    granted: String,     // 充值
    topped_up: String,   // 累计充值
    available: String,   // 可用余额
}

struct Snapshot {
    ts_utc: i64,         // unix ms
    balance: String,     // 可用余额，Decimal-as-string
    currency: String,
    is_stale: bool,
}

struct WindowState {
    position: { x: i32, y: i32 } | null,
    mode: 'compact' | 'expanded' | 'settings',
    pinned: bool,
}
```

## 5. 数据流与存储

### 5.1 单次刷新流程

```
[scheduler tick]  OR  [trigger_refresh command]
        │
        ▼
   load API key from store
        │
        ▼
   GET https://api.deepseek.com/user/balance
   Header: Authorization: Bearer <key>
        │
   ┌────┴────┐
   │         │
 200        401 / 5xx / timeout / parse fail
   │         │
   ▼         ▼
 parse    classify_error()
   │         │
   ▼         ▼
write    emit balance:error
snapshot  (不写快照)
   │
   ▼
update in-memory cache (Arc<RwLock<...>>)
   │
   ▼
emit balance:updated      ──► 前端更新数字
emit history:appended     ──► 前端追加到折线
```

- 用 `tokio::sync::Mutex` 串行化：一次只跑一个请求，重复触发时后者 await 前者。
- **任何错误都不写快照**——快照只反映"成功"状态。

### 5.2 SQLite Schema

文件路径：`%APPDATA%\com.deepseekbar.app\data.db`

```sql
CREATE TABLE snapshots (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  ts_utc    INTEGER NOT NULL,
  balance   TEXT    NOT NULL,                    -- Decimal-as-string
  currency  TEXT    NOT NULL DEFAULT 'CNY',
  is_stale  INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_snapshots_ts ON snapshots(ts_utc);

CREATE TABLE app_state (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
-- 存：window_position、window_mode、pinned、last_refresh_ts
```

- 启动时清理：`DELETE FROM snapshots WHERE ts_utc < strftime('%s','now','-30 days') * 1000`。
- 单账户 30 天 ≈ 8640 行，体积 < 1 MB。
- **余额用 `TEXT` 存**避免浮点精度丢失；Rust 侧用 `rust_decimal::Decimal` 解析。

### 5.3 API key 存储

- 用 `keyring` crate 写入 Windows Credential Manager。
  - 服务名：`com.deepseekbar.app`
  - 账户名：`api_key`
  - 值：DeepSeek API key 明文（Credential Manager 自身用 DPAPI 加密）。
- 优点：key 不落磁盘，进程退出后 Windows 锁屏/重启仍可读；用 `tauri-plugin-store` 自带的 AES 加密 key 嵌入二进制可被反编译，不安全。
- 读取时机：scheduler tick 触发时 + 启动时 warm up 一次到内存缓存。
- 失败处理：Credential Manager 读失败 → 等同 `auth` 错误（key 不存在或被系统清空）。

### 5.4 目录布局

```
%APPDATA%\com.deepseekbar.app\
  ├─ data.db            # SQLite（snapshots + app_state）
  └─ logs\
     └─ deepseekbar-YYYY-MM-DD.log   # 滚动日志
```

（API key 不在磁盘上，存于 Windows Credential Manager。）

## 6. 错误处理

### 6.1 错误分类

| Kind | 触发 | UI 反应 | 写快照？ |
|---|---|---|---|
| `auth` | HTTP 401/403，HTTP 200 但 body 缺字段 | 状态点红 + 数字位 `AUTH` + 悬浮"请检查 API key"；点击展开设置面板 | 否 |
| `network` | timeout（>10s）/ connect refused / DNS 失败 / 5xx | 状态点红 + 数字位 `——`；compact 悬浮显示原因；expanded 顶部红色 banner | 否 |
| `parse` | HTTP 200 但 JSON 字段缺失或类型错 | 同 `network` + 日志记录原始 body | 否 |
| `internal` | SQLite 打开失败、key 读不出来 | 状态点灰 + 数字位 `OFFLINE`；设置面板显示"重置数据"按钮 | 否 |

### 6.2 边界场景

1. **首次启动无 key**：scheduler 检测到 key 不存在 → 不发任何事件 → 前端 `get_api_key_status()` 返回 false → 切到 settings 模式。
2. **运行中 key 损坏/被删**：scheduler 读不到 → emit `balance:error{kind: "auth", message: "key missing"}` → 前端自动切到 settings 模式。
3. **运行中断网**：保留上一次成功的余额数字，状态点变红，数字位 `——`；网络恢复后下次 tick 自动恢复绿色。
4. **手动刷新与 tick 重叠**：tokio Mutex 串行化，后者 await 前者。
5. **系统时间回退**：检测 `ts_utc < last_ts` → 跳过该快照，log warning。
6. **SQLite 文件损坏**：启动时打开失败 → emit `balance:error{kind: "internal", message: "数据库损坏"}` → 程序继续运行但不再写盘，用户通过"重置数据"修复。
7. **Tauri 主进程 panic**：进程退出，Windows 杀掉窗口和托盘；**不**做 watchdog。
8. **多显示器 / DPI**：位置用逻辑像素存储；启动时校验保存的位置是否在当前任意显示器可见区域内，不可见则回退到默认（主屏右上角，距边缘 24px）。
9. **WebView2 缺失**：安装器自动引导下载（NSIS 的 `WebView2Loader`）。

### 6.3 重试与日志

- 一次 tick 失败 → 等下一个 tick（5 分钟后）。**不**做指数退避。
- `reqwest` 超时：connect 5s + total 10s。
- 日志：`tracing` 滚动文件，路径 `logs\deepseekbar-YYYY-MM-DD.log`，保留 7 天，仅 WARN/ERROR 级别。

### 6.4 重置

- 设置面板底部"重置数据"按钮（二次确认）：删 `data.db` + 删 Credential Manager 中的 `com.deepseekbar.app/api_key` 条目 + 退出进程。

## 7. UI 规格

### 7.1 窗口状态机

```
                ┌──────────┐
                │  hidden  │  (只在托盘)
                └────┬─────┘
            托盘"显示"│ │关闭按钮 / 托盘"隐藏"
                     ▼ ▲
                ┌──────────┐
           ┌───►│ compact  │◄──── 默认
           │    │ 220 × 60 │
           │    └────┬─────┘
   双击 / 滚轮│         │右键"展开" / 点击
   "展开"    │         ▼
           │    ┌──────────┐
           └────┤ expanded │
                │ 360 × 320│
                └──────────┘
                      │
                      │ 检测到无 key / key 错误
                      ▼
                ┌──────────┐
                │ settings │
                │ 360 × 320│
                └──────────┘
```

### 7.2 Compact（220 × 60）

```
┌──────────────────────────────────────┐
│  ●  ¥ 12.34                ⌃ 0.12   │
└──────────────────────────────────────┘
   │     │                │
   │     │                └─ 相对上次变化（涨绿/跌红，±0.00 灰）
   │     └─ 余额数字（最大字号）
   └─ 状态点：绿=正常 / 黄=脉冲中 / 红=错误
```

交互：

- 拖动：按住顶部 6px 区域。
- 双击：进入 expanded。
- 滚轮：切换 compact ↔ expanded。
- 右键：上下文菜单。

### 7.3 Expanded（360 × 320）

```
┌──────────────────────────────────────┐
│  余额  ¥ 12.34                  ✕   │
│  ─────────────────────────────       │
│                                      │
│        [ 30 天趋势折线 ]             │
│                                      │
│  高 25.00   低 0.00                  │
│  ●  下次刷新 02:13                   │
│  [ 立即刷新 ]  [ 设置 ]              │
└──────────────────────────────────────┘
```

**空历史状态**：当 `get_history(30)` 返回空数组时，趋势区域显示居中文案「暂无趋势数据，下次刷新后将开始记录」，高/低行隐藏。`history:appended` 事件触发后自动切换到正常视图。

### 7.4 Settings（360 × 320，与 expanded 等高）

```
┌──────────────────────────────────────┐
│  设置                            ✕   │
│  ─────────────────────────────       │
│                                      │
│  API Key                             │
│  [ ************************ ] [测试] │
│  状态: ✓ 连接成功，预览余额 ¥12.34   │
│                                      │
│  [x] 开机自启                        │
│  [ ] 窗口置顶                        │
│                                      │
│  [ 保存 ]                            │
│  ─────────────────────────────       │
│  [ 重置数据 ]                        │
└──────────────────────────────────────┘
```

### 7.5 上下文菜单（compact / expanded 共用）

- 立即刷新
- 展开 / 收起
- ───
- 开机自启（勾选）
- 窗口置顶（勾选）
- ───
- 设置…
- ───
- 退出

### 7.6 错误视觉

| 状态 | 状态点 | 数字位 |
|---|---|---|
| 正常 | 绿 | 余额 |
| 正在刷新 | 黄脉冲 | 余额 |
| 网络错误 | 红 | `——` |
| 认证错误 | 红 | `AUTH` |
| 内部错误 | 灰 | `OFFLINE` |

## 8. 打包与分发

### 8.1 构建

- `cargo tauri build` 产 NSIS `.exe` 安装包（默认）和 `.msi`（可选）。
- Rust release profile：`lto = true`、`codegen-units = 1`、`strip = true`、`opt-level = "s"`。
- 体积目标：< 10 MB（WebView2 由系统提供，不打包）。

### 8.2 安装器

- 安装到 `C:\Program Files\DeepSeekBar\`。
- NSIS 提供"开机自启"勾选（写 `HKCU\...\Run` 注册表项）—— 仅首次安装时，安装后由应用内开关接管。
- 卸载时清注册表项 + 提示用户是否删除 `appDataDir`。

### 8.3 WebView2

- 目标系统：Win10 1809+ / Win11。
- 检测 WebView2 Runtime：未装则 NSIS 自动下载引导。

### 8.4 不做的

- 代码签名（v1 EV 证书成本高，SmartScreen 提示由用户放行）。
- 自动更新（手动下载新版本安装）。

## 9. 测试

### 9.1 自动化（Rust 单元 + 集成测试）

1. **API 客户端**：用 `wiremock` 模拟 `/user/balance` 的 200/401/500/超时/缺字段，验证 `parse_balance()` 和 `classify_error()`。
2. **Store**：用内存 SQLite 跑 schema 迁移、写入、30 天清理。
3. **Scheduler**：用 `tokio::time::pause()` 验证 tick 间隔、串行化、错误时不写快照。
4. **Commands**：用 mock 状态调用 command 函数，验证返回值和 emit 事件。

### 9.2 前端测试

- 状态机：compact ↔ expanded ↔ settings 切换的纯函数测试（Vitest）。
- 数字格式化：`Decimal` 边界（0、负数、超大数、NaN 输入）。
- **不做** E2E 浏览器测试。

### 9.3 手工 QA 清单（写进 README）

- [ ] 首启动 → 引导填 key → 显示余额
- [ ] 断网 → 状态点红 + 数字位 `——`
- [ ] 重连 → 状态点自动恢复绿
- [ ] 重启电脑 → 自启 + 立即显示
- [ ] 右键菜单 / 托盘菜单各项生效
- [ ] 拖动窗口 → 位置记忆
- [ ] 改 key → 旧 key 失效 → 引导重新填
- [ ] 卸载 → 数据目录可被清理

## 10. 目录结构

```
D:\deepseekbar\
├─ src-tauri\
│  ├─ src\
│  │  ├─ main.rs
│  │  ├─ commands.rs
│  │  ├─ deepseek.rs
│  │  ├─ store.rs
│  │  ├─ scheduler.rs
│  │  ├─ tray.rs
│  │  ├─ state.rs
│  │  └─ error.rs
│  ├─ Cargo.toml
│  ├─ tauri.conf.json
│  └─ build.rs
├─ src\
│  ├─ main.ts
│  ├─ state.ts
│  ├─ ui\{compact,expanded,settings,error}.ts
│  ├─ chart.ts
│  ├─ format.ts
│  └─ styles.css
├─ index.html
├─ package.json
├─ vite.config.ts
├─ tsconfig.json
└─ docs\
   └─ superpowers\
      └─ specs\
         └─ 2026-06-05-deepseekbar-design.md
```

## 11. 风险与未决项

| 项 | 状态 | 后续 |
|---|---|---|
| DeepSeek 接口稳定性 | 接口官方文档稳定 | 若变更需重新实现 `deepseek.rs` |
| WebView2 在低版本 Win10 上的渲染差异 | 仅在 1809+ | 安装器检测并引导升级 |
| 长时间断网（>30 天） | 30 天清理触发，趋势折线会空白 | 网络恢复后自动填充 |
| 多账户 | v1 不做 | UI 留扩展位（左上角账户切换器预留） |
| 余额变化小数的趋势折线精度 | 用 `Decimal` 字符串比对 | 测试覆盖精度边界 |
