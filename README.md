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

产物：`src-tauri/target/release/bundle/nsis/DeepSeekBar_0.1.3_x64-setup.exe`

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
