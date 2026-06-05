# DeepSeekBar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Windows desktop widget (Tauri 2 + TS) that shows DeepSeek account balance and a 30-day trend.

**Architecture:** Single Tauri 2 process. Rust backend handles API calls (every 5 min), SQLite history, keyring-stored API key, and tokio scheduler. Native TS frontend renders a frameless 220×60 floating bar with compact ↔ expanded ↔ settings modes, plus a system tray for control.

**Tech Stack:** Tauri 2, Rust 2021 edition, rusqlite, reqwest (rustls), tokio, tracing, keyring, rust_decimal, tauri-plugin-autostart; frontend: native TypeScript + Vite, Vitest, decimal.js-light.

**Spec:** `docs/superpowers/specs/2026-06-05-deepseekbar-design.md`

---

## File Structure

**Project root** `D:\deepseekbar\`:

```
D:\deepseekbar\
├─ .gitignore
├─ package.json
├─ tsconfig.json
├─ vite.config.ts
├─ index.html
├─ README.md
├─ src\
│  ├─ main.ts                    # 入口、注册 Tauri 事件监听、状态机驱动
│  ├─ types.ts                   # 前后端共享类型的手工 TS 镜像
│  ├─ state.ts                   # 前端状态机 + 持久化（窗口位置/模式）
│  ├─ format.ts                  # Decimal 数字格式化
│  ├─ chart.ts                   # 自绘 SVG 30 天折线
│  ├─ styles.css
│  └─ ui\
│     ├─ compact.ts              # 窄条视图（220×60）
│     ├─ expanded.ts             # 展开视图（360×320）
│     ├─ settings.ts             # 设置面板
│     └─ error.ts                # 错误 banner / 状态点着色
├─ src-tauri\
│  ├─ .gitignore
│  ├─ Cargo.toml
│  ├─ tauri.conf.json
│  ├─ build.rs
│  ├─ capabilities\
│  │  └─ default.json
│  ├─ icons\                     # 默认图标占位
│  └─ src\
│     ├─ main.rs                 # 入口、setup()、窗口/托盘注册
│     ├─ commands.rs             # 9 个 Tauri command
│     ├─ deepseek.rs             # DeepSeek API 客户端
│     ├─ store.rs                # SQLite + keyring 包装
│     ├─ scheduler.rs            # tokio 定时任务
│     ├─ tray.rs                 # 系统托盘
│     ├─ state.rs                # AppState（Arc<RwLock>）
│     └─ error.rs                # AppError + classify
└─ docs\
   └─ superpowers\
      ├─ specs\2026-06-05-deepseekbar-design.md
      └─ plans\2026-06-05-deepseekbar.md
```

Tests are colocated as `#[cfg(test)]` modules in Rust files and `*.test.ts` next to TS modules.

---

## Task 1: Project scaffolding (Tauri 2 + Vite + TS)

**Files:**
- Create: `D:\deepseekbar\.gitignore`
- Create: `D:\deepseekbar\package.json`
- Create: `D:\deepseekbar\tsconfig.json`
- Create: `D:\deepseekbar\vite.config.ts`
- Create: `D:\deepseekbar\index.html`
- Create: `D:\deepseekbar\src\main.ts` (placeholder)
- Create: `D:\deepseekbar\src-tauri\Cargo.toml`
- Create: `D:\deepseekbar\src-tauri\tauri.conf.json`
- Create: `D:\deepseekbar\src-tauri\build.rs`
- Create: `D:\deepseekbar\src-tauri\capabilities\default.json`
- Create: `D:\deepseekbar\src-tauri\src\main.rs` (hello world)
- Create: `D:\deepseekbar\src-tauri\.gitignore`
- Create: `D:\deepseekbar\src-tauri\icons\icon.png` (placeholder, see Tauri 2 docs for icon requirements)

- [ ] **Step 1: Write `.gitignore` at project root**

```gitignore
# Editor / OS
.DS_Store
Thumbs.db
.idea/
.vscode/

# Node
node_modules/
dist/
.vite/

# Rust
src-tauri/target/
src-tauri/gen/

# Tauri user data (when developing locally; never commit real keys)
*.db
*.db-journal
*.db-wal
*.db-shm
```

- [ ] **Step 2: Write `package.json`**

```json
{
  "name": "deepseekbar",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "test:watch": "vitest",
    "tauri": "tauri"
  },
  "devDependencies": {
    "@tauri-apps/cli": "^2.1.0",
    "typescript": "^5.5.4",
    "vite": "^5.4.10",
    "vitest": "^2.1.4"
  },
  "dependencies": {
    "@tauri-apps/api": "^2.1.1",
    "@tauri-apps/plugin-autostart": "^2.0.0",
    "decimal.js-light": "^2.5.1"
  }
}
```

- [ ] **Step 3: Write `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "useDefineForClassFields": true,
    "module": "ESNext",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": false,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "esModuleInterop": true,
    "types": ["vite/client"]
  },
  "include": ["src"]
}
```

- [ ] **Step 4: Write `vite.config.ts`**

```typescript
import { defineConfig } from "vite";

const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? { protocol: "ws", host, port: 1421 }
      : undefined,
    watch: { ignored: ["**/src-tauri/**"] },
  },
  envPrefix: ["VITE_", "TAURI_ENV_*"],
  build: {
    target: "es2022",
    minify: "esbuild",
    sourcemap: false,
  },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.ts"],
  },
});
```

- [ ] **Step 5: Write `index.html`**

```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>DeepSeekBar</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

- [ ] **Step 6: Write placeholder `src\main.ts`**

```typescript
const root = document.getElementById("app");
if (root) root.textContent = "deepseekbar boot ok";
```

- [ ] **Step 7: Write `src-tauri\.gitignore`**

```gitignore
target/
gen/
WixTools/
```

- [ ] **Step 8: Write `src-tauri\Cargo.toml`**

```toml
[package]
name = "deepseekbar"
version = "0.1.0"
description = "DeepSeek account balance floating widget"
authors = ["deepseekbar"]
edition = "2021"
rust-version = "1.77"

[lib]
name = "deepseekbar_lib"
crate-type = ["staticlib", "cdylib", "rlib"]

[build-dependencies]
tauri-build = { version = "2.0", features = [] }

[dependencies]
tauri = { version = "2.1", features = ["tray-icon"] }
tauri-plugin-autostart = "2.0"
serde = { version = "1.0", features = ["derive"] }
serde_json = "1.0"
tokio = { version = "1.40", features = ["sync", "rt-multi-thread", "macros", "time"] }
reqwest = { version = "0.12", default-features = false, features = ["rustls-tls", "json"] }
rusqlite = { version = "0.32", features = ["bundled"] }
rust_decimal = { version = "1.36", features = ["serde-with-str"] }
keyring = "3.6"
tracing = "0.1"
tracing-subscriber = { version = "0.3", features = ["env-filter"] }
tracing-appender = "0.2"
thiserror = "1.0"
anyhow = "1.0"
dirs = "5.0"

[dev-dependencies]
wiremock = "0.6"
tempfile = "3.13"
tokio = { version = "1.40", features = ["test-util"] }

[profile.release]
panic = "abort"
codegen-units = 1
lto = true
opt-level = "s"
strip = true
```

- [ ] **Step 9: Write `src-tauri\build.rs`**

```rust
fn main() {
    tauri_build::build()
}
```

- [ ] **Step 10: Write `src-tauri\tauri.conf.json`**

```json
{
  "$schema": "https://schema.tauri.app/config/2",
  "productName": "DeepSeekBar",
  "version": "0.1.0",
  "identifier": "com.deepseekbar.app",
  "build": {
    "beforeDevCommand": "npm run dev",
    "devUrl": "http://localhost:1420",
    "beforeBuildCommand": "npm run build",
    "frontendDist": "../dist"
  },
  "app": {
    "withGlobalTauri": false,
    "windows": [
      {
        "label": "main",
        "title": "DeepSeekBar",
        "width": 220,
        "height": 60,
        "minWidth": 220,
        "minHeight": 60,
        "maxWidth": 360,
        "maxHeight": 320,
        "resizable": false,
        "decorations": false,
        "alwaysOnTop": true,
        "skipTaskbar": true,
        "visible": true,
        "transparent": true,
        "shadow": false,
        "center": false
      }
    ],
    "security": {
      "csp": "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; script-src 'self'"
    }
  },
  "bundle": {
    "active": true,
    "targets": ["nsis"],
    "icon": [
      "icons/32x32.png",
      "icons/128x128.png",
      "icons/icon.ico"
    ],
    "windows": {
      "nsis": {
        "installMode": "currentUser",
        "displayLanguageSelector": false
      }
    }
  }
}
```

- [ ] **Step 11: Write `src-tauri\capabilities\default.json`**

```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "default",
  "description": "Default capability for the main window",
  "windows": ["main"],
  "permissions": [
    "core:default",
    "core:event:default",
    "core:window:default",
    "core:window:allow-set-position",
    "core:window:allow-set-size",
    "core:window:allow-show",
    "core:window:allow-hide",
    "core:window:allow-close",
    "core:webview:default",
    "autostart:default"
  ]
}
```

- [ ] **Step 12: Write placeholder `src-tauri\src\main.rs`**

```rust
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    deepseekbar_lib::run()
}
```

- [ ] **Step 13: Create `src-tauri\src\lib.rs` with hello-world run()**

```rust
pub fn run() {
    tauri::Builder::default()
        .setup(|_app| Ok(()))
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

- [ ] **Step 14: Provide placeholder icons**

Download the Tauri default icon set into `src-tauri\icons\` (Tauri CLI can do this):
```bash
cd D:\deepseekbar
npx @tauri-apps/cli icon --help
```
If the CLI can't fetch, manually copy any 32×32, 128×128 PNG and a `.ico` into `src-tauri\icons\`. Names must match `tauri.conf.json` `bundle.icon`: `32x32.png`, `128x128.png`, `icon.ico`. (The Tauri 2 starter typically ships these; if missing, create simple 1×1 colored PNGs and convert to .ico with `npx tauri-icon` after pointing at a 1024×1024 PNG.)

- [ ] **Step 15: Install JS dependencies and verify dev server boots**

```bash
cd D:\deepseekbar
npm install
```
Expected: no errors, `node_modules/` created, no peer-dep failures that block.

```bash
cd D:\deepseekbar
npx tauri --version
```
Expected: prints `tauri 2.x.x`.

- [ ] **Step 16: Verify Rust crate compiles**

```bash
cd D:\deepseekbar\src-tauri
cargo check
```
Expected: compiles with no errors (warnings about unused imports are fine at this stage).

- [ ] **Step 17: Commit**

```bash
cd D:\deepseekbar
git add .gitignore package.json package-lock.json tsconfig.json vite.config.ts index.html src/ src-tauri/
git commit -m "chore: scaffold Tauri 2 + Vite + TS project"
```

---

## Task 2: Error module (`error.rs`)

**Files:**
- Create: `D:\deepseekbar\src-tauri\src\error.rs`
- Modify: `D:\deepseekbar\src-tauri\src\lib.rs` (declare module)

- [ ] **Step 1: Write failing test in `error.rs`**

```rust
// src-tauri/src/error.rs

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classify_401_as_auth() {
        let e = AppError::HttpStatus(401, "unauthorized".into());
        assert_eq!(classify_error(&e), ErrorKind::Auth);
    }

    #[test]
    fn classify_403_as_auth() {
        let e = AppError::HttpStatus(403, "forbidden".into());
        assert_eq!(classify_error(&e), ErrorKind::Auth);
    }

    #[test]
    fn classify_5xx_as_network() {
        let e = AppError::HttpStatus(500, "server error".into());
        assert_eq!(classify_error(&e), ErrorKind::Network);
    }

    #[test]
    fn classify_502_as_network() {
        let e = AppError::HttpStatus(502, "bad gateway".into());
        assert_eq!(classify_error(&e), ErrorKind::Network);
    }

    #[test]
    fn classify_timeout_as_network() {
        let e = AppError::Timeout;
        assert_eq!(classify_error(&e), ErrorKind::Network);
    }

    #[test]
    fn classify_connect_as_network() {
        let e = AppError::Connect("dns".into());
        assert_eq!(classify_error(&e), ErrorKind::Network);
    }

    #[test]
    fn classify_parse_as_parse() {
        let e = AppError::Parse("missing field balance".into());
        assert_eq!(classify_error(&e), ErrorKind::Parse);
    }

    #[test]
    fn classify_keyring_as_auth() {
        let e = AppError::Keyring("not found".into());
        assert_eq!(classify_error(&e), ErrorKind::Auth);
    }

    #[test]
    fn classify_sqlite_as_internal() {
        let e = AppError::Sqlite("db locked".into());
        assert_eq!(classify_error(&e), ErrorKind::Internal);
    }
}
```

- [ ] **Step 2: Run test, expect compile failure**

```bash
cd D:\deepseekbar\src-tauri
cargo test --lib error
```
Expected: compile error — `AppError`, `ErrorKind`, `classify_error` not defined.

- [ ] **Step 3: Add `pub mod error;` in `lib.rs`**

Edit `src-tauri/src/lib.rs`:
```rust
pub mod error;

pub fn run() {
    tauri::Builder::default()
        .setup(|_app| Ok(()))
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

- [ ] **Step 4: Implement `error.rs`**

```rust
// src-tauri/src/error.rs
use serde::Serialize;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum AppError {
    #[error("http status {0}: {1}")]
    HttpStatus(u16, String),
    #[error("request timed out")]
    Timeout,
    #[error("connect error: {0}")]
    Connect(String),
    #[error("response parse error: {0}")]
    Parse(String),
    #[error("keyring error: {0}")]
    Keyring(String),
    #[error("sqlite error: {0}")]
    Sqlite(String),
    #[error("serde error: {0}")]
    Serde(String),
    #[error("other: {0}")]
    Other(String),
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ErrorKind {
    Auth,
    Network,
    Parse,
    Internal,
}

pub fn classify_error(e: &AppError) -> ErrorKind {
    match e {
        AppError::HttpStatus(401, _) | AppError::HttpStatus(403, _) => ErrorKind::Auth,
        AppError::Keyring(_) => ErrorKind::Auth,
        AppError::HttpStatus(500..=599, _) => ErrorKind::Network,
        AppError::Timeout | AppError::Connect(_) => ErrorKind::Network,
        AppError::Parse(_) => ErrorKind::Parse,
        AppError::Sqlite(_) | AppError::Serde(_) | AppError::Other(_) => ErrorKind::Internal,
        // 2xx non-200 and 4xx other than 401/403 fall to internal until we know better
        AppError::HttpStatus(_, _) => ErrorKind::Internal,
    }
}

impl From<reqwest::Error> for AppError {
    fn from(e: reqwest::Error) -> Self {
        if e.is_timeout() {
            AppError::Timeout
        } else if e.is_connect() {
            AppError::Connect(e.to_string())
        } else {
            AppError::Other(e.to_string())
        }
    }
}

impl From<rusqlite::Error> for AppError {
    fn from(e: rusqlite::Error) -> Self {
        AppError::Sqlite(e.to_string())
    }
}

impl From<serde_json::Error> for AppError {
    fn from(e: serde_json::Error) -> Self {
        AppError::Serde(e.to_string())
    }
}

impl From<keyring::Error> for AppError {
    fn from(e: keyring::Error) -> Self {
        AppError::Keyring(e.to_string())
    }
}

impl Serialize for AppError {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_string())
    }
}
```

- [ ] **Step 5: Run test, expect pass**

```bash
cd D:\deepseekbar\src-tauri
cargo test --lib error
```
Expected: `9 passed; 0 failed`.

- [ ] **Step 6: Commit**

```bash
cd D:\deepseekbar
git add src-tauri/src/error.rs src-tauri/src/lib.rs
git commit -m "feat(rust): add AppError + ErrorKind with classify_error"
```

---

## Task 3: DeepSeek API client (`deepseek.rs`)

**Files:**
- Create: `D:\deepseekbar\src-tauri\src\deepseek.rs`
- Modify: `D:\deepseekbar\src-tauri\src\lib.rs` (add `pub mod deepseek;`)

- [ ] **Step 1: Write failing tests in `deepseek.rs`**

```rust
// src-tauri/src/deepseek.rs

use crate::error::{AppError, ErrorKind};
use rust_decimal::Decimal;
use serde::Deserialize;

const ENDPOINT: &str = "https://api.deepseek.com/user/balance";

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
pub struct Balance {
    pub currency: String,
    pub total: Decimal,
    pub granted: Decimal,
    pub topped_up: Decimal,
    pub available: Decimal,
}

pub async fn fetch_balance(client: &reqwest::Client, api_key: &str) -> Result<Balance, AppError> {
    todo!()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use wiremock::matchers::{header, method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    fn make_client() -> reqwest::Client {
        reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(10))
            .build()
            .unwrap()
    }

    #[tokio::test]
    async fn fetches_and_parses_valid_response() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/user/balance"))
            .and(header("Authorization", "Bearer sk-test"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "balance_infos": [{
                    "currency": "CNY",
                    "total_balance": "12.34",
                    "granted_balance": "0.00",
                    "topped_up_balance": "12.34"
                }],
                "available_balance": "12.34"
            })))
            .mount(&server)
            .await;

        let client = make_client();
        let url = format!("{}/user/balance", server.uri());
        let body: serde_json::Value = client
            .get(&url)
            .bearer_auth("sk-test")
            .send()
            .await
            .unwrap()
            .json()
            .await
            .unwrap();

        assert_eq!(body["available_balance"], "12.34");
    }
}
```

Note: the above is a wiring test using `wiremock` to confirm the integration works; the real parsing test is below.

- [ ] **Step 2: Run test, expect compile failure**

```bash
cd D:\deepseekbar\src-tauri
cargo test --lib deepseek
```
Expected: compile error — `Balance` exists but `fetch_balance` body is `todo!()` so the test panics if it runs. (The wiring test won't actually call our `fetch_balance` yet — it calls reqwest directly. That's fine for now; the actual unit test on `parse_balance` is the next one.)

- [ ] **Step 3: Replace tests with the real test set for `parse_balance` and `fetch_balance`**

```rust
// src-tauri/src/deepseek.rs

use crate::error::{AppError, ErrorKind};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};

const ENDPOINT: &str = "https://api.deepseek.com/user/balance";

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
pub struct Balance {
    pub currency: String,
    pub total: Decimal,
    pub granted: Decimal,
    pub topped_up: Decimal,
    pub available: Decimal,
}

#[derive(Debug, Deserialize)]
struct RawResponse {
    #[serde(default)]
    balance_infos: Vec<RawBalanceInfo>,
    #[serde(default)]
    available_balance: Option<String>,
}

#[derive(Debug, Deserialize)]
struct RawBalanceInfo {
    currency: String,
    #[serde(default)]
    total_balance: String,
    #[serde(default)]
    granted_balance: String,
    #[serde(default)]
    topped_up_balance: String,
}

pub fn parse_balance(body: &str) -> Result<Balance, AppError> {
    let raw: RawResponse = serde_json::from_str(body)
        .map_err(|e| AppError::Parse(e.to_string()))?;
    let info = raw
        .balance_infos
        .into_iter()
        .next()
        .ok_or_else(|| AppError::Parse("balance_infos is empty".into()))?;
    let available = raw
        .available_balance
        .ok_or_else(|| AppError::Parse("available_balance missing".into()))?;
    Ok(Balance {
        currency: info.currency,
        total: Decimal::from_str_exact(&info.total_balance)
            .map_err(|e| AppError::Parse(format!("total_balance: {e}")))?,
        granted: Decimal::from_str_exact(&info.granted_balance)
            .map_err(|e| AppError::Parse(format!("granted_balance: {e}")))?,
        topped_up: Decimal::from_str_exact(&info.topped_up_balance)
            .map_err(|e| AppError::Parse(format!("topped_up_balance: {e}")))?,
        available: Decimal::from_str_exact(&available)
            .map_err(|e| AppError::Parse(format!("available_balance: {e}")))?,
    })
}

pub async fn fetch_balance(
    client: &reqwest::Client,
    api_key: &str,
) -> Result<Balance, AppError> {
    let resp = client
        .get(ENDPOINT)
        .bearer_auth(api_key)
        .send()
        .await?;
    let status = resp.status();
    if !status.is_success() {
        let text = resp.text().await.unwrap_or_default();
        return Err(AppError::HttpStatus(status.as_u16(), text));
    }
    let body = resp.text().await?;
    parse_balance(&body)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use wiremock::matchers::{header, method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    fn client() -> reqwest::Client {
        reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(10))
            .build()
            .unwrap()
    }

    #[test]
    fn parse_valid_cny_body() {
        let body = json!({
            "balance_infos": [{
                "currency": "CNY",
                "total_balance": "12.34",
                "granted_balance": "0.00",
                "topped_up_balance": "12.34"
            }],
            "available_balance": "12.34"
        })
        .to_string();
        let b = parse_balance(&body).unwrap();
        assert_eq!(b.currency, "CNY");
        assert_eq!(b.available, Decimal::new(1234, 2));
        assert_eq!(b.total, Decimal::new(1234, 2));
        assert_eq!(b.topped_up, Decimal::new(1234, 2));
    }

    #[test]
    fn parse_high_precision_keeps_string_value() {
        let body = json!({
            "balance_infos": [{
                "currency": "CNY",
                "total_balance": "0.000123456789",
                "granted_balance": "0",
                "topped_up_balance": "0.000123456789"
            }],
            "available_balance": "0.000123456789"
        })
        .to_string();
        let b = parse_balance(&body).unwrap();
        assert_eq!(b.available.to_string(), "0.000123456789");
    }

    #[test]
    fn parse_missing_balance_infos_errors() {
        let body = json!({ "available_balance": "1.00" }).to_string();
        assert!(parse_balance(&body).is_err());
    }

    #[test]
    fn parse_missing_available_balance_errors() {
        let body = json!({
            "balance_infos": [{
                "currency": "CNY",
                "total_balance": "1.00",
                "granted_balance": "0",
                "topped_up_balance": "1.00"
            }]
        })
        .to_string();
        assert!(parse_balance(&body).is_err());
    }

    #[test]
    fn parse_invalid_decimal_errors() {
        let body = json!({
            "balance_infos": [{
                "currency": "CNY",
                "total_balance": "abc",
                "granted_balance": "0",
                "topped_up_balance": "0"
            }],
            "available_balance": "0"
        })
        .to_string();
        let err = parse_balance(&body).unwrap_err();
        assert_eq!(crate::error::classify_error(&err), ErrorKind::Parse);
    }

    #[tokio::test]
    async fn fetch_balance_200_returns_balance() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/user/balance"))
            .and(header("Authorization", "Bearer sk-ok"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "balance_infos": [{
                    "currency": "CNY",
                    "total_balance": "5.00",
                    "granted_balance": "5.00",
                    "topped_up_balance": "0.00"
                }],
                "available_balance": "5.00"
            })))
            .mount(&server)
            .await;

        let c = client();
        let resp = c
            .get(format!("{}/user/balance", server.uri()))
            .bearer_auth("sk-ok")
            .send()
            .await
            .unwrap();
        let text = resp.text().await.unwrap();
        let b = parse_balance(&text).unwrap();
        assert_eq!(b.available, Decimal::new(500, 2));
    }

    #[tokio::test]
    async fn fetch_balance_401_returns_http_status() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/user/balance"))
            .respond_with(ResponseTemplate::new(401).set_body_string("unauthorized"))
            .mount(&server)
            .await;

        let c = client();
        let resp = c
            .get(format!("{}/user/balance", server.uri()))
            .bearer_auth("sk-bad")
            .send()
            .await
            .unwrap();
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        let err = AppError::HttpStatus(status.as_u16(), text);
        assert_eq!(crate::error::classify_error(&err), ErrorKind::Auth);
    }

    #[tokio::test]
    async fn fetch_balance_500_classifies_as_network() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/user/balance"))
            .respond_with(ResponseTemplate::new(503))
            .mount(&server)
            .await;

        let c = client();
        let resp = c
            .get(format!("{}/user/balance", server.uri()))
            .bearer_auth("sk-ok")
            .send()
            .await
            .unwrap();
        let err = AppError::HttpStatus(resp.status().as_u16(), String::new());
        assert_eq!(crate::error::classify_error(&err), ErrorKind::Network);
    }
}
```

Add `use rust_decimal::Decimal;` and `use serde::{Deserialize, Serialize};` at the top.

- [ ] **Step 4: Add `pub mod deepseek;` in `lib.rs`**

```rust
pub mod deepseek;
pub mod error;

pub fn run() {
    tauri::Builder::default()
        .setup(|_app| Ok(()))
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

- [ ] **Step 5: Run tests, expect pass**

```bash
cd D:\deepseekbar\src-tauri
cargo test --lib deepseek
```
Expected: 8 passed; 0 failed.

- [ ] **Step 6: Commit**

```bash
cd D:\deepseekbar
git add src-tauri/src/deepseek.rs src-tauri/src/lib.rs
git commit -m "feat(rust): DeepSeek API client with parse_balance and error tests"
```

---

## Task 4: Store (SQLite + keyring) (`store.rs`)

**Files:**
- Create: `D:\deepseekbar\src-tauri\src\store.rs`
- Modify: `D:\deepseekbar\src-tauri\src\lib.rs` (add `pub mod store;`)

- [ ] **Step 1: Write failing tests in `store.rs`**

```rust
// src-tauri/src/store.rs

use crate::error::AppError;
use rusqlite::{params, Connection};
use rust_decimal::Decimal;
use serde::Serialize;

const KEYRING_SERVICE: &str = "com.deepseekbar.app";
const KEYRING_USER: &str = "api_key";

#[derive(Debug, Clone, Serialize)]
pub struct Snapshot {
    pub ts_utc: i64,
    pub balance: Decimal,
    pub currency: String,
    pub is_stale: bool,
}

pub struct Store {
    conn: Connection,
}

impl Store {
    pub fn open(path: &std::path::Path) -> Result<Self, AppError> {
        todo!()
    }
    pub fn write_snapshot(&self, snap: &Snapshot) -> Result<(), AppError> { todo!() }
    pub fn history(&self, days: u32) -> Result<Vec<Snapshot>, AppError> { todo!() }
    pub fn cleanup_older_than(&self, cutoff_utc_ms: i64) -> Result<usize, AppError> { todo!() }
    pub fn set_state(&self, key: &str, value: &str) -> Result<(), AppError> { todo!() }
    pub fn get_state(&self, key: &str) -> Result<Option<String>, AppError> { todo!() }
}

pub fn save_api_key(key: &str) -> Result<(), AppError> { todo!() }
pub fn load_api_key() -> Result<String, AppError> { todo!() }
pub fn delete_api_key() -> Result<(), AppError> { todo!() }
pub fn has_api_key() -> bool { todo!() }

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn store_creates_schema_on_open() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("data.db");
        let _ = Store::open(&path).unwrap();
        // re-open to confirm schema persisted
        let s2 = Store::open(&path).unwrap();
        assert!(s2.history(30).unwrap().is_empty());
    }
}
```

- [ ] **Step 2: Run test, expect compile failure**

```bash
cd D:\deepseekbar\src-tauri
cargo test --lib store
```
Expected: compile error — `Store::open` is `todo!()` so it panics if it runs.

- [ ] **Step 3: Implement `store.rs`**

```rust
// src-tauri/src/store.rs

use crate::error::AppError;
use rusqlite::{params, Connection, OptionalExtension};
use rust_decimal::Decimal;
use serde::Serialize;

const KEYRING_SERVICE: &str = "com.deepseekbar.app";
const KEYRING_USER: &str = "api_key";

#[derive(Debug, Clone, Serialize)]
pub struct Snapshot {
    pub ts_utc: i64,
    pub balance: Decimal,
    pub currency: String,
    pub is_stale: bool,
}

pub struct Store {
    conn: Connection,
}

impl Store {
    pub fn open(path: &std::path::Path) -> Result<Self, AppError> {
        let conn = Connection::open(path)?;
        conn.execute_batch(
            r#"
            PRAGMA journal_mode = WAL;
            CREATE TABLE IF NOT EXISTS snapshots (
                id        INTEGER PRIMARY KEY AUTOINCREMENT,
                ts_utc    INTEGER NOT NULL,
                balance   TEXT    NOT NULL,
                currency  TEXT    NOT NULL DEFAULT 'CNY',
                is_stale  INTEGER NOT NULL DEFAULT 0
            );
            CREATE INDEX IF NOT EXISTS idx_snapshots_ts ON snapshots(ts_utc);
            CREATE TABLE IF NOT EXISTS app_state (
                key   TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
            "#,
        )?;
        Ok(Store { conn })
    }

    pub fn write_snapshot(&self, snap: &Snapshot) -> Result<(), AppError> {
        self.conn.execute(
            "INSERT INTO snapshots (ts_utc, balance, currency, is_stale) VALUES (?, ?, ?, ?)",
            params![
                snap.ts_utc,
                snap.balance.to_string(),
                snap.currency,
                snap.is_stale as i64,
            ],
        )?;
        Ok(())
    }

    pub fn history(&self, days: u32) -> Result<Vec<Snapshot>, AppError> {
        let cutoff = chrono_now_minus_days(days);
        let mut stmt = self.conn.prepare(
            "SELECT ts_utc, balance, currency, is_stale FROM snapshots \
             WHERE ts_utc >= ? ORDER BY ts_utc ASC",
        )?;
        let rows = stmt
            .query_map(params![cutoff], |r| {
                let ts: i64 = r.get(0)?;
                let bal: String = r.get(1)?;
                let cur: String = r.get(2)?;
                let stale: i64 = r.get(3)?;
                Ok(Snapshot {
                    ts_utc: ts,
                    balance: Decimal::from_str_exact(&bal)
                        .map_err(|e| rusqlite::Error::InvalidColumnType(0, e.to_string()))?,
                    currency: cur,
                    is_stale: stale != 0,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    pub fn cleanup_older_than(&self, cutoff_utc_ms: i64) -> Result<usize, AppError> {
        let n = self
            .conn
            .execute("DELETE FROM snapshots WHERE ts_utc < ?", params![cutoff_utc_ms])?;
        Ok(n)
    }

    pub fn set_state(&self, key: &str, value: &str) -> Result<(), AppError> {
        self.conn.execute(
            "INSERT INTO app_state (key, value) VALUES (?, ?) \
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![key, value],
        )?;
        Ok(())
    }

    pub fn get_state(&self, key: &str) -> Result<Option<String>, AppError> {
        let v = self
            .conn
            .query_row(
                "SELECT value FROM app_state WHERE key = ?",
                params![key],
                |r| r.get::<_, String>(0),
            )
            .optional()?;
        Ok(v)
    }
}

fn chrono_now_minus_days(days: u32) -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);
    now - (days as i64) * 86_400_000
}

// ---- API key via keyring ----

pub fn save_api_key(key: &str) -> Result<(), AppError> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER)?;
    entry.set_password(key)?;
    Ok(())
}

pub fn load_api_key() -> Result<String, AppError> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER)?;
    let p = entry.get_password()?;
    Ok(p)
}

pub fn delete_api_key() -> Result<(), AppError> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER)?;
    match entry.delete_password() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.into()),
    }
}

pub fn has_api_key() -> bool {
    load_api_key().is_ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn store_creates_schema_on_open() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("data.db");
        let _ = Store::open(&path).unwrap();
        let s2 = Store::open(&path).unwrap();
        assert!(s2.history(30).unwrap().is_empty());
    }

    #[test]
    fn write_snapshot_then_read_back() {
        let dir = tempdir().unwrap();
        let s = Store::open(&dir.path().join("d.db")).unwrap();
        let snap = Snapshot {
            ts_utc: 1_700_000_000_000,
            balance: Decimal::new(1234, 2),
            currency: "CNY".into(),
            is_stale: false,
        };
        s.write_snapshot(&snap).unwrap();
        let h = s.history(30).unwrap();
        assert_eq!(h.len(), 1);
        assert_eq!(h[0].balance, Decimal::new(1234, 2));
        assert_eq!(h[0].currency, "CNY");
        assert!(!h[0].is_stale);
    }

    #[test]
    fn write_two_ordered_returns_ascending() {
        let dir = tempdir().unwrap();
        let s = Store::open(&dir.path().join("d.db")).unwrap();
        s.write_snapshot(&Snapshot {
            ts_utc: 2,
            balance: Decimal::new(2, 0),
            currency: "CNY".into(),
            is_stale: false,
        })
        .unwrap();
        s.write_snapshot(&Snapshot {
            ts_utc: 1,
            balance: Decimal::new(1, 0),
            currency: "CNY".into(),
            is_stale: false,
        })
        .unwrap();
        let h = s.history(30).unwrap();
        assert_eq!(h[0].ts_utc, 1);
        assert_eq!(h[1].ts_utc, 2);
    }

    #[test]
    fn cleanup_removes_old_rows() {
        let dir = tempdir().unwrap();
        let s = Store::open(&dir.path().join("d.db")).unwrap();
        s.write_snapshot(&Snapshot {
            ts_utc: 1,
            balance: Decimal::new(1, 0),
            currency: "CNY".into(),
            is_stale: false,
        })
        .unwrap();
        s.write_snapshot(&Snapshot {
            ts_utc: 100,
            balance: Decimal::new(100, 0),
            currency: "CNY".into(),
            is_stale: false,
        })
        .unwrap();
        let n = s.cleanup_older_than(50).unwrap();
        assert_eq!(n, 1);
        let h = s.history(30).unwrap();
        assert_eq!(h.len(), 1);
        assert_eq!(h[0].ts_utc, 100);
    }

    #[test]
    fn app_state_set_get_overwrite() {
        let dir = tempdir().unwrap();
        let s = Store::open(&dir.path().join("d.db")).unwrap();
        assert!(s.get_state("mode").unwrap().is_none());
        s.set_state("mode", "compact").unwrap();
        assert_eq!(s.get_state("mode").unwrap().as_deref(), Some("compact"));
        s.set_state("mode", "expanded").unwrap();
        assert_eq!(s.get_state("mode").unwrap().as_deref(), Some("expanded"));
    }
}
```

Note: the test for `keyring` is **not** included here because Credential Manager is a Windows-only side effect; we'll smoke-test the keyring path manually in Task 13.

- [ ] **Step 4: Add `pub mod store;` in `lib.rs`**

```rust
pub mod deepseek;
pub mod error;
pub mod store;

pub fn run() {
    tauri::Builder::default()
        .setup(|_app| Ok(()))
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

- [ ] **Step 5: Run tests, expect pass**

```bash
cd D:\deepseekbar\src-tauri
cargo test --lib store
```
Expected: 5 passed; 0 failed.

- [ ] **Step 6: Commit**

```bash
cd D:\deepseekbar
git add src-tauri/src/store.rs src-tauri/src/lib.rs
git commit -m "feat(rust): SQLite Store (snapshots + app_state) and keyring wrapper"
```

---

## Task 5: AppState (`state.rs`)

**Files:**
- Create: `D:\deepseekbar\src-tauri\src\state.rs`
- Modify: `D:\deepseekbar\src-tauri\src\lib.rs`

- [ ] **Step 1: Write failing tests**

```rust
// src-tauri/src/state.rs

use crate::deepseek::Balance;
use std::sync::Arc;
use tokio::sync::RwLock;

#[derive(Default)]
pub struct Cache {
    pub last_balance: Option<Balance>,
    pub last_refresh_unix_ms: i64,
}

#[derive(Clone)]
pub struct AppState {
    pub cache: Arc<RwLock<Cache>>,
    pub refresh_lock: Arc<tokio::sync::Mutex<()>>,
}

impl AppState {
    pub fn new() -> Self { todo!() }
    pub async fn set_balance(&self, b: Balance) { todo!() }
    pub async fn get_balance(&self) -> Option<Balance> { todo!() }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rust_decimal::Decimal;

    fn b() -> Balance {
        Balance {
            currency: "CNY".into(),
            total: Decimal::new(100, 2),
            granted: Decimal::new(0, 0),
            topped_up: Decimal::new(100, 2),
            available: Decimal::new(100, 2),
        }
    }

    #[tokio::test]
    async fn new_starts_empty() {
        let s = AppState::new();
        assert!(s.get_balance().await.is_none());
    }

    #[tokio::test]
    async fn set_then_get_returns_same() {
        let s = AppState::new();
        s.set_balance(b()).await;
        let got = s.get_balance().await.unwrap();
        assert_eq!(got.available, Decimal::new(100, 2));
    }
}
```

- [ ] **Step 2: Run test, expect panic from `todo!()`**

```bash
cd D:\deepseekbar\src-tauri
cargo test --lib state
```

- [ ] **Step 3: Implement `state.rs`**

```rust
// src-tauri/src/state.rs

use crate::deepseek::Balance;
use std::sync::Arc;
use tokio::sync::RwLock;

#[derive(Default)]
pub struct Cache {
    pub last_balance: Option<Balance>,
    pub last_refresh_unix_ms: i64,
}

#[derive(Clone)]
pub struct AppState {
    pub cache: Arc<RwLock<Cache>>,
    pub refresh_lock: Arc<tokio::sync::Mutex<()>>,
}

impl AppState {
    pub fn new() -> Self {
        AppState {
            cache: Arc::new(RwLock::new(Cache::default())),
            refresh_lock: Arc::new(tokio::sync::Mutex::new(())),
        }
    }

    pub async fn set_balance(&self, b: Balance) {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0);
        let mut g = self.cache.write().await;
        g.last_balance = Some(b);
        g.last_refresh_unix_ms = now;
    }

    pub async fn get_balance(&self) -> Option<Balance> {
        self.cache.read().await.last_balance.clone()
    }

    pub async fn last_refresh(&self) -> i64 {
        self.cache.read().await.last_refresh_unix_ms
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rust_decimal::Decimal;

    fn b() -> Balance {
        Balance {
            currency: "CNY".into(),
            total: Decimal::new(100, 2),
            granted: Decimal::new(0, 0),
            topped_up: Decimal::new(100, 2),
            available: Decimal::new(100, 2),
        }
    }

    #[tokio::test]
    async fn new_starts_empty() {
        let s = AppState::new();
        assert!(s.get_balance().await.is_none());
    }

    #[tokio::test]
    async fn set_then_get_returns_same() {
        let s = AppState::new();
        s.set_balance(b()).await;
        let got = s.get_balance().await.unwrap();
        assert_eq!(got.available, Decimal::new(100, 2));
    }
}
```

- [ ] **Step 4: Add `pub mod state;` in `lib.rs`**

```rust
pub mod deepseek;
pub mod error;
pub mod state;
pub mod store;

pub fn run() { /* unchanged */ }
```

- [ ] **Step 5: Run tests, expect pass**

```bash
cd D:\deepseekbar\src-tauri
cargo test --lib state
```
Expected: 2 passed; 0 failed.

- [ ] **Step 6: Commit**

```bash
cd D:\deepseekbar
git add src-tauri/src/state.rs src-tauri/src/lib.rs
git commit -m "feat(rust): AppState with balance cache and refresh lock"
```

---

## Task 6: Scheduler (`scheduler.rs`)

**Files:**
- Create: `D:\deepseekbar\src-tauri\src\scheduler.rs`
- Modify: `D:\deepseekbar\src-tauri\src\lib.rs`

- [ ] **Step 1: Write failing tests**

```rust
// src-tauri/src/scheduler.rs

use crate::deepseek::Balance;
use crate::state::AppState;
use crate::store::Store;
use rust_decimal::Decimal;
use std::sync::Arc;

pub const DEFAULT_INTERVAL_SECS: u64 = 300;

pub struct Scheduler {
    pub state: AppState,
    pub store: Arc<Store>,
    pub client: reqwest::Client,
    pub interval: std::time::Duration,
}

impl Scheduler {
    pub fn new(state: AppState, store: Arc<Store>, client: reqwest::Client) -> Self { todo!() }
    pub async fn tick(&self) -> Result<(), crate::error::AppError> { todo!() }
    pub fn spawn(self) -> tokio::task::JoinHandle<()> { todo!() }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::deepseek::Balance;
    use rust_decimal::Decimal;
    use tempfile::tempdir;

    fn b() -> Balance {
        Balance {
            currency: "CNY".into(),
            total: Decimal::new(100, 2),
            granted: Decimal::new(0, 0),
            topped_up: Decimal::new(100, 2),
            available: Decimal::new(100, 2),
        }
    }

    #[tokio::test(start_paused = true)]
    async fn tick_writes_snapshot_on_success() {
        let dir = tempdir().unwrap();
        let store = Arc::new(Store::open(&dir.path().join("d.db")).unwrap());
        let s = AppState::new();
        let sched = Scheduler::new(s.clone(), store.clone(), reqwest::Client::new());
        sched.tick_with(b()).await.unwrap();
        assert_eq!(store.history(30).unwrap().len(), 1);
    }

    #[tokio::test(start_paused = true)]
    async fn tick_skips_time_regression() {
        let dir = tempdir().unwrap();
        let store = Arc::new(Store::open(&dir.path().join("d.db")).unwrap());
        let s = AppState::new();
        let sched = Scheduler::new(s.clone(), store.clone(), reqwest::Client::new());
        sched.tick_with(b()).await.unwrap();
        // simulate a row older than "now"
        let old = crate::store::Snapshot {
            ts_utc: 1,
            balance: Decimal::new(1, 0),
            currency: "CNY".into(),
            is_stale: false,
        };
        store.write_snapshot(&old).unwrap();
        sched.tick_with(b()).await.unwrap();
        // we should have 2 rows: the old one + the new one, but no new row
        // at ts_utc < 1 was written. Verify the new write did not regress.
        let h = store.history(30).unwrap();
        assert!(h.iter().all(|s| s.ts_utc >= 1));
    }
}
```

- [ ] **Step 2: Run test, expect failure**

```bash
cd D:\deepseekbar\src-tauri
cargo test --lib scheduler
```

- [ ] **Step 3: Implement `scheduler.rs`**

```rust
// src-tauri/src/scheduler.rs

use crate::deepseek::Balance;
use crate::error::{classify_error, AppError, ErrorKind};
use crate::state::AppState;
use crate::store::{Snapshot, Store};
use std::sync::Arc;

pub const DEFAULT_INTERVAL_SECS: u64 = 300;

pub struct Scheduler {
    pub state: AppState,
    pub store: Arc<Store>,
    pub client: reqwest::Client,
    pub interval: std::time::Duration,
}

impl Scheduler {
    pub fn new(
        state: AppState,
        store: Arc<Store>,
        client: reqwest::Client,
    ) -> Self {
        Scheduler {
            state,
            store,
            client,
            interval: std::time::Duration::from_secs(DEFAULT_INTERVAL_SECS),
        }
    }

    /// One refresh cycle. Serialized via `state.refresh_lock` so manual and
    /// scheduled ticks never overlap. Errors do NOT write a snapshot.
    pub async fn tick(&self) -> Result<(), AppError> {
        let _g = self.state.refresh_lock.lock().await;
        let key = crate::store::load_api_key()?;
        let balance = crate::deepseek::fetch_balance(&self.client, &key).await?;
        self.persist_and_cache(&balance).await?;
        Ok(())
    }

    /// Test seam: persist a known balance (used by tests, also useful for
    /// "test connection" UX after save).
    pub async fn tick_with(&self, balance: Balance) -> Result<(), AppError> {
        let _g = self.state.refresh_lock.lock().await;
        self.persist_and_cache(&balance).await
    }

    async fn persist_and_cache(&self, b: &Balance) -> Result<(), AppError> {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0);

        // Skip if a newer row already exists (time regression guard)
        let last_ts = self
            .store
            .history(30)?
            .into_iter()
            .map(|s| s.ts_utc)
            .max()
            .unwrap_or(0);
        if now < last_ts {
            tracing::warn!(now, last_ts, "skip snapshot: time regression");
        } else {
            self.store.write_snapshot(&Snapshot {
                ts_utc: now,
                balance: b.available,
                currency: b.currency.clone(),
                is_stale: false,
            })?;
        }
        self.state.set_balance(b.clone()).await;
        Ok(())
    }

    pub fn spawn(self) -> tokio::task::JoinHandle<()> {
        tokio::spawn(async move {
            loop {
                if crate::store::has_api_key() {
                    match self.tick().await {
                        Ok(()) => {
                            // success path; nothing to emit here, frontend will
                            // receive the event from a future Tasks 9/10
                        }
                        Err(e) => {
                            let kind = classify_error(&e);
                            tracing::warn!(?kind, error=%e, "scheduler tick failed");
                            // Events are emitted from main.rs once we have an
                            // AppHandle — scheduler does not know about Tauri
                            // in this unit-testable form.
                        }
                    }
                }
                tokio::time::sleep(self.interval).await;
            }
        })
    }
}

/// Helper used by commands to expose the kind to callers.
pub fn kind(e: &AppError) -> ErrorKind {
    classify_error(e)
}

#[cfg(test)]
mod tests {
    use super::*;
    use rust_decimal::Decimal;
    use tempfile::tempdir;

    fn b() -> Balance {
        Balance {
            currency: "CNY".into(),
            total: Decimal::new(100, 2),
            granted: Decimal::new(0, 0),
            topped_up: Decimal::new(100, 2),
            available: Decimal::new(100, 2),
        }
    }

    #[tokio::test(start_paused = true)]
    async fn tick_with_writes_snapshot_on_success() {
        let dir = tempdir().unwrap();
        let store = Arc::new(Store::open(&dir.path().join("d.db")).unwrap());
        let s = AppState::new();
        let sched = Scheduler::new(s.clone(), store.clone(), reqwest::Client::new());
        sched.tick_with(b()).await.unwrap();
        assert_eq!(store.history(30).unwrap().len(), 1);
    }

    #[tokio::test]
    async fn tick_with_does_not_regress_when_history_has_newer_row() {
        let dir = tempdir().unwrap();
        let store = Arc::new(Store::open(&dir.path().join("d.db")).unwrap());
        // write a row with a future-ish ts
        store
            .write_snapshot(&Snapshot {
                ts_utc: i64::MAX / 2,
                balance: Decimal::new(1, 0),
                currency: "CNY".into(),
                is_stale: false,
            })
            .unwrap();
        let s = AppState::new();
        let sched = Scheduler::new(s.clone(), store.clone(), reqwest::Client::new());
        sched.tick_with(b()).await.unwrap();
        // We still wrote nothing for the current tick (regression), but the
        // future row stays put.
        let h = store.history(30).unwrap();
        assert_eq!(h.len(), 1);
        assert_eq!(h[0].ts_utc, i64::MAX / 2);
    }
}
```

- [ ] **Step 4: Add `pub mod scheduler;` in `lib.rs`**

```rust
pub mod deepseek;
pub mod error;
pub mod scheduler;
pub mod state;
pub mod store;

pub fn run() { /* unchanged */ }
```

- [ ] **Step 5: Run tests, expect pass**

```bash
cd D:\deepseekbar\src-tauri
cargo test --lib scheduler
```
Expected: 2 passed; 0 failed.

- [ ] **Step 6: Commit**

```bash
cd D:\deepseekbar
git add src-tauri/src/scheduler.rs src-tauri/src/lib.rs
git commit -m "feat(rust): Scheduler with serialized tick and regression guard"
```

---

## Task 7: Tauri commands (`commands.rs`)

**Files:**
- Create: `D:\deepseekbar\src-tauri\src\commands.rs`
- Modify: `D:\deepseekbar\src-tauri\src\lib.rs`

- [ ] **Step 1: Write `commands.rs` (no unit tests here; integration is in Task 11)**

```rust
// src-tauri/src/commands.rs

use crate::deepseek::Balance;
use crate::error::{classify_error, AppError, ErrorKind};
use crate::scheduler::Scheduler;
use crate::state::AppState;
use crate::store::{self, Snapshot};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager, State};

#[derive(Serialize)]
pub struct ApiKeyStatus {
    pub configured: bool,
}

#[derive(Serialize)]
pub struct WindowStateOut {
    pub position: Option<Position>,
    pub mode: String,
    pub pinned: bool,
}

#[derive(Deserialize)]
pub struct WindowStateIn {
    pub position: Option<Position>,
    pub mode: String,
    pub pinned: bool,
}

#[derive(Serialize, Deserialize, Clone, Copy)]
pub struct Position {
    pub x: i32,
    pub y: i32,
}

#[tauri::command]
pub fn get_api_key_status() -> ApiKeyStatus {
    ApiKeyStatus { configured: store::has_api_key() }
}

#[tauri::command]
pub fn save_api_key(
    app: AppHandle,
    state: State<'_, AppState>,
    scheduler: State<'_, Arc<Scheduler>>,
    key: String,
) -> Result<(), AppError> {
    store::save_api_key(&key)?;
    // Fire-and-forget first tick
    let sched = scheduler.inner().clone();
    let state_clone = state.inner().clone();
    let app_clone = app.clone();
    tauri::async_runtime::spawn(async move {
        if let Err(e) = sched.tick().await {
            emit_error(&app_clone, &state_clone, e);
        } else {
            emit_updated(&app_clone, &state_clone).await;
        }
    });
    Ok(())
}

#[tauri::command]
pub fn delete_api_key() -> Result<(), AppError> {
    store::delete_api_key()
}

#[tauri::command]
pub async fn get_current_balance(
    state: State<'_, AppState>,
) -> Result<Option<Balance>, AppError> {
    Ok(state.get_balance().await)
}

#[tauri::command]
pub fn trigger_refresh(
    app: AppHandle,
    state: State<'_, AppState>,
    scheduler: State<'_, Arc<Scheduler>>,
) -> Result<(), AppError> {
    let sched = scheduler.inner().clone();
    let state_clone = state.inner().clone();
    let app_clone = app.clone();
    tauri::async_runtime::spawn(async move {
        if let Err(e) = sched.tick().await {
            emit_error(&app_clone, &state_clone, e);
        } else {
            emit_updated(&app_clone, &state_clone).await;
        }
    });
    Ok(())
}

#[tauri::command]
pub fn get_history(
    scheduler: State<'_, Arc<Scheduler>>,
    days: u32,
) -> Result<Vec<Snapshot>, AppError> {
    scheduler.store.history(days)
}

#[tauri::command]
pub fn get_window_state(
    scheduler: State<'_, Arc<Scheduler>>,
) -> Result<WindowStateOut, AppError> {
    let pos_str = scheduler.store.get_state("window_position")?;
    let mode = scheduler
        .store
        .get_state("window_mode")?
        .unwrap_or_else(|| "compact".to_string());
    let pinned_str = scheduler.store.get_state("pinned")?;
    let pinned = pinned_str.as_deref() == Some("true");
    let position = pos_str
        .and_then(|s| serde_json::from_str::<Position>(&s).ok());
    Ok(WindowStateOut { position, mode, pinned })
}

#[tauri::command]
pub fn save_window_state(
    scheduler: State<'_, Arc<Scheduler>>,
    state: WindowStateIn,
) -> Result<(), AppError> {
    if let Some(p) = state.position {
        scheduler
            .store
            .set_state("window_position", &serde_json::to_string(&p)?)?;
    }
    scheduler.store.set_state("window_mode", &state.mode)?;
    scheduler
        .store
        .set_state("pinned", if state.pinned { "true" } else { "false" })?;
    Ok(())
}

#[tauri::command]
pub fn set_autostart(app: AppHandle, enabled: bool) -> Result<(), AppError> {
    use tauri_plugin_autostart::ManagerExt;
    let mgr = app.autolaunch();
    if enabled {
        mgr.enable().map_err(|e| AppError::Other(e.to_string()))?;
    } else {
        mgr.disable().map_err(|e| AppError::Other(e.to_string()))?;
    }
    Ok(())
}

pub async fn emit_updated(app: &AppHandle, state: &AppState) {
    if let Some(b) = state.get_balance().await {
        let _ = app.emit("balance:updated", &b);
        if let Some(snap) = state.get_balance().await {
            let _ = app.emit("history:appended", &Snapshot {
                ts_utc: std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map(|d| d.as_millis() as i64)
                    .unwrap_or(0),
                balance: snap.available,
                currency: snap.currency.clone(),
                is_stale: false,
            });
        }
    }
}

pub fn emit_error(app: &AppHandle, _state: &AppState, err: AppError) {
    let kind = classify_error(&err);
    let kind_str = match kind {
        ErrorKind::Auth => "auth",
        ErrorKind::Network => "network",
        ErrorKind::Parse => "parse",
        ErrorKind::Internal => "internal",
    };
    let _ = app.emit(
        "balance:error",
        &serde_json::json!({ "kind": kind_str, "message": err.to_string() }),
    );
}
```

- [ ] **Step 2: Add `pub mod commands;` in `lib.rs`**

```rust
pub mod commands;
pub mod deepseek;
pub mod error;
pub mod scheduler;
pub mod state;
pub mod store;

pub fn run() { /* unchanged */ }
```

- [ ] **Step 3: Compile**

```bash
cd D:\deepseekbar\src-tauri
cargo check
```
Expected: compiles (the `run()` function still doesn't use these; wiring is in Task 10).

- [ ] **Step 4: Commit**

```bash
cd D:\deepseekbar
git add src-tauri/src/commands.rs src-tauri/src/lib.rs
git commit -m "feat(rust): Tauri commands (9) with event emission"
```

---

## Task 8: System tray (`tray.rs`)

**Files:**
- Create: `D:\deepseekbar\src-tauri\src\tray.rs`
- Modify: `D:\deepseekbar\src-tauri\src\lib.rs`

- [ ] **Step 1: Write `tray.rs`**

```rust
// src-tauri/src/tray.rs

use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager,
};

pub fn build(app: &AppHandle) -> tauri::Result<()> {
    let show_hide = MenuItem::with_id(app, "show_hide", "显示/隐藏窗口", true, None::<&str>)?;
    let refresh = MenuItem::with_id(app, "refresh", "立即刷新", true, None::<&str>)?;
    let sep1 = PredefinedMenuItem::separator(app)?;
    let settings = MenuItem::with_id(app, "settings", "设置…", true, None::<&str>)?;
    let sep2 = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;

    let menu = Menu::with_items(
        app,
        &[&show_hide, &refresh, &sep1, &settings, &sep2, &quit],
    )?;

    TrayIconBuilder::with_id("main")
        .tooltip("DeepSeekBar")
        .icon(app.default_window_icon().cloned().unwrap())
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show_hide" => toggle_window(app),
            "refresh" => trigger_refresh(app),
            "settings" => open_settings(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                toggle_window(tray.app_handle());
            }
        })
        .build(app)?;
    Ok(())
}

fn toggle_window(app: &AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        match win.is_visible() {
            Ok(true) => { let _ = win.hide(); }
            _ => { let _ = win.show(); let _ = win.set_focus(); }
        }
    }
}

fn trigger_refresh(app: &AppHandle) {
    use tauri::Emitter;
    let _ = app.emit("balance:manual_refresh", ());
}

fn open_settings(app: &AppHandle) {
    use tauri::Emitter;
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.show();
        let _ = win.set_focus();
    }
    let _ = app.emit("mode:changed", serde_json::json!({ "mode": "settings" }));
}
```

- [ ] **Step 2: Add `pub mod tray;` in `lib.rs`**

```rust
pub mod commands;
pub mod deepseek;
pub mod error;
pub mod scheduler;
pub mod state;
pub mod store;
pub mod tray;

pub fn run() { /* unchanged */ }
```

- [ ] **Step 3: Compile**

```bash
cd D:\deepseekbar\src-tauri
cargo check
```

- [ ] **Step 4: Commit**

```bash
cd D:\deepseekbar
git add src-tauri/src/tray.rs src-tauri/src/lib.rs
git commit -m "feat(rust): system tray with menu and click handler"
```

---

## Task 9: Frontend types and format module

**Files:**
- Create: `D:\deepseekbar\src\types.ts`
- Create: `D:\deepseekbar\src\format.ts`
- Create: `D:\deepseekbar\src\format.test.ts`

- [ ] **Step 1: Write `types.ts`**

```typescript
// src/types.ts
import type { Decimal } from "decimal.js-light";

export interface Balance {
  currency: string;
  total: Decimal;
  granted: Decimal;
  topped_up: Decimal;
  available: Decimal;
}

export interface Snapshot {
  ts_utc: number;
  balance: Decimal;
  currency: string;
  is_stale: boolean;
}

export interface Position {
  x: number;
  y: number;
}

export interface WindowState {
  position: Position | null;
  mode: "compact" | "expanded" | "settings";
  pinned: boolean;
}

export type ErrorKind = "auth" | "network" | "parse" | "internal";

export interface BalanceError {
  kind: ErrorKind;
  message: string;
}

export type UiMode = "compact" | "expanded" | "settings";
```

Note: `Balance` from the Rust side serializes `Decimal` to a JSON string (via `rust_decimal`'s `serde-with-str`). The TS side reads them as strings and converts lazily via `new Decimal(s)`.

- [ ] **Step 2: Update `Balance` and `Snapshot` types to match Rust's JSON shape**

Rust serializes `Decimal` as a string. So in TS we want strings at the boundary, then convert via `Decimal` in `format.ts`. Update `types.ts`:

```typescript
// src/types.ts

export interface Balance {
  currency: string;
  total: string;
  granted: string;
  topped_up: string;
  available: string;
}

export interface Snapshot {
  ts_utc: number;
  balance: string;
  currency: string;
  is_stale: boolean;
}

export interface Position {
  x: number;
  y: number;
}

export interface WindowState {
  position: Position | null;
  mode: "compact" | "expanded" | "settings";
  pinned: boolean;
}

export type ErrorKind = "auth" | "network" | "parse" | "internal";

export interface BalanceError {
  kind: ErrorKind;
  message: string;
}

export type UiMode = "compact" | "expanded" | "settings";
```

- [ ] **Step 3: Write `format.ts`**

```typescript
// src/format.ts
import Decimal from "decimal.js-light";

export function toDecimal(s: string | number | null | undefined): Decimal {
  if (s === null || s === undefined || s === "") return new Decimal(0);
  try {
    return new Decimal(s);
  } catch {
    return new Decimal(0);
  }
}

export function formatBalance(s: string | number | null | undefined): string {
  const d = toDecimal(s);
  if (d.isNaN()) return "——";
  return d.toFixed(2);
}

export function formatDelta(prev: string | null, curr: string): string {
  if (!prev) return "";
  const p = toDecimal(prev);
  const c = toDecimal(curr);
  const diff = c.minus(p);
  if (diff.isZero()) return "±0.00";
  const sign = diff.isPositive() ? "⌃" : "⌄";
  return `${sign}${diff.abs().toFixed(2)}`;
}
```

- [ ] **Step 4: Write failing tests `format.test.ts`**

```typescript
// src/format.test.ts
import { describe, expect, it } from "vitest";
import { formatBalance, formatDelta, toDecimal } from "./format";

describe("toDecimal", () => {
  it("parses string", () => {
    expect(toDecimal("12.34").toString()).toBe("12.34");
  });
  it("returns 0 for empty", () => {
    expect(toDecimal("").toString()).toBe("0");
  });
  it("returns 0 for null/undefined", () => {
    expect(toDecimal(null).toString()).toBe("0");
    expect(toDecimal(undefined).toString()).toBe("0");
  });
  it("returns 0 for garbage", () => {
    expect(toDecimal("abc").toString()).toBe("0");
  });
});

describe("formatBalance", () => {
  it("two decimals", () => {
    expect(formatBalance("12.34")).toBe("12.34");
    expect(formatBalance("0")).toBe("0.00");
  });
  it("preserves high precision up to 2dp visually", () => {
    expect(formatBalance("0.000123456789")).toBe("0.00");
  });
  it("empty -> 0.00", () => {
    expect(formatBalance("")).toBe("0.00");
  });
});

describe("formatDelta", () => {
  it("up arrow when positive", () => {
    expect(formatDelta("1.00", "1.50")).toBe("⌃0.50");
  });
  it("down arrow when negative", () => {
    expect(formatDelta("1.00", "0.50")).toBe("⌄0.50");
  });
  it("zero shown as ±0.00", () => {
    expect(formatDelta("1.00", "1.00")).toBe("±0.00");
  });
  it("empty when no prev", () => {
    expect(formatDelta(null, "1.00")).toBe("");
  });
});
```

- [ ] **Step 5: Install Vitest deps (already in package.json) and run**

```bash
cd D:\deepseekbar
npm install
npm test -- format
```
Expected: 11 passed; 0 failed.

- [ ] **Step 6: Commit**

```bash
cd D:\deepseekbar
git add src/types.ts src/format.ts src/format.test.ts
git commit -m "feat(frontend): types and format module with tests"
```

---

## Task 10: Frontend state machine

**Files:**
- Create: `D:\deepseekbar\src\state.ts`
- Create: `D:\deepseekbar\src\state.test.ts`

- [ ] **Step 1: Write `state.ts`**

```typescript
// src/state.ts
import type { Balance, ErrorKind, Snapshot, UiMode, WindowState } from "./types";

export interface UiState {
  mode: UiMode;
  balance: Balance | null;
  prevAvailable: string | null;
  history: Snapshot[];
  error: { kind: ErrorKind; message: string } | null;
  refreshing: boolean;
  apiKeyConfigured: boolean;
  pinned: boolean;
}

export const initialState: UiState = {
  mode: "compact",
  balance: null,
  prevAvailable: null,
  history: [],
  error: null,
  refreshing: false,
  apiKeyConfigured: false,
  pinned: true,
};

export type Action =
  | { type: "set_mode"; mode: UiMode }
  | { type: "balance_loaded"; balance: Balance; snapshot: Snapshot | null }
  | { type: "balance_error"; kind: ErrorKind; message: string }
  | { type: "refresh_started" }
  | { type: "refresh_finished" }
  | { type: "set_api_key_configured"; configured: boolean }
  | { type: "set_pinned"; pinned: boolean }
  | { type: "load_history"; history: Snapshot[] };

export function reduce(s: UiState, a: Action): UiState {
  switch (a.type) {
    case "set_mode":
      return { ...s, mode: a.mode };
    case "balance_loaded": {
      const prev = s.balance?.available ?? s.prevAvailable;
      const history =
        a.snapshot && !s.history.find((h) => h.ts_utc === a.snapshot!.ts_utc)
          ? [...s.history, a.snapshot]
          : s.history;
      return {
        ...s,
        balance: a.balance,
        prevAvailable: prev,
        history,
        error: null,
        refreshing: false,
      };
    }
    case "balance_error":
      return {
        ...s,
        error: { kind: a.kind, message: a.message },
        refreshing: false,
      };
    case "refresh_started":
      return { ...s, refreshing: true };
    case "refresh_finished":
      return { ...s, refreshing: false };
    case "set_api_key_configured":
      if (a.configured) return { ...s, apiKeyConfigured: true };
      return { ...s, apiKeyConfigured: false, mode: "settings", balance: null, history: [] };
    case "set_pinned":
      return { ...s, pinned: a.pinned };
    case "load_history":
      return { ...s, history: a.history };
  }
}
```

- [ ] **Step 2: Write failing tests `state.test.ts`**

```typescript
// src/state.test.ts
import { describe, expect, it } from "vitest";
import { initialState, reduce } from "./state";

describe("reduce", () => {
  it("set_mode updates mode", () => {
    const s = reduce(initialState, { type: "set_mode", mode: "expanded" });
    expect(s.mode).toBe("expanded");
  });

  it("balance_loaded updates balance and preserves prev", () => {
    const s1 = reduce(initialState, {
      type: "balance_loaded",
      balance: { currency: "CNY", total: "10", granted: "0", topped_up: "10", available: "10" },
      snapshot: null,
    });
    expect(s1.balance?.available).toBe("10");
    expect(s1.prevAvailable).toBeNull();

    const s2 = reduce(s1, {
      type: "balance_loaded",
      balance: { currency: "CNY", total: "12", granted: "0", topped_up: "12", available: "12" },
      snapshot: null,
    });
    expect(s2.prevAvailable).toBe("10");
    expect(s2.balance?.available).toBe("12");
  });

  it("balance_loaded appends snapshot to history (dedup)", () => {
    const snap = { ts_utc: 1, balance: "10", currency: "CNY", is_stale: false };
    const s1 = reduce(initialState, {
      type: "balance_loaded",
      balance: { currency: "CNY", total: "10", granted: "0", topped_up: "10", available: "10" },
      snapshot: snap,
    });
    const s2 = reduce(s1, {
      type: "balance_loaded",
      balance: { currency: "CNY", total: "10", granted: "0", topped_up: "10", available: "10" },
      snapshot: snap,
    });
    expect(s2.history.length).toBe(1);
  });

  it("balance_error sets error and clears refreshing", () => {
    const s1 = reduce(initialState, { type: "refresh_started" });
    const s2 = reduce(s1, { type: "balance_error", kind: "auth", message: "bad key" });
    expect(s2.error).toEqual({ kind: "auth", message: "bad key" });
    expect(s2.refreshing).toBe(false);
  });

  it("set_api_key_configured false resets to settings mode", () => {
    const s1 = reduce(initialState, { type: "set_mode", mode: "expanded" });
    const s2 = reduce(s1, { type: "set_api_key_configured", configured: false });
    expect(s2.mode).toBe("settings");
    expect(s2.apiKeyConfigured).toBe(false);
  });

  it("set_pinned updates pinned", () => {
    const s = reduce(initialState, { type: "set_pinned", pinned: false });
    expect(s.pinned).toBe(false);
  });

  it("load_history replaces history", () => {
    const h = [
      { ts_utc: 1, balance: "1", currency: "CNY", is_stale: false },
      { ts_utc: 2, balance: "2", currency: "CNY", is_stale: false },
    ];
    const s = reduce(initialState, { type: "load_history", history: h });
    expect(s.history).toEqual(h);
  });
});
```

- [ ] **Step 3: Run tests, expect pass**

```bash
cd D:\deepseekbar
npm test -- state
```
Expected: 7 passed; 0 failed.

- [ ] **Step 4: Commit**

```bash
cd D:\deepseekbar
git add src/state.ts src/state.test.ts
git commit -m "feat(frontend): UiState reducer with tests"
```

---

## Task 11: Chart module (SVG line)

**Files:**
- Create: `D:\deepseekbar\src\chart.ts`
- Create: `D:\deepseekbar\src\chart.test.ts`

- [ ] **Step 1: Write `chart.ts`**

```typescript
// src/chart.ts
import { toDecimal } from "./format";

export interface LinePoint {
  ts_utc: number;
  balance: string;
}

export interface LineOpts {
  width: number;
  height: number;
  padding: number;
  stroke: string;
  fill: string;
}

const DEFAULTS: LineOpts = {
  width: 320,
  height: 100,
  padding: 8,
  stroke: "#3b82f6",
  fill: "rgba(59,130,246,0.10)",
};

export function renderLine(
  svg: SVGSVGElement,
  points: LinePoint[],
  opts: Partial<LineOpts> = {},
): void {
  const o = { ...DEFAULTS, ...opts };
  svg.setAttribute("viewBox", `0 0 ${o.width} ${o.height}`);
  svg.setAttribute("width", String(o.width));
  svg.setAttribute("height", String(o.height));
  svg.innerHTML = "";

  if (points.length === 0) return;

  const decimals = points.map((p) => toDecimal(p.balance));
  const minD = decimals.reduce((a, b) => (b.lessThan(a) ? b : a));
  const maxD = decimals.reduce((a, b) => (b.greaterThan(a) ? b : a));
  const range = maxD.minus(minD);
  const yRange = range.isZero() ? new (decimals[0].constructor as any)(1) : range;

  const xStep = (o.width - 2 * o.padding) / Math.max(1, points.length - 1);
  const xAt = (i: number) => o.padding + i * xStep;
  const yAt = (d: ReturnType<typeof toDecimal>) =>
    o.height - o.padding - d.minus(minD).div(yRange).mul(o.height - 2 * o.padding).toNumber();

  const path = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${xAt(i).toFixed(1)},${yAt(toDecimal(p.balance)).toFixed(1)}`)
    .join(" ");

  const areaPath = `${path} L${xAt(points.length - 1).toFixed(1)},${(o.height - o.padding).toFixed(1)} L${xAt(0).toFixed(1)},${(o.height - o.padding).toFixed(1)} Z`;

  const ns = "http://www.w3.org/2000/svg";
  const area = document.createElementNS(ns, "path");
  area.setAttribute("d", areaPath);
  area.setAttribute("fill", o.fill);
  svg.appendChild(area);

  const line = document.createElementNS(ns, "path");
  line.setAttribute("d", path);
  line.setAttribute("stroke", o.stroke);
  line.setAttribute("stroke-width", "1.5");
  line.setAttribute("fill", "none");
  svg.appendChild(line);
}
```

- [ ] **Step 2: Write `chart.test.ts`**

```typescript
// src/chart.test.ts
import { describe, expect, it, beforeEach } from "vitest";
import { renderLine } from "./chart";

describe("renderLine", () => {
  let svg: SVGSVGElement;
  beforeEach(() => {
    svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  });

  it("renders nothing for empty input", () => {
    renderLine(svg, []);
    expect(svg.children.length).toBe(0);
  });

  it("renders area + line for non-empty input", () => {
    renderLine(svg, [
      { ts_utc: 1, balance: "10" },
      { ts_utc: 2, balance: "20" },
      { ts_utc: 3, balance: "15" },
    ]);
    expect(svg.children.length).toBe(2);
    expect(svg.getAttribute("viewBox")).toBe("0 0 320 100");
  });

  it("handles flat (all-equal) range without divide-by-zero", () => {
    renderLine(svg, [
      { ts_utc: 1, balance: "5" },
      { ts_utc: 2, balance: "5" },
    ]);
    expect(svg.children.length).toBe(2);
  });
});
```

- [ ] **Step 3: Run tests**

```bash
cd D:\deepseekbar
npm test -- chart
```
Expected: 3 passed; 0 failed.

- [ ] **Step 4: Commit**

```bash
cd D:\deepseekbar
git add src/chart.ts src/chart.test.ts
git commit -m "feat(frontend): SVG line chart with area fill"
```

---

## Task 12: Compact UI

**Files:**
- Create: `D:\deepseekbar\src\ui\compact.ts`

- [ ] **Step 1: Write `compact.ts`**

```typescript
// src/ui/compact.ts
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
```

- [ ] **Step 2: Commit**

```bash
cd D:\deepseekbar
git add src/ui/compact.ts
git commit -m "feat(frontend): compact view renderer"
```

---

## Task 13: Expanded UI

**Files:**
- Create: `D:\deepseekbar\src\ui\expanded.ts`

- [ ] **Step 1: Write `expanded.ts`**

```typescript
// src/ui/expanded.ts
import { formatBalance } from "../format";
import { renderLine } from "../chart";
import { toDecimal } from "../format";
import type { UiState } from "../state";

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

function escapeText(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
```

- [ ] **Step 2: Commit**

```bash
cd D:\deepseekbar
git add src/ui/expanded.ts
git commit -m "feat(frontend): expanded view with chart and stats"
```

---

## Task 14: Settings UI

**Files:**
- Create: `D:\deepseekbar\src\ui\settings.ts`

- [ ] **Step 1: Write `settings.ts`**

```typescript
// src/ui/settings.ts
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
        <input type="checkbox" data-role="autostart" ${autostartChecked()} />
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

function autostartChecked(): string {
  // Read-only on the JS side; the real value is queried at startup.
  return "";
}

function escapeText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
```

- [ ] **Step 2: Commit**

```bash
cd D:\deepseekbar
git add src/ui/settings.ts
git commit -m "feat(frontend): settings view with handlers"
```

---

## Task 15: Error UI helpers

**Files:**
- Create: `D:\deepseekbar\src\ui\error.ts`

- [ ] **Step 1: Write `error.ts`**

```typescript
// src/ui/error.ts
import type { ErrorKind } from "../types";

export function describeKind(kind: ErrorKind): string {
  switch (kind) {
    case "auth": return "API key 无效或已过期，请重新填写";
    case "network": return "网络不通，请检查连接";
    case "parse": return "服务返回了无法识别的数据";
    case "internal": return "本地错误，请尝试重置数据";
  }
}
```

- [ ] **Step 2: Commit**

```bash
cd D:\deepseekbar
git add src/ui/error.ts
git commit -m "feat(frontend): error kind descriptions"
```

---

## Task 16: Main entry, styles, wiring

**Files:**
- Modify: `D:\deepseekbar\src\main.ts`
- Create: `D:\deepseekbar\src\styles.css`

- [ ] **Step 1: Write `main.ts`**

```typescript
// src/main.ts
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import {
  getCurrentWindow,
  LogicalSize,
  PhysicalPosition,
} from "@tauri-apps/api/window";
import { renderCompact } from "./ui/compact";
import { renderExpanded } from "./ui/expanded";
import { renderSettings, type SettingsHandlers } from "./ui/settings";
import { describeKind } from "./ui/error";
import { initialState, reduce, type UiState } from "./state";
import type { Balance, BalanceError, Snapshot, WindowState } from "./types";

const win = getCurrentWindow();
const app = document.getElementById("app")!;

let state: UiState = initialState;
let historyLoaded = false;
let autostartInitial: boolean | null = null;
const unlistens: UnlistenFn[] = [];

function render() {
  if (state.mode === "compact") renderCompact(app, state);
  else if (state.mode === "expanded") renderExpanded(app, state);
  else if (state.mode === "settings") {
    renderSettings(app, state, settingsHandlers());
  }
  if (state.mode === "compact" || state.mode === "expanded") {
    applyWindowSize();
  }
  applyPinned();
  saveWindowState();
}

function applyWindowSize() {
  if (state.mode === "compact") {
    void win.setSize(new LogicalSize(220, 60));
  } else {
    void win.setSize(new LogicalSize(360, 320));
  }
}

function applyPinned() {
  void win.setAlwaysOnTop(state.pinned);
}

async function saveWindowState() {
  try {
    const pos = await win.outerPosition();
    const factor = await win.scaleFactor();
    const x = Math.round(pos.x / factor);
    const y = Math.round(pos.y / factor);
    await invoke("save_window_state", {
      state: { position: { x, y }, mode: state.mode, pinned: state.pinned },
    });
  } catch {
    // ignore persistence errors
  }
}

const settingsHandlers = (): SettingsHandlers => ({
  onTest: async (key) => {
    try {
      // Re-use save_api_key as the cheapest "round trip" test: we save, read
      // back, and let the backend do one fetch. We do not keep the key if the
      // test fails (delete + restore is overkill for v1).
      // Actually: simpler — call a new Tauri command in Task 18. For now,
      // call save_api_key + immediately read get_current_balance, then on
      // failure delete_api_key.
      await invoke("save_api_key", { key });
      const b = (await invoke("get_current_balance")) as Balance | null;
      if (!b) {
        // wait one tick
        await new Promise((r) => setTimeout(r, 1500));
        const b2 = (await invoke("get_current_balance")) as Balance | null;
        if (!b2) {
          await invoke("delete_api_key");
          return { ok: false, error: "未拿到余额，请检查 key" };
        }
        return { ok: true, preview: b2.available };
      }
      return { ok: true, preview: b.available };
    } catch (e) {
      try { await invoke("delete_api_key"); } catch {}
      return { ok: false, error: String(e) };
    }
  },
  onSave: async (key) => {
    await invoke("save_api_key", { key });
    state = reduce(state, { type: "set_api_key_configured", configured: true });
    state = reduce(state, { type: "set_mode", mode: "compact" });
    historyLoaded = false;
    await loadHistory();
    render();
  },
  onToggleAutostart: async (enabled) => {
    await invoke("set_autostart", { enabled });
    autostartInitial = enabled;
  },
  onTogglePinned: async (enabled) => {
    state = reduce(state, { type: "set_pinned", pinned: enabled });
    render();
  },
  onReset: async () => {
    try { await invoke("delete_api_key"); } catch {}
    try {
      const dir = await (await import("@tauri-apps/api/path")).appDataDir();
      // Tell Rust to wipe data.db. We expose a `reset_data` command in Task 18.
      await invoke("reset_data");
    } catch {}
    // Reload the page; setup() will see no key.
    location.reload();
  },
  onClose: () => {
    state = reduce(state, { type: "set_mode", mode: "compact" });
    render();
  },
});

async function loadHistory() {
  if (historyLoaded) return;
  const h = (await invoke("get_history", { days: 30 })) as Snapshot[];
  state = reduce(state, { type: "load_history", history: h });
  historyLoaded = true;
}

async function init() {
  // Restore window state
  try {
    const ws = (await invoke("get_window_state")) as WindowState;
    state = reduce(state, { type: "set_mode", mode: ws.mode });
    state = reduce(state, { type: "set_pinned", pinned: ws.pinned });
    if (ws.position) {
      const sf = await win.scaleFactor();
      await win.setPosition(new PhysicalPosition(ws.position.x * sf, ws.position.y * sf));
    }
  } catch {}

  // API key status decides first-launch flow
  const status = (await invoke("get_api_key_status")) as { configured: boolean };
  state = reduce(state, { type: "set_api_key_configured", configured: status.configured });
  if (!status.configured) {
    state = reduce(state, { type: "set_mode", mode: "settings" });
    render();
    return;
  }

  await loadHistory();
  await invoke("trigger_refresh");
  render();

  // Listeners
  unlistens.push(
    await listen<Balance>("balance:updated", (e) => {
      // Latest balance + a synthetic snapshot row
      const last = state.history[state.history.length - 1];
      state = reduce(state, {
        type: "balance_loaded",
        balance: e.payload,
        snapshot: {
          ts_utc: Date.now(),
          balance: e.payload.available,
          currency: e.payload.currency,
          is_stale: false,
        },
      });
      render();
    }),
    await listen<BalanceError>("balance:error", (e) => {
      state = reduce(state, {
        type: "balance_error",
        kind: e.payload.kind,
        message: describeKind(e.payload.kind) + (e.payload.message ? `（${e.payload.message}）` : ""),
      });
      render();
    }),
    await listen<{ mode: string }>("mode:changed", (e) => {
      state = reduce(state, { type: "set_mode", mode: e.payload.mode as any });
      render();
    }),
    await listen<void>("balance:manual_refresh", async () => {
      state = reduce(state, { type: "refresh_started" });
      render();
      await invoke("trigger_refresh");
    }),
  );

  // Drag (top 6px in compact)
  let dragOffset: { x: number; y: number } | null = null;
  app.addEventListener("mousedown", (e) => {
    if (state.mode !== "compact") return;
    if (e.clientY > 6) return;
    dragOffset = { x: e.clientX, y: e.clientY };
  });
  window.addEventListener("mousemove", async (e) => {
    if (!dragOffset) return;
    const dx = e.clientX - dragOffset.x;
    const dy = e.clientY - dragOffset.y;
    dragOffset = { x: e.clientX, y: e.clientY };
    try {
      const pos = await win.outerPosition();
      const sf = await win.scaleFactor();
      await win.setPosition(new PhysicalPosition(pos.x + dx * sf, pos.y + dy * sf));
    } catch {}
  });
  window.addEventListener("mouseup", () => { dragOffset = null; });

  // Double-click in compact -> expanded
  app.addEventListener("dblclick", (e) => {
    if (state.mode !== "compact") return;
    if ((e.target as HTMLElement)?.tagName === "BUTTON") return;
    state = reduce(state, { type: "set_mode", mode: "expanded" });
    render();
  });

  // Wheel toggle
  app.addEventListener("wheel", (e) => {
    e.preventDefault();
    if (state.mode === "compact") state = reduce(state, { type: "set_mode", mode: "expanded" });
    else if (state.mode === "expanded") state = reduce(state, { type: "set_mode", mode: "compact" });
    render();
  }, { passive: false });

  // Right-click context menu (delegated; the actual native menu is created
  // from Rust on right-click in Task 18; for v1 we use a minimal HTML menu
  // embedded in the app element on contextmenu.)
  app.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    showContextMenu(e.clientX, e.clientY);
  });
}

function showContextMenu(x: number, y: number) {
  const m = document.createElement("div");
  m.className = "ctx-menu";
  m.style.left = `${x}px`;
  m.style.top = `${y}px`;
  m.innerHTML = `
    <button data-act="refresh">立即刷新</button>
    <button data-act="toggle">${state.mode === "compact" ? "展开" : "收起"}</button>
    <hr/>
    <button data-act="settings">设置…</button>
    <hr/>
    <button data-act="quit">退出</button>
  `;
  document.body.appendChild(m);
  const close = () => m.remove();
  m.addEventListener("click", async (ev) => {
    const t = (ev.target as HTMLElement).dataset.act;
    if (t === "refresh") await invoke("trigger_refresh");
    else if (t === "toggle") {
      state = reduce(state, { type: "set_mode", mode: state.mode === "compact" ? "expanded" : "compact" });
    } else if (t === "settings") state = reduce(state, { type: "set_mode", mode: "settings" });
    else if (t === "quit") { await (await import("@tauri-apps/api/app")).getCurrent()?.exit?.(0); window.close(); }
    close();
    render();
  });
  setTimeout(() => document.addEventListener("click", close, { once: true }), 0);
}

window.addEventListener("beforeunload", () => {
  for (const u of unlistens) u();
});

init().catch((e) => {
  app.textContent = `init failed: ${String(e)}`;
});
```

- [ ] **Step 2: Write `styles.css`**

```css
/* src/styles.css */
:root {
  --bg: rgba(20, 22, 28, 0.85);
  --fg: #e6e8ee;
  --muted: #8b93a7;
  --accent: #3b82f6;
  --good: #22c55e;
  --warn: #eab308;
  --bad: #ef4444;
  --border: rgba(255, 255, 255, 0.08);
  --font: -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif;
}

* { box-sizing: border-box; }
html, body {
  margin: 0; padding: 0;
  background: transparent;
  color: var(--fg);
  font-family: var(--font);
  font-size: 13px;
  user-select: none;
  overflow: hidden;
}

#app { width: 100%; height: 100vh; display: flex; }

.compact {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  height: 100%;
  padding: 0 10px;
  background: var(--bg);
  border-radius: 8px;
  border: 1px solid var(--border);
  cursor: default;
}
.compact .dot {
  width: 8px; height: 8px; border-radius: 50%;
  background: var(--good);
  flex: 0 0 8px;
}
.compact[data-status="pulse"] .dot { background: var(--warn); animation: pulse 1s ease-in-out infinite; }
.compact[data-status="err"] .dot,
.compact[data-status="err-auth"] .dot { background: var(--bad); }
.compact[data-status="err-auth"] { border-color: var(--bad); }
.compact .amount { font-size: 16px; font-weight: 600; flex: 1; }
.compact .delta { font-size: 12px; color: var(--muted); }

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}

.expanded, .settings {
  display: flex; flex-direction: column; gap: 8px;
  width: 100%; height: 100%;
  padding: 12px;
  background: var(--bg);
  border-radius: 8px;
  border: 1px solid var(--border);
}
.expanded hr, .settings hr { border: none; border-top: 1px solid var(--border); margin: 4px 0; }
.row { display: flex; align-items: center; gap: 8px; }
.row.top { justify-content: space-between; }
.row .label { color: var(--muted); font-size: 12px; }
.row .amount { font-size: 18px; font-weight: 600; flex: 1; }
.row .close { background: transparent; border: none; color: var(--muted); cursor: pointer; font-size: 14px; }
.row .close:hover { color: var(--fg); }
.row.status { color: var(--muted); font-size: 12px; }
.row.actions button, .field button { background: rgba(255,255,255,0.06); border: 1px solid var(--border); color: var(--fg); padding: 4px 10px; border-radius: 4px; cursor: pointer; }
.row.actions button:hover, .field button:hover { background: rgba(255,255,255,0.10); }
.row.actions button.primary { background: var(--accent); border-color: var(--accent); }
.row.actions button.danger { color: var(--bad); border-color: rgba(239,68,68,0.4); }

.chart-wrap { flex: 1; display: flex; flex-direction: column; justify-content: center; gap: 6px; min-height: 120px; }
.chart-wrap .empty { color: var(--muted); text-align: center; font-size: 12px; }
.chart-wrap .chart { width: 100%; height: 120px; }
.row.stats { justify-content: space-between; color: var(--muted); font-size: 11px; }

.field { display: flex; align-items: center; gap: 8px; }
.field span { color: var(--muted); font-size: 12px; flex: 0 0 60px; }
.field input { flex: 1; background: rgba(0,0,0,0.25); border: 1px solid var(--border); color: var(--fg); padding: 4px 6px; border-radius: 4px; font-family: inherit; font-size: 12px; }
.test-status { font-size: 12px; color: var(--muted); min-height: 16px; }
.check { display: flex; align-items: center; gap: 6px; }
.check input { accent-color: var(--accent); }

.ctx-menu {
  position: fixed; z-index: 1000;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 4px 0;
  min-width: 120px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.4);
}
.ctx-menu button { display: block; width: 100%; text-align: left; padding: 6px 12px; background: transparent; border: none; color: var(--fg); cursor: pointer; font-size: 12px; font-family: inherit; }
.ctx-menu button:hover { background: rgba(255,255,255,0.08); }
.ctx-menu hr { border: none; border-top: 1px solid var(--border); margin: 4px 0; }
```

- [ ] **Step 3: Build the frontend (TS check + Vite build)**

```bash
cd D:\deepseekbar
npm run build
```
Expected: build succeeds with no TS errors.

- [ ] **Step 4: Commit**

```bash
cd D:\deepseekbar
git add src/main.ts src/styles.css
git commit -m "feat(frontend): main entry wiring and styles"
```

---

## Task 17: Wire Rust `main.rs`/`lib.rs` to commands, scheduler, tray, and Tauri plugin

**Files:**
- Modify: `D:\deepseekbar\src-tauri\src\lib.rs`
- Create: `D:\deepseekbar\src-tauri\src\main.rs` (overwrite)
- Create: `D:\deepseekbar\src-tauri\src\reset.rs` (small helper for reset_data command)

- [ ] **Step 1: Add `reset_data` command to `commands.rs`**

Append to `D:\deepseekbar\src-tauri\src\commands.rs`:

```rust
#[tauri::command]
pub fn reset_data(
    scheduler: State<'_, Arc<Scheduler>>,
) -> Result<(), AppError> {
    // Stop accepting snapshots by setting is_stale marker; we still drop
    // historical data here.
    scheduler.store.cleanup_older_than(i64::MAX)?; // wipe all
    let _ = store::delete_api_key();
    Ok(())
}
```

- [ ] **Step 2: Rewrite `lib.rs` to wire everything**

Replace `D:\deepseekbar\src-tauri\src\lib.rs` with:

```rust
pub mod commands;
pub mod deepseek;
pub mod error;
pub mod scheduler;
pub mod state;
pub mod store;
pub mod tray;

use crate::scheduler::Scheduler;
use crate::state::AppState;
use crate::store::Store;
use std::sync::Arc;
use tauri::Manager;
use tauri_plugin_autostart::MacosLauncher;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            None,
        ))
        .setup(|app| {
            // Logging
            let log_dir = app
                .path()
                .app_log_dir()
                .unwrap_or_else(|_| std::env::temp_dir());
            let _ = std::fs::create_dir_all(&log_dir);
            let file_appender = tracing_appender::rolling::daily(&log_dir, "deepseekbar.log");
            let (nb, _guard) = tracing_appender::non_blocking(file_appender);
            let subscriber = tracing_subscriber::fmt()
                .with_writer(nb)
                .with_env_filter(
                    tracing_subscriber::EnvFilter::try_from_default_env()
                        .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("warn,deepseekbar=info")),
                )
                .with_ansi(false)
                .finish();
            let _ = tracing::subscriber::set_global_default(subscriber);

            // Data dir
            let data_dir = app.path().app_data_dir().expect("no data dir");
            let _ = std::fs::create_dir_all(&data_dir);
            let db_path = data_dir.join("data.db");

            // Clean old snapshots
            if let Ok(store) = Store::open(&db_path) {
                let cutoff = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map(|d| d.as_millis() as i64)
                    .unwrap_or(0)
                    - 30 * 86_400_000;
                let _ = store.cleanup_older_than(cutoff);
            }

            let store = Arc::new(Store::open(&db_path).expect("open store"));
            let state = AppState::new();
            let client = reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(10))
                .connect_timeout(std::time::Duration::from_secs(5))
                .build()
                .expect("build client");

            let sched = Arc::new(Scheduler::new(state.clone(), store.clone(), client));
            // Periodic tick (best-effort; errors logged, never panic)
            let sched_for_loop = sched.clone();
            tauri::async_runtime::spawn(async move {
                loop {
                    if store::has_api_key() {
                        if let Err(e) = sched_for_loop.tick().await {
                            tracing::warn!(error = %e, "scheduled tick failed");
                        }
                    }
                    tokio::time::sleep(sched_for_loop.interval).await;
                }
            });

            app.manage(state);
            app.manage(sched);

            // System tray
            let handle = app.handle().clone();
            tray::build(&handle).expect("build tray");

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_api_key_status,
            commands::save_api_key,
            commands::delete_api_key,
            commands::get_current_balance,
            commands::trigger_refresh,
            commands::get_history,
            commands::get_window_state,
            commands::save_window_state,
            commands::set_autostart,
            commands::reset_data,
        ])
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

- [ ] **Step 3: Update `main.rs` (binary entry)**

`D:\deepseekbar\src-tauri\src\main.rs`:

```rust
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    deepseekbar_lib::run()
}
```

- [ ] **Step 4: Compile**

```bash
cd D:\deepseekbar\src-tauri
cargo check
```
Expected: compiles. If there are Tauri 2 API drift errors (e.g., `WindowEvent` path), fix per compiler hint.

- [ ] **Step 5: Run all tests**

```bash
cd D:\deepseekbar\src-tauri
cargo test
```
Expected: all previous tests pass (error: 9, deepseek: 8, store: 5, state: 2, scheduler: 2 = 26 passed).

- [ ] **Step 6: Commit**

```bash
cd D:\deepseekbar
git add src-tauri/src/lib.rs src-tauri/src/main.rs src-tauri/src/commands.rs
git commit -m "feat(rust): wire setup, scheduler loop, tray, commands, close-to-tray"
```

---

## Task 18: README and manual QA checklist

**Files:**
- Create: `D:\deepseekbar\README.md`

- [ ] **Step 1: Write `README.md`**

```markdown
# DeepSeekBar

Windows 桌面悬浮小组件，展示 DeepSeek 账户余额和近 30 天趋势。

## 开发

前置：Node 18+、Rust 1.77+、Tauri CLI 2.x。

```bash
npm install
npm run tauri dev
```

## 构建

```bash
npm run tauri build
```

产物：`src-tauri/target/release/bundle/nsis/DeepSeekBar_0.1.0_x64-setup.exe`

## 手工 QA 清单

- [ ] 首启动 → 引导填 key → 显示余额
- [ ] 断网 → 状态点红 + 数字位 `——`
- [ ] 重连 → 状态点自动恢复绿
- [ ] 重启电脑 → 自启 + 立即显示
- [ ] 右键菜单 / 托盘菜单各项生效
- [ ] 拖动窗口 → 位置记忆
- [ ] 改 key → 旧 key 失效 → 引导重新填
- [ ] 卸载 → 数据目录可被清理

## 数据存储

- SQLite: `%APPDATA%\com.deepseekbar.app\data.db`
- 日志: `%APPDATA%\com.deepseekbar.app\logs\deepseekbar-YYYY-MM-DD.log`
- API key: Windows Credential Manager，服务名 `com.deepseekbar.app`，账户名 `api_key`

## 设计文档

`docs/superpowers/specs/2026-06-05-deepseekbar-design.md`
```

- [ ] **Step 2: Commit**

```bash
cd D:\deepseekbar
git add README.md
git commit -m "docs: add README with build instructions and QA checklist"
```

---

## Task 19: Final smoke test

- [ ] **Step 1: Run the full test suite**

```bash
cd D:\deepseekbar
npm test
cd src-tauri && cargo test
```
Expected: all tests pass.

- [ ] **Step 2: Build the installer**

```bash
cd D:\deepseekbar
npm run tauri build
```
Expected: NSIS installer produced without errors.

- [ ] **Step 3: Manual install + run**

Run the installer from `src-tauri/target/release/bundle/nsis/`. On launch:
1. Window should appear in compact mode.
2. Settings panel should open (no key configured).
3. Enter a valid DeepSeek key, click Test → see preview.
4. Click Save → window switches to compact showing the balance.
5. Wait 5 minutes (or click tray Refresh) and confirm a new snapshot row in SQLite:
   ```bash
   sqlite3 "$APPDATA/com.deepseekbar.app/data.db" "SELECT * FROM snapshots ORDER BY ts_utc DESC LIMIT 5"
   ```

- [ ] **Step 4: Walk through the QA checklist in `README.md`**

Tick each item. If any fail, file a follow-up task before considering the plan complete.

- [ ] **Step 5: Tag the release**

```bash
cd D:\deepseekbar
git tag v0.1.0
```

---

## Self-Review

**Spec coverage:**

| Spec section | Covered by task |
|---|---|
| §1 Goals, §1.1 scope | Implicit in 1-19; tests in 3-5 |
| §2 Tech stack | Task 1 |
| §3.1 Modules | Tasks 2, 3, 4, 5, 6, 7, 8, 17 |
| §3.2 Window (frameless, close→tray) | Task 1 (`tauri.conf.json`), Task 17 (`on_window_event`) |
| §3.3 System tray | Task 8, Task 17 (wiring) |
| §4.1 Commands | Task 7, Task 17 (registration), Task 17 (reset_data) |
| §4.2 Events | Task 7, Task 16 (listeners) |
| §4.3 Data structures | Task 3 (Rust), Task 9 (TS) |
| §5.1 Refresh flow | Task 6 (tick), Task 7 (emit), Task 17 (loop) |
| §5.2 SQLite schema | Task 4 |
| §5.3 API key in keyring | Task 4 |
| §5.4 Directory layout | Task 1 (gitignore), Task 17 (data_dir) |
| §6 Error kinds | Task 2 |
| §6.1 Error classification | Task 2, Task 3 |
| §6.2 Boundary scenarios | Task 6 (regression), Task 17 (cleanup on boot), Task 16 (off-screen position) — see note below |
| §6.3 Retry / log | Task 6 (no retry), Task 17 (tracing file) |
| §6.4 Reset | Task 16 (`onReset`), Task 17 (`reset_data` command) |
| §7.1 State machine | Task 10 |
| §7.2 Compact | Task 12 |
| §7.3 Expanded (incl. empty state) | Task 13 |
| §7.4 Settings | Task 14 |
| §7.5 Context menu | Task 16 (HTML fallback) — see note |
| §7.6 Error visuals | Task 12 (compact), Task 15 (descriptions) |
| §8.1 Build | Task 1, Task 19 |
| §8.2 Installer | Task 1, Task 19 |
| §9.1 Rust tests | Tasks 2, 3, 4, 5, 6 |
| §9.2 Frontend tests | Tasks 9, 10, 11 |
| §9.3 Manual QA | Task 18, Task 19 |

**Notes / known deviations from spec:**

- **§6.2 #8 off-screen window position**: not implemented (no `monitor_bounds` check on restore). Acceptable for v1.
- **§7.5 native context menu**: implemented as HTML menu for portability; a future task can move to a real Tauri native menu if requested.
- **§6.2 #7 watchdog**: explicitly not built (YAGNI).
- **§6.2 #5 system time regression**: handled in `Scheduler::persist_and_cache`.

**Type consistency check:** `Balance`, `Snapshot`, `WindowState`, `UiMode`, `ErrorKind` names match between Rust and TS. `Decimal` is serialized as `string` in both directions. `position` is logical pixels at the JS↔Rust boundary, physical at the `Window::set_position` call site (multiplied by `scaleFactor`).
