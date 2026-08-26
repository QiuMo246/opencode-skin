# OpenCode Skin Studio

本地运行的 [opencode](https://github.com/anomalyco/opencode) 换肤工作台：可视化编辑主题、从壁纸取色生成主题、联动 Windows Terminal 与桌面美化，并提供 GitHub 主题市场。零云端依赖，所有数据都在本机。

## 功能总览

### 主题编辑器（M1/M2）
- 49 个官方主题槽位分组编辑（基础色 / diff / markdown / 语法高亮），支持深浅双模式
- 实时 TUI 预览（对话、diff、markdown 渲染模拟）
- 基于 [官方 theme.json schema](https://opencode.ai/docs/themes/) 的 Ajv 校验，保存即写入 `~/.config/opencode/themes/`
- 一键应用（写入 `tui.json` 的 `theme` 字段）、DesktopTheme 桌面主题导出（过官方 schema）

### 壁纸工作台（M3）
- 上传任意图片（前端压缩到 200px 后传输）或选用 8 张内置程序化壁纸
- k-means 取色 + 50 槽位自动映射，WCAG 对比度自动校正，生成完整深浅双模式主题
- 三端输出：
  1. **TUI 主题** —— 保存 / 保存并应用
  2. **Windows Terminal 背景** —— 自动检测 Profile，写入背景图 + 亚克力 + 双不透明度，修改前强制备份、一键还原
  3. **CDP 桌面皮肤包** —— 生成 `theme.json`（accent 自动转 OKLCH）+ 背景图，可调用本地注入器

### 主题市场（M4）
- **官方精选**：实时列出 opencode 仓库内置的 33 个主题（tokyonight、gruvbox、dracula…），一键安装为本机副本
- **本地预设**：内置 Liquid Glass 磨砂玻璃 / 极光两套程序生成主题，离线可用
- **GitHub 搜索**：按 star 搜索主题仓库，扫描仓库内合法主题文件自动安装（多主题仓库自动加前缀命名）
- **更新检查**：按内容哈希比对远程最新版，识别「本地已修改」「有更新」状态

### 桌面端皮肤注入（M6）
- 内置 CDP 注入器，无需外部仓库：自动探测 OpenCode Desktop 安装路径，一键带调试端口启动（可选先退出旧实例）
- **常驻皮肤引擎**（参考 opencodedev-skin 架构）：
  - 页面刷新 / 切换会话 → `Page.addScriptToEvaluateOnNewDocument` + localStorage 自动重放
  - 官方 UI 重渲染破坏样式 → MutationObserver 秒级自愈
  - Desktop 完全重启 → 服务端「自动注入守护」每 5 秒巡检，发现皮肤丢失立即重注
- 全屏壁纸（自定义图片或内置壁纸）+ 毛玻璃面板，滑块实时调节：面板/标题栏/内容区不透明度、模糊半径、壁纸亮度/对比度/饱和度
- 深浅双模式；恢复默认可完全清除注入痕迹与本地存储

## 快速开始

依赖：Node.js ≥ 18。

```bat
:: 方式一：一键启动（自动装依赖、自动构建、自动开浏览器）
start.bat

:: 方式二：手动
npm install
npm run build
npm start          :: 服务 http://127.0.0.1:5175，同时托管前端 dist

:: 方式三：开发模式（前端 Vite 热更新 :5173 + 后端 tsx watch）
npm run dev
```

## 数据位置

| 内容 | 路径 |
|---|---|
| TUI 主题 | `~/.config/opencode/themes/*.json` |
| TUI 配置 | `~/.config/opencode/tui.json` |
| WT 备份 | `<WT 目录>/settings.json.ocskin-backup` |
| opencode 背景图 | `~/.config/opencode/backgrounds/` |
| CDP 皮肤包 | `<注入器仓库>/presets/<id>/` |
| 桌面端上次皮肤 | `<项目>/presets/desktop-skins/last.json` |
| 内置壁纸缓存 | `<项目>/presets/wallpapers/`（首次访问自动生成） |

## 环境变量（测试/自定义用）

| 变量 | 作用 |
|---|---|
| `PORT` | 服务端口（默认 5175） |
| `OC_SKIN_THEMES_DIR` | 覆盖主题目录 |
| `OC_SKIN_WT_SETTINGS` | 覆盖 Windows Terminal settings.json 路径 |
| `OC_SKIN_PRESETS_DIR` | 覆盖 CDP 皮肤包输出目录 |
| `OC_SKIN_INJECTOR_DIR` | 覆盖注入器仓库探测路径 |
| `OC_SKIN_DESKTOP_EXE` | 覆盖 OpenCode Desktop 可执行文件路径 |

## 项目结构

```
server/                 Express 后端（tsx 直跑 TS）
  lib/                  核心逻辑
    paths.ts            数据目录解析（含环境变量覆盖）
    schema.ts           官方 theme.json / desktop-theme.json Ajv 校验
    color.ts            颜色空间转换与对比度
    palette.ts          k-means 取色 + 50 槽位映射
    png.ts/wallpapers.ts 程序化 PNG 壁纸（零依赖手写编码器）
    terminal.ts         Windows Terminal 探测/JSONC 解析/备份写入
    desktop.ts          CDP 皮肤包生成 + 注入器调用
    market.ts           主题市场（官方源/预设/GitHub 安装/更新检查）
  routes/               themes / images / terminal / desktop / market
src/                    React 18 + Vite 前端
  pages/                EditorPage / GalleryPage / MarketPage
  lib/                  themeModel / imageClient（canvas 压缩取色）
scripts/package.ps1     打包发布 zip
```

## 打包发布

```powershell
powershell -ExecutionPolicy Bypass -File scripts\package.ps1
# 产物：release/opencode-skin-studio-v0.2.0.zip（源码包）
# 使用方解压后：npm install && npm run build && npm start
```

## 注意事项

- 应用或修改主题后需**重启 opencode** 才会生效（TUI 启动时读取主题）
- Windows Terminal 写入前会自动备份原 settings.json，可在工作台一键还原
- GitHub 相关功能依赖网络；未检测到 Windows Terminal / 注入器时对应面板自动置灰降级


