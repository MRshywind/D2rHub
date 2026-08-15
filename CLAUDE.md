# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

D2RHub 是《暗黑破坏神 II：重制版》的 Windows 桌面多账号管理器与 OCR 刷图助手。基于 **Tauri v2** (Rust 后端 + React 前端)，仅支持 Windows 10/11。

## 常用命令

```powershell
# 前端开发服务器 (Vite, port 1420)
npm run dev

# TypeScript 类型检查 + 生产构建
npm run build

# 前端快捷键单元测试
npm test

# Rust 库测试
cd src-tauri && cargo test --lib && cd ..

# 构建完整版 (含 OCR/PaddleOCR)
npm run build:full

# 构建 Lite 版 (不含 OCR)
npm run build:lite

# 安装依赖
npm ci
```

**注意**: 完整 OCR 构建依赖 PaddleOCR 模型和 `ort`，首次冷编译需要数分钟。纯前端改动只需 `npm run build`；涉及 Rust 代码必须 `cargo test --lib`。

## 技术架构

### 整体分层

```
┌─ React 前端 (src/) ─────────────────────────────────┐
│  Zustand stores ←→ Tauri invoke() ←→ Tauri events   │
├─ Tauri/ Rust 后端 (src-tauri/src/) ──────────────────┤
│  commands/ (按域拆分) + OCR 引擎 + 数据统计          │
├─ 平台层 (Windows) ───────────────────────────────────┤
│  多开句柄清理 / 注册表隔离 / 窗口管理 / 全局输入监听 │
└──────────────────────────────────────────────────────┘
```

### 前端 (`src/`)

- **状态管理**: [Zustand](https://github.com/pmndrs/zustand) stores — `accounts.ts`, `globalConfig.ts`, `launch.ts`, `theme.ts`, `stats.ts`, `catSkin.ts`
- **页面/视图**: `App.tsx` 作为根组件，根据配置状态切换 `loading` → `setup` (SetupWizard) → `main` (Dashboard)
- **路由模式**: 无路由库；通过 React state (`view.type`) 控制顶层视图，通过 `showAbout`/`showSettings` 等状态控制模态窗口
- **组件结构**: `components/dashboard/` (AccountCard, AccountGrid, ActionBar), `components/config/` (ConfigModal, SettingsCenter), `components/ui/` (Button, Input, Modal, Toast, Toggle), `components/Launch/` (LaunchProgress)
- **多窗口入口**: Vite 构建 `index.html`, `overlay.html`, `bongo-cat.html` 三个入口，对应 Tauri 配置中的 `main`, `overlay`, `bongo-cat` 三个 WebView 窗口

### 后端 (`src-tauri/src/`)

- **入口**: `lib.rs` — 单实例互斥体检查 → 日志初始化 → 加载 AppState → 注册所有 Tauri commands → 多窗口管理 → 托盘创建 → 输入监听
- **命令模块** (`commands/`): 按业务域拆分，每个模块通过 `#[tauri::command]` 暴露函数给前端：
  - `account.rs` — 账号的 CRUD、注册表隔离、存档目录管理、窗口位置
  - `launch.rs` — 多账号一键启动的完整流程（句柄清除 → 战网登录 → 游戏启动 → 连接检测），支持取消
  - `settings.rs` — D2R `Settings.json` 图形化编辑器
  - `global_config.rs` — 全局配置读写、路径检测
  - `system.rs` — 进程管理、窗口操作、管理员检测、更新安装
  - `browser.rs` — 浏览器启动用于 Token 登录
  - `terror_zone.rs` — 恐怖地带信息接口
  - `crypto.rs` / `utils.rs` — 加密工具和通用辅助
- **共享状态** (`state.rs`): `AppState` 通过 Tauri `manage()` 注入，包含全局配置 (`RwLock<Option<GlobalConfig>>`)、取消标志 (`AtomicBool`)、活跃游戏 PID 映射 (`RwLock<HashMap<String, u32>>`)、快捷键映射
- **OCR 引擎** (`ocr/`): 仅在 `#[cfg(feature = "ocr")]` 时编译。`mod.rs` 管理 OCR 工作线程生命周期；`pipeline.rs` 编排截图 → 预处理 → PaddleOCR 识别 → 模糊匹配；`engine.rs` 封装 PaddleOCR 实例；`capturer.rs` 通过 Windows Graphics Capture API 截图
- **数据统计** (`stats.rs`): SQLite (rusqlite) 存储刷图记录和符文掉落
- **全局输入监听** (`input_listener.rs`): Windows 低级键盘钩子，用于全局快捷键和 Bongo Cat 键盘同步
- **错误处理** (`error.rs`): `AppError` 枚举，实现 `Serialize`/`Deserialize`，错误信息统一中文

### 关键设计模式

1. **特征门控双版本**: Cargo feature `ocr` 控制是否编译 OCR 和统计模块；前端通过 `VITE_ENABLE_OCR` 环境变量在构建时决定是否包含 OCR 相关 UI
2. **启动流程 (Launch Flow)**: `launch_accounts` 是串行流程 — 为每个账号依次执行「复制注册表隔离 → 启动战网 → 等待登录 → 启动 D2R → 清除多开句柄 → 检测连接服务器」。整个流程可通过 `cancel_launch` 异步中断
3. **多开原理**: 通过 Windows API (`CloseHandle`/`DuplicateHandle`) 关闭 D2R 创建的 `"DiabloII Check For Other Instances"` 命名互斥体，**不修改游戏文件、不注入内存、不注入 DLL**
4. **注册表隔离**: 每个账号维护独立的注册表快照，启动前恢复对应账号的注册表配置，实现不同账号使用不同的 Battle.net 区域/Token/语言设置
5. **OCR 工作线程**: OCR 引擎在独立的 MTA 线程运行（Windows COM 要求），通过 `OnceLock<Mutex<>>` 环形缓冲区与 Tauri 主线程通信，前端通过 `get_ocr_ch_a_results`/`get_ocr_ch_b_results` 轮询获取结果
6. **多窗口通信**: 主窗口关闭时隐藏到托盘并显示 Overlay 悬浮窗；配置变更通过 Tauri events (`global-config-updated`) 跨窗口同步

### 构建变体

| 变体 | 命令 | 特征 |
|------|------|------|
| 完整版 | `build:full` | `VITE_ENABLE_OCR=true`, Cargo default features (含 `ocr`) |
| Lite 版 | `build:lite` | `VITE_ENABLE_OCR=false`, `--no-default-features`, 自定义 `tauri.lite.conf.json` |

## 开发约束（来自 CONTRIBUTING.md）

每次改动必须遵守以下规则：

1. **风格一致** — 遵循现有 React、TypeScript、Rust 代码风格。不改动与任务无关的代码、不做无关格式化、不升级无关依赖。一个 PR（改动）只解决一个主题。
2. **禁止提交敏感数据** — 以下内容绝不能进入仓库：`.env`、私钥、Token、注册表转储、含个人路径的 OCR 截图、本地日志、`node_modules/`、`dist/`、`src-tauri/target/`、安装包/可执行文件。
3. **新增能力需声明** — 引入新的联网行为、持久化数据存储或系统权限调用时，必须在改动说明中明确指出。
4. **文档同步** — 用户可见的行为变化需同步更新 README 或 `docs/DEVELOPMENT.md`。
5. **提交前验证** — 改动完成后必须通过全部四项检查，缺一不可：

   ```powershell
   npm ci
   npm test
   npm run build
   cd src-tauri && cargo test --lib && cd ..
   ```
