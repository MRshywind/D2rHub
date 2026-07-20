# D2RHub 开发指南

本文档面向希望在本地构建、测试或贡献 D2RHub 的开发者。D2RHub 目前只支持
Windows 桌面环境。

## 环境要求

- Windows 10 或 Windows 11（64 位）
- Node.js 20 或更高版本，以及随 Node.js 安装的 npm
- Rust stable 的 `x86_64-pc-windows-msvc` 工具链
- Visual Studio Build Tools，包含“使用 C++ 的桌面开发”和 Windows SDK
- Microsoft Edge WebView2 Runtime
- Git

Tauri 的 Windows 前置条件以
[Tauri 官方文档](https://v2.tauri.app/start/prerequisites/#windows)为准。

## 获取源码与安装依赖

```powershell
git clone https://github.com/gjy991229/D2RHub.git
Set-Location D2RHub
npm ci
```

`npm ci` 会严格按照 `package-lock.json` 安装前端与 Tauri CLI 依赖。Rust 依赖在
首次运行 Cargo 命令时按照 `src-tauri/Cargo.lock` 下载并编译。

## 常用命令

```powershell
# 启动 Vite 前端开发服务器
npm run dev

# 运行前端快捷键规范化测试
npm test

# TypeScript 检查并生成前端生产构建
npm run build

# 运行 Rust 库测试
Set-Location src-tauri
cargo test --lib
Set-Location ..

# 构建包含 OCR 的完整桌面版
npm run build:full

# 构建不包含 OCR 的 Lite 桌面版
npm run build:lite
```

完整 OCR 构建包含较大的模型和本地推理依赖，第一次编译耗时较长，也可能由 Cargo
依赖下载原生运行库。普通前端修改通常只需运行 `npm test` 和 `npm run build`；
涉及 Rust 代码时还必须运行 `cargo test --lib`。

## 项目结构

- `src/`：React 页面、组件、状态和前端工具。
- `src-tauri/src/`：Tauri 命令、Windows 集成、启动流程、OCR 和统计逻辑。
- `assets/models/`：随完整版分发的 OCR 模型与字典。
- `public/`：Vite 直接复制的运行时图片和 SVG。
- `docs/`：用户文档、开发文档及应用内离线页面。
- `.github/workflows/`：公开仓库的 Pull Request 验证 CI。

## 本地数据与调试文件

应用运行时可能在用户数据目录保存账号配置、加密 Token、注册表快照、日志、统计
数据库和 OCR 调试截图。这些内容可能包含账号或个人路径，绝不能复制进仓库或附在
公开 Issue/PR 中。提交日志或截图前必须脱敏。

不要提交：

- `.env`、私钥、Token 或其他凭据；
- `node_modules/`、`dist/`、`src-tauri/target/`；
- 本地日志、注册表导出和 OCR 调试截图；
- 安装包、可执行文件或个人发布配置。

## CI 与发布

公开仓库 CI 仅验证测试和构建，使用只读权限。项目维护者的 Release 自动化不属于
公开仓库；外部贡献者无需也不能通过公开 CI 发布 D2RHub 安装包。

## 常见问题

### Rust 第一次编译很慢

OCR、Tauri 和 Windows API 依赖量较大，冷编译可能需要数分钟。后续编译会复用
`src-tauri/target/` 缓存。

### WebView 窗口无法打开

确认系统已安装 Microsoft Edge WebView2 Runtime，并重新运行 Tauri 开发命令。

### OCR 完整版编译或运行失败

先确认模型文件完整、磁盘空间充足，并使用 64 位 MSVC Rust 工具链。仅调试不涉及
OCR 的功能时可先使用 Lite 构建。
