# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Development (Tauri dev mode — starts Vite HMR + Rust backend)
npm run tauri dev

# Frontend-only dev (Vite HMR, no Rust backend)
npm run dev

# TypeScript type-check + production build
npm run build

# Frontend unit tests (vitest + jsdom)
npm test
npm run test:watch

# Rust tests (run from src-tauri/)
cd src-tauri && cargo test

# Rust build (release)
npm run tauri build
# Output: src-tauri/target/release/bundle/nsis/DeepSeekBar_*.exe
```

## Architecture

**Stack**: Tauri 2 desktop app — Rust backend (Tokio async) + vanilla TypeScript/Vite frontend. Windows-only, Chinese UI, no framework on the frontend.

### Process model

A single Tauri process with two layers communicating via Tauri's IPC bridge:

- **Rust backend** (`src-tauri/src/`): HTTP client (reqwest), SQLite (rusqlite bundled), keyring (Windows Credential Manager), system tray, tokio-based periodic refresh scheduler.
- **Web frontend** (`src/`): Zero-framework TypeScript with a Redux-like `reduce()` state machine. Renders directly into `#app` via `innerHTML` + event delegation.

### UI modes

The app has a single borderless, always-on-top window that switches between three modes by resizing itself:

| Mode | Size | Purpose |
|------|------|---------|
| `compact` | 180×56 | Narrow bar showing balance + status dot |
| `expanded` | 380×500 | Full view with 30-day SVG sparkline chart |
| `settings` | 420×620 | API key setup, preferences, theme picker |

The window close button hides to tray; only the tray "退出" menu item exits the process.

### State flow

**Frontend state** (`src/state.ts`): `UiState` is a plain object mutated only through `reduce(state, action)`. Actions are discriminated unions (`set_mode`, `balance_loaded`, `balance_error`, etc.). `main.ts` owns the single source of truth and passes it to render functions.

**Backend state** (`src-tauri/src/state.rs`): `AppState` wraps `Arc<RwLock<Cache>>` (balance + API key + last refresh timestamp) and `Arc<Mutex<()>>` for refresh serialization.

**Communication**:
- Frontend → Backend: `invoke()` calls to Tauri commands defined in `commands.rs`
- Backend → Frontend: `app.emit()` events (`balance:updated`, `balance:error`, `balance:alert`, `mode:changed`, `balance:manual_refresh`)

### Key storage (dual-write)

API keys are stored in two places for resilience:
1. Windows Credential Manager via the `keyring` crate (service: `com.deepseekbar.app`, user: `api_key`)
2. SQLite `app_state` table with base64 obfuscation (`b64:` prefix) as fallback

Both are written on save; on load, keyring is tried first, then SQLite fallback.

### Rust module map

| File | Role |
|------|------|
| `main.rs` | Binary entry point → calls `lib.rs` |
| `lib.rs` | `run()`: Tauri builder, setup hook (logging, DB init, scheduler spawn, tray), command registration, window-close-intercept |
| `commands.rs` | All 21 `#[tauri::command]` functions — the IPC surface |
| `deepseek.rs` | `fetch_balance()` → `GET /user/balance` with bearer auth, `parse_balance()` with `rust_decimal` |
| `scheduler.rs` | Periodic `tick()` (locked via `refresh_lock` mutex), balance alert threshold check, snapshot persistence |
| `store.rs` | SQLite schema (WAL mode), `snapshots` + `app_state` tables, keyring wrapper, backup to `LOCALAPPDATA` |
| `state.rs` | `AppState` — in-memory cache behind `RwLock` |
| `error.rs` | `AppError` enum with `From` impls for reqwest/rusqlite/serde/keyring, `classify_error()` → `ErrorKind` |
| `tray.rs` | System tray icon + menu (show/hide, refresh, privacy toggle, settings, quit) |

### Frontend module map

| File | Role |
|------|------|
| `main.ts` | Entry point: registers event listeners, drag handler, click delegation, initializes state machine |
| `state.ts` | `UiState` type, `initialState`, `Action` union, `reduce()` pure function |
| `types.ts` | Shared types: `Balance`, `Snapshot`, `WindowState`, `ErrorKind`, `UiMode` |
| `format.ts` | `toDecimal()`, `formatBalance()`, `formatDelta()` using `decimal.js-light` |
| `chart.ts` | `renderLine()` — pure SVG path generation (line + area fill), no chart library |
| `util.ts` | `escapeText()`, `escapeAttr()` — XSS-safe HTML escaping |
| `ui/compact.ts` | Renders the narrow bar (status dot, amount, delta) |
| `ui/expanded.ts` | Renders expanded view (chart, min/max, action buttons) |
| `ui/settings.ts` | Renders settings panel with event wiring; accepts `SettingsHandlers` callback interface |
| `ui/error.ts` | `describeKind()` — maps `ErrorKind` to Chinese user-facing messages |
| `styles.css` | All styles with CSS custom properties for theming (4 themes: deepseek, emerald, sunset, lavender) |

### Data persistence

- **SQLite path**: `%APPDATA%\com.deepseekbar.app\data.db` (WAL mode)
- **Backup path**: `%LOCALAPPDATA%\deepseekbar\data.db` (survives NSIS uninstall/reinstall)
- **Logs**: `%APPDATA%\com.deepseekbar.app\logs\deepseekbar-YYYY-MM-DD.log` (daily rotation via `tracing-appender`)
- **Schema**: `snapshots` table (ts_utc, balance as text, currency, is_stale) + `app_state` key-value table for all settings

### Important constraints

- **No frontend framework**: All rendering is `innerHTML` + event delegation on `#app`. Do not introduce React/Vue/etc.
- **No chart library**: The SVG sparkline in `chart.ts` is hand-drawn `<path>` elements. Keep it that way.
- **Chinese-only**: All UI strings are hardcoded in Chinese. No i18n.
- **Refresh serialization**: The scheduler uses `tokio::sync::Mutex` to ensure only one API call is in-flight at a time.
- **Window close = hide**: The `CloseRequested` event is intercepted and the window is hidden instead of destroyed.
- **Drag implementation**: Uses cached window position (physical coordinates) updated on mouseup to avoid async race conditions during mousemove.
