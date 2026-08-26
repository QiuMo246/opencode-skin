# OpenCode Skin Studio — 换肤工具设计方案

> 版本：v0.1（设计稿）
> 日期：2026-08-25
> 状态：待开发

---

## 1. 项目简介

一个运行在本地的 **Web 换肤工具**，用于自定义 [opencode](https://opencode.ai) 的界面外观：

- 上传自己的图片作为背景图，或使用内置精选图片
- 可视化修改对话框配色、软件整体配色
- 自定义主题；从 GitHub 一键下载安装他人开源的主题（液态玻璃等风格）

工具本身不修改 opencode 程序本体，只通过 opencode 官方支持的 **主题 JSON 文件 + tui.json 配置** 生效。

---

## 2. 背景知识：opencode 主题机制（已调研确认）

以下事实来自官方文档 https://opencode.ai/docs/themes/ ，是本工具全部功能的实现基础。

### 2.1 主题文件的存放位置与优先级

主题按以下顺序加载，**后者覆盖前者**：

| 优先级 | 来源         | 路径                                     |
| ------ | ------------ | ---------------------------------------- |
| 1      | 内置主题     | 编译进二进制                             |
| 2      | 用户全局目录 | `~/.config/opencode/themes/*.json`       |
| 3      | 项目根目录   | `<project-root>/.opencode/themes/*.json` |
| 4      | 当前工作目录 | `./.opencode/themes/*.json`              |

本工具读写 **用户全局目录**（Windows 下即 `C:\Users\<user>\.config\opencode\themes\`），使主题对所有项目生效。

### 2.2 主题 JSON 格式

```jsonc
{
  "$schema": "https://opencode.ai/theme.json",
  "defs": {
    // 可选：可复用颜色定义，供 theme 段引用
    "base00": "#1a1b26",
  },
  "theme": {
    // 每个槽位支持 dark/light 双变体
    "primary": { "dark": "base00", "light": "#ffffff" },
    "secondary": { "dark": "#7aa2f7", "light": "#7aa2f7" },
    // ... 其余槽位见 4.1 节完整清单
  },
}
```

颜色值支持五种写法：

| 写法      | 示例                              | 说明                         |
| --------- | --------------------------------- | ---------------------------- |
| 十六进制  | `"#7aa2f7"`                       | 最常用，需终端支持 truecolor |
| ANSI 编号 | `3`（0–255）                      | 跟随终端色板                 |
| 引用      | `"primary"` / `"defs里的名字"`    | 复用已有颜色                 |
| 双变体    | `{"dark": "...", "light": "..."}` | 深浅两套                     |
| 特殊值    | `"none"`                          | 继承终端默认色（可做透明感） |

### 2.3 应用主题

两种方式：

1. TUI 内输入 `/theme` 命令手动选择
2. 写入 `~/.config/opencode/tui.json`：

```json
{ "$schema": "https://opencode.ai/tui.json", "theme": "my-theme-name" }
```

本工具采用方式 2 实现"一键应用"。**注意：配置在启动时加载，改完必须重启 opencode 才生效**——工具 UI 中需明确提示这一点。

### 2.4 ⚠️ 核心限制：TUI 无法显示图片

opencode 是跑在终端模拟器里的 TUI 程序，主题 JSON **只支持颜色，不支持任何形式的图片**。
因此"上传背景图"必须借助终端自身的能力（详见 4.2.3 节）。

### 2.5 桌面端主题机制（2026-08-25 源码核实）

opencode 存在独立的**桌面版应用**（Windows .exe 安装），其主题系统与 TUI **完全不同**：

| 维度           | TUI                                          | 桌面端                                                                                              |
| -------------- | -------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| 格式           | 平铺 60+ 颜色槽位                            | 种子色生成式：`seeds`（9 个种子色）或 `palette`（7 必选 + 4 可选）→ OKLCH 算法自动派生全部 UI token |
| 顶层结构       | `{ "$schema", "defs", "theme" }`             | `{ "$schema?", "name", "id", "light", "dark" }`，light/dark 各为一个 variant                        |
| 生效方式       | `tui.json` 的 `"theme"` 字段 / `/theme` 命令 | 应用内 Settings → Appearance 选择；选中项存 localStorage，最终渲染为 CSS 变量                       |
| 内置主题       | 编译进二进制                                 | 打包进前端（`packages/ui/src/theme/themes/*.json`）                                                 |
| 自定义主题加载 | `~/.config/opencode/themes/*.json` ✅ 已支持 | ❌ **官方尚未实现**                                                                                 |

桌面端自定义主题现状证据链：

- Issue #13471：用户证实 `themes/` 目录 + `tui.json` 只对 TUI 生效，桌面 GUI 无效
- Issue #31948（开放中）：社区请求桌面端自定义主题功能
- PR #31952：曾提议实现 `$CONFIG/opencode/desktop-themes/` 目录自动注册——**已被关闭且未合并**
- schema 存在于仓库 `packages/ui/src/theme/desktop-theme.schema.json`，
  但官网 `https://opencode.ai/desktop-theme.json` 实测 **404**（未发布）
- v2 官方文档明示："Themes are currently a terminal-client capability"

**结论（2026-08-25 修订）**：官方主题系统层面，桌面端自定义主题仍**不可用**；
但社区已通过 **CDP 注入**实现桌面端全屏壁纸+毛玻璃（见 2.6 节），本工具据此
采用双轨策略：CDP 皮肤（现在就真实生效）+ DesktopTheme JSON 导出（官方支持后接入）。

### 2.6 参考项目：opencodedev-skin（CDP 注入方案，已验证可行）

仓库：<https://github.com/wpz1212ccl/opencodedev-skin>（MIT，JavaScript，
Windows + macOS，本地参考材料见 `docs/reference/opencodedev-skin/`）

**原理**：OpenCode Desktop 是 Electron 应用。该项目让应用以
`--remote-debugging-port=9335` 启动，通过 Chrome DevTools Protocol 的 WebSocket
连接渲染进程，用 `Page.addScriptToEvaluateOnNewDocument` 在页面加载前注入 JS；
注入脚本负责写入 `dream-skin.css`、创建设置面板 DOM、维护 CSS 变量，
并以 MutationObserver + 500ms 轮询保底。

**已实现效果**：全屏壁纸（图片/视频）、毛玻璃 UI（backdrop-filter）、
标题栏/内容区/输入框独立透明度、10 个实时滑块、暗色模式跟随、
localStorage 持久化、Ctrl+S 控制面板、30s 轮询热重载主题目录、预设主题包。

**皮肤格式**（每个主题 = 一个目录，含 `theme.json` + 壁纸资源）：

```jsonc
{
  "schemaVersion": 1,
  "id": "romantic-rose",
  "name": "Romantic Rose",
  "image": "background.jpg", // 相对本主题目录，由本地 HTTP 服务(18765)提供
  "appearance": "auto", // auto | light | dark
  "art": {
    "focusX": 0.5,
    "focusY": 0.5, // 壁纸焦点
    "safeArea": "auto",
    "taskMode": "ambient",
  },
  "palette": { "accent": "oklch(0.65 0.15 350)" }, // 目前仅 accent 一个颜色槽位
}
```

**对我们的意义与风险**：

| 方面             | 结论                                                                                                                                                    |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 意义             | 桌面端"背景图真实可见+液态玻璃"已被证明可行；其皮肤格式简单，我们的取色引擎可直接产出兼容的 theme.json                                                  |
| 局限             | 颜色控制仅 accent 一个槽位（毛玻璃主要靠壁纸透出，非完整配色）                                                                                          |
| 风险             | 依赖 Tailwind 类名/DOM 结构选择器（如 `#root > div:first-child`、`data-slot="titlebar-v2"`），opencode 更新可能失效，需跟版维护                         |
| 集成方式（选定） | 不 fork 其注入器，**作为上游运行时依赖调用**（start.ps1 / injector.mjs CLI 兼容）；我们专注 GUI 工作台：生成皮肤包 → 写入其 presets 目录 → 调用注入管线 |

---

## 3. 需求确认记录

### 3.1 用户原始需求

1. 用户能自己上传图片作为背景图，或者使用软件内置图片
2. 用户能更改对话框配色、软件配色
3. 能自定义主题，或者从 GitHub 下载他人开源的主题（液态玻璃主题等）

### 3.2 已确认的决策

| 问题     | 决策                                                                       |
| -------- | -------------------------------------------------------------------------- |
| 工具形态 | **本地 Web 应用**（浏览器访问图形界面）                                    |
| 技术栈   | 从简，由助手选定 → **TypeScript 全栈**                                     |
| 附加功能 | 仅选 **GitHub 主题市场**                                                   |
| 图片用途 | 要求最终效果在 opencode 使用中真实可见；**终端尽量不动，但必要时允许改动** |

### 3.3 由决策推导的落地方案

- "改配色" → 生成/编辑 opencode 主题 JSON（官方原生支持，零风险）✅
- "背景图真实可见" → 唯一途径是配置终端模拟器。目标终端为 **Windows Terminal**：
  写入其 `settings.json` 的 `backgroundImage` + 亚克力模糊，即可实现真正的
  **液态玻璃效果**（模糊壁纸浮着半透明 TUI）。其他/未知终端自动跳过该步骤，
  退化为"仅取色生成主题"，功能不中断。
- 未选择的推荐功能（实时预览除外）暂不做，列入第 8 节未来扩展。
  实时预览虽未单选，但作为编辑器的基本可用性组成部分纳入本期
  （按外部评审意见降级为轻量"色块映射预览"，见 4.1）。
- **目标端策略（据 2.5/2.6 核实结论调整）**：工具定位为**双目标主题工作台**——
  - TUI 目标：全流程闭环（编辑 → 保存 → 一键应用到 tui.json）
  - 桌面端目标（双轨）：
    a. **CDP 皮肤轨**：取色/选图 → 生成 opencodedev-skin 兼容的 theme.json 皮肤包
    （壁纸+accent+art 参数）→ 调用其注入管线，**现在即可真实生效**
    b. **官方格式轨**：DesktopTheme JSON 生成与导出，apply 接口预留，
    待官方支持自定义主题加载后即插即用

### 3.4 平台支持范围（明确声明）

> **本工具的完整功能仅支持 Windows（Windows Terminal）。**

| 功能                               | Windows                | macOS / Linux                                      |
| ---------------------------------- | ---------------------- | -------------------------------------------------- |
| 主题编辑 / 保存 / 应用（tui.json） | ✅                     | ✅（路径同为 `~/.config/opencode/`）               |
| 图片取色生成主题                   | ✅                     | ✅                                                 |
| 内置图库                           | ✅                     | ✅                                                 |
| 背景图真实可见（终端联动）         | ✅ 仅 Windows Terminal | ❌ 自动跳过（iTerm2/Kitty 等留有接口，本期不实现） |
| GitHub 主题市场                    | ✅                     | ✅                                                 |

README 与工具 UI 中均需明示上述范围；非 WT 用户仅失去"背景图可见"能力，
其余功能不受影响。代码层面以 `TerminalAdapter` 接口隔离各终端实现，
预留 `iterm2`（`~/.iterm2/profiles.json`）、`kitty` 等适配器的扩展位。

---

## 4. 功能详细设计

### 4.1 主题编辑器（需求 2）

**目标**：可视化编辑对话框配色与软件配色，无需手写 JSON。

#### 颜色槽位分组（按 opencode 官方 schema 完整覆盖）

| 分组     | 槽位                                                                                                                                                                                                                                                                 | 对应界面元素                                        |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| 主色     | `primary` `secondary` `accent` `error` `warning` `success` `info`                                                                                                                                                                                                    | 强调色、状态色                                      |
| 背景     | `background` `backgroundPanel` `backgroundElement`                                                                                                                                                                                                                   | 软件底色 / 对话框面板 / 元素块 ← **"软件配色"核心** |
| 边框     | `border` `borderActive` `borderSubtle`                                                                                                                                                                                                                               | 对话框与面板描边                                    |
| 文本     | `text` `textMuted`                                                                                                                                                                                                                                                   | 正文 / 次要文字                                     |
| Diff     | `diffAdded` `diffRemoved` `diffContext` `diffHunkHeader` `diffHighlightAdded` `diffHighlightRemoved` `diffAddedBg` `diffRemovedBg` `diffContextBg` `diffLineNumber` `diffAddedLineNumberBg` `diffRemovedLineNumberBg`                                                | 代码差异视图                                        |
| Markdown | `markdownText` `markdownHeading` `markdownLink` `markdownLinkText` `markdownCode` `markdownBlockQuote` `markdownEmph` `markdownStrong` `markdownHorizontalRule` `markdownListItem` `markdownListEnumeration` `markdownImage` `markdownImageText` `markdownCodeBlock` | 回复内容的渲染样式 ← **"对话框内容配色"核心**       |
| 语法高亮 | `syntaxComment` `syntaxKeyword` `syntaxFunction` `syntaxVariable` `syntaxString` `syntaxNumber` `syntaxType` `syntaxOperator` `syntaxPunctuation`                                                                                                                    | 代码块高亮                                          |

#### 编辑器能力

- 按 4.1 分组的分区面板，每个槽位一个取色器（color picker）+ HEX 输入框
- 支持 dark/light 双变体切换编辑（Tab 切换，或锁定两变体同步改）
- 支持 `defs` 定义管理：命名颜色 → 其他槽位下拉引用
- 支持特殊值 `none`（继承终端默认，用于透明感主题）
- **实时校验**：内置 `https://opencode.ai/theme.json` schema（构建时拉取固化到本地），非法值即时标红，杜绝写出让 opencode 启动失败的文件
- **Schema 手动刷新**：设置页提供"重新拉取官方 schema"按钮（`POST /api/schema/refresh`），opencode 升级后可同步最新校验规则，避免固化 schema 过期误报
- 保存 → 写入 `~/.config/opencode/themes/<name>.json`
- **一键应用** → 合并式写入 `tui.json` 的 `theme` 字段，并弹出"请重启 opencode 生效"提示
- **写入安全性**（外部评审采纳项，适用于所有配置写入）：
  - 深合并采用递归合并（对象递归、数组与标量整体替换），仅用最小自研实现，
    避免为 lodash 单独引依赖
  - 全部原子写入：先写同目录临时文件，校验 JSON 合法后 `rename` 覆盖，
    任何中断都不会留下半截配置文件阻断 opencode 启动

#### 双目标输出（TUI / 桌面端）

同一套取色/编辑结果可输出三种产物（据 2.5/2.6 核实结论）：

| 目标            | 产物                                                      | 校验/兼容依据                                          | 应用方式                                      |
| --------------- | --------------------------------------------------------- | ------------------------------------------------------ | --------------------------------------------- |
| TUI             | `theme.json`（defs + theme 槽位）                         | 官网 `theme.json` schema（固化 + 手动刷新）            | 一键写 `tui.json` ✅                          |
| 桌面端·CDP 皮肤 | 皮肤目录（`theme.json` + 壁纸资源）                       | opencodedev-skin `schemaVersion:1` 格式（2.6 节）      | 写入其 presets 目录并调用注入管线 ✅ 真实生效 |
| 桌面端·官方格式 | DesktopTheme JSON（name/id/light/dark，seeds 或 palette） | 仓库 raw 的 `desktop-theme.schema.json`（固化 + 刷新） | 仅导出；应用待官方支持，接口预留              |

桌面端双轨说明：

- CDP 皮肤轨的 accent 颜色直接采用取色主结果；art.focusX/focusY、appearance
  由用户在 GUI 中调节，滑块参数与 opencodedev-skin 内置面板语义一致
- 官方 DesktopTheme 轨的种子色模型对图片取色更友好：k-means 主色直接映射为
  9 个 `seeds`，其余界面颜色由官方开源 OKLCH 推导算法（`resolve.ts`）生成——
  预览可复用该算法逻辑
- 两轨共享同一套取色结果，一次调色、三处输出

#### 实时预览（分级方案，采纳外部评审意见）

完整像素级模拟 opencode TUI 的维护成本高（需持续跟踪官方样式细节），
故 v0.1 采用轻量方案，完整模拟列入未来扩展：

**v0.1 —— 槽位映射预览（色块示意）**

- 编辑页右侧常驻预览面板，按"界面区域"组织：
  对话框背景/边框/标题 → backgroundPanel + border + primary；
  正文/次要文字 → text / textMuted；diff 增删行 → diffAddedBg/diffRemovedBg…
- 每个区域渲染为带圆角色块 + 示例文字的简化示意图，槽位改动即时反映
- 语法高亮区用一段固定示例代码按 syntax* 槽位着色，直观展示代码块效果
- 目的：验证配色观感与对比度，而非复刻像素级布局

**明确不做：xterm.js 嵌真实终端模拟**——工程复杂度剧增且模拟环境
与真实 TUI 渲染仍有偏差，收益不成比例。

### 4.2 图片功能（需求 1）

#### 4.2.1 图片取色生成主题

- 上传图片（拖拽/点击）
  - **前端先压缩**：canvas 缩放到最长边 ≈200px 再上传（外部评审采纳项，
    k-means 计算量降低约两个数量级，取色精度不受影响）
  - 上传/计算期间显示进度提示，避免无反馈等待
- 后端解析压缩图，**k-means 聚类提取主色**（k≈6–8），输出调色板
- 自动映射到主题槽位：最亮色→text、最暗色→background 系列、饱和中间色→primary/accent 等
- 映射时自动做 **对比度调整**（WCAG AA 阈值校验，文字/背景至少 4.5:1），避免生成瞎眼主题
- 用户可在生成的调色板上微调后再进入编辑器

#### 4.2.2 内置图片库

- 打包 6–10 张精选壁纸（渐变、抽象光斑、山川夜景等适合玻璃拟态的题材）
- 与上传图片走完全相同的后续流程（取色 / 设为背景）

#### 4.2.3 设为真实背景图（Windows Terminal 联动）

这是图片能出现在**真实使用中的 opencode 背后**的唯一方式：

- 检测 Windows Terminal 的 `settings.json`（按常见安装路径探测：Store 版
  `%LOCALAPPDATA%\Packages\Microsoft.WindowsTerminal_8wekyb3d8bbwe\LocalState\settings.json`、
  scoop/choco/preview 版各路径逐一尝试）
- **首次修改前强制备份**原文件为 `settings.json.ocskin-backup`
- 写入所选 Profile：
  - `backgroundImage`: 图片复制到稳定路径后的绝对地址
  - `useAcrylic: true` + `opacity`（亚克力模糊 → 玻璃质感）
  - `backgroundImageOpacity` / `backgroundImageStretchMode`
- UI 提供 **一键还原备份**
- **多 Profile 处理**（外部评审采纳项）：
  - 读取 WT 的 `defaultProfile` GUID 作为默认写入目标（用户实际运行 opencode 的 Profile）
  - 提供下拉列表展示全部 Profile（PowerShell/WSL/CMD…）供手动指定
  - 无法确定时回退 defaultProfile 并提示确认
- 探测不到 Windows Terminal 时：该功能置灰并说明原因，其余功能不受影响

### 4.3 GitHub 主题市场（需求 3b）

- 数据来源双通道：
  1. GitHub API 搜索 `topic:opencode-theme`（以及关键词 "opencode theme"）的仓库
  2. 工具内置一份人工精选列表（JSON 维护在仓库里），首屏展示，含液态玻璃等风格的直接入口
- 卡片信息：名称 / 作者 / 截图或色板预览 / star 数 / 最近更新
- **一键安装**：拉取仓库中的主题 JSON → 经 schema 校验 → 写入 themes 目录（重名冲突时询问覆盖或改名）
- 已安装列表 + 更新检查（对比远端 commit）
- 支持粘贴任意 `owner/repo` 或仓库 URL 直达安装
- 无需登录 token 即可用（匿名限额内）；限额不足时提示可选填 PAT

### 4.4 主题管理

- 本地主题列表：查看 / 编辑 / 重命名 / 删除 / 导出 JSON 文件分享
- 内置预设起步包：随工具附带几套成品主题（含一套 **liquid-glass 液态玻璃** 参考实现），装完即用

---

## 5. 技术方案

### 5.1 技术栈（选型理由：对用户最简单、生态一致）

| 层       | 选型                                                                   | 理由                                                     |
| -------- | ---------------------------------------------------------------------- | -------------------------------------------------------- |
| 前端     | Vite + React + TypeScript                                              | 快、生态成熟；可直接复用 opencode 官方 schema 做 TS 类型 |
| 后端     | Node.js + Express                                                      | 与前端同语言，单仓库单依赖树；负责所有本地文件读写       |
| 校验     | 官方 theme.json schema + Ajv                                           | 保证产物合法                                             |
| 取色     | 服务端 k-means（纯 TS 实现，无重依赖）                                 | 免 Python 环境                                           |
| 运行方式 | 开发 `npm run dev`；发布 `npm run build && npm start` 后自动打开浏览器 | 一条命令上手                                             |

安全边界：服务仅监听 `127.0.0.1`，不对局域网开放；文件操作白名单限定在 opencode 配置目录与指定临时目录内。

### 5.2 项目结构（规划）

```
opencode_skin/
├─ docs/
│  └─ DESIGN.md            # 本文档
├─ server/
│  ├─ index.ts             # Express 入口（127.0.0.1）
│  ├─ routes/
│  │  ├─ themes.ts         # 主题 CRUD + 应用(tui.json)
│  │  ├─ images.ts         # 上传 / 取色 / 内置图库
│  │  ├─ terminal.ts       # WT 探测 / 写背景 / 还原备份
│  │  └─ market.ts         # GitHub 搜索 / 安装 / 更新检查
│  └─ lib/
│     ├─ paths.ts          # ~/.config/opencode 各路径解析
│     ├─ palette.ts        # k-means 取色 + 对比度映射
│     └─ schema.ts         # Ajv 校验封装
├─ src/                    # React 前端
│  ├─ pages/
│  │  ├─ EditorPage.tsx    # 编辑器 + 实时预览
│  │  ├─ MarketPage.tsx    # GitHub 主题市场
│  │  └─ GalleryPage.tsx   # 壁纸库 / 图片上传
│  ├─ components/
│  │  ├─ TuiPreview.tsx    # TUI 模拟预览
│  │  ├─ ColorSlot.tsx     # 单槽位取色控件
│  │  └─ ...
├─ presets/
│  ├─ themes/              # 内置成品主题（liquid-glass 等）
│  └─ wallpapers/          # 内置壁纸
└─ package.json
```

### 5.3 后端 API 设计（草案）

| 方法           | 路径                                      | 说明                                                                          |
| -------------- | ----------------------------------------- | ----------------------------------------------------------------------------- |
| GET            | `/api/themes`                             | 列出已安装主题                                                                |
| GET/PUT/DELETE | `/api/themes/:name`                       | 读/写/删单个主题 JSON                                                         |
| POST           | `/api/themes/:name/apply`                 | 写入 tui.json 并返回重启提醒                                                  |
| POST           | `/api/themes/:name/export?target=desktop` | 转换并导出 DesktopTheme JSON 到指定位置                                       |
| POST           | `/api/desktop/skin`                       | 生成 opencodedev-skin 兼容皮肤包（theme.json + 壁纸）到其 presets 目录        |
| GET            | `/api/desktop/injector/detect`            | 探测 opencodedev-skin 安装路径与 OpenCode Desktop 可执行文件                  |
| POST           | `/api/desktop/inject`                     | 调用注入管线（start.ps1 / injector.mjs）应用当前皮肤包                        |
| POST           | `/api/schema/refresh`                     | 重新拉取 TUI 与桌面两份 schema                                                |
| POST           | `/api/images/palette`                     | multipart 上传图片 → 返回调色板 + 初步映射                                    |
| GET            | `/api/images/builtin`                     | 内置图库列表                                                                  |
| GET            | `/api/terminal/detect`                    | 探测 Windows Terminal、settings 路径及 Profile 列表（含 defaultProfile 标记） |
| POST           | `/api/terminal/background`                | 设背景图+亚克力（body 含 `profileId`，默认 defaultProfile；自动先备份）       |
| POST           | `/api/terminal/restore`                   | 还原备份                                                                      |
| GET            | `/api/market/search?q=`                   | GitHub 主题搜索（合并精选列表）                                               |
| POST           | `/api/market/install`                     | `{ repo }` 安装到 themes 目录                                                 |

### 5.4 关键数据流

```
上传图片 ─→ k-means 调色板 ─→ 槽位映射(对比度校正) ─→ 编辑器微调
                                                      │
                              ┌───────────────────────┤
                              ▼                       ▼
                 themes/<name>.json        Windows Terminal settings.json
                 （opencode 配色真实生效）  （背景图+亚克力真实生效）
                              │
                              ▼
                     tui.json: { "theme": "<name>" }
                              │
                              ▼
                    用户重启 opencode → 全部生效
```

---

## 6. 风险与对策

| 风险                                                      | 影响 | 对策                                                                                                             |
| --------------------------------------------------------- | ---- | ---------------------------------------------------------------------------------------------------------------- |
| opencode 配置校验严格，坏文件导致启动失败                 | 高   | 构建期固化官方 schema，写盘前 100% 校验；同时提供文档中的环境变量逃生口说明                                      |
| 改坏 Windows Terminal 设置                                | 中   | 写前强制备份 `.ocskin-backup`；UI 一键还原；仅在用户显式点击时写入                                               |
| 主题需重启 opencode 才生效                                | 低   | 所有应用动作后明确弹提示；预览层弥补等待期的视觉反馈                                                             |
| GitHub 匿名 API 限额（60 次/时）                          | 低   | 内置精选列表缓存兜底；可选填 PAT 提升限额                                                                        |
| 用户终端非 Windows Terminal                               | 低   | 功能优雅降级为"仅取色"，不影响主流程                                                                             |
| truecolor 未开启导致色彩失真                              | 低   | 文档提供 `COLORTERM=truecolor` 检查指引                                                                          |
| 桌面端自定义主题官方未支持（2.5 节）                      | 中   | 已由 CDP 皮肤轨兜底（真实生效）；官方格式仅承诺"生成+导出"，apply 接口预留                                       |
| CDP 注入的 DOM 选择器随 opencode 更新失效（上游固有风险） | 中   | **不 fork 注入器**，作为上游依赖跟随其更新；皮肤生成与注入执行解耦，上游失效时仅桌面壁纸轨受影响，TUI 轨不受牵连 |
| desktop-theme schema 未在官网发布（404）                  | 低   | 固化仓库 raw 版本并支持手动刷新；官网发布后切换 URL                                                              |

---

## 7. 里程碑计划

| 阶段      | 内容                                                                                                              | 交付物                                      |
| --------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| M1 脚手架 | 仓库初始化、前后端骨架、路径解析、schema 校验封装                                                                 | 可运行的空壳应用                            |
| M2 编辑器 | 槽位编辑 UI、defs 管理、色块映射预览、schema 刷新接口、原子写入封装、保存/应用 tui.json                           | 能产出并应用合法主题                        |
| M3 图片   | 上传（前端压缩+进度）、取色映射、三产物输出、内置图库、WT 探测/多 Profile/背景写入+还原、CDP 皮肤包生成与注入调用 | 需求 1 完整落地（TUI + 桌面壁纸轨真实生效） |
| M4 市场   | GitHub 搜索、精选列表、一键安装、更新检查、内置 liquid-glass 预设（TUI + CDP 双格式）                             | 需求 3 完整落地                             |
| M5 打磨   | 异常处理、平台支持声明与 README、一键还原入口、打包脚本                                                           | v0.1 可发布                                 |

---

## 8. 未来扩展（本期不做，留作迭代）

- **桌面端官方格式一键应用**：官方落地自定义主题加载（如 `$CONFIG/opencode/desktop-themes/`，PR #31952 方案）后接入，导出接口已预留
- **自研注入器**：若上游 opencodedev-skin 停更或选择器长期失效，考虑 fork 维护（含视频背景增强）
- **CDP 实时调参桥**：绕过内置 Ctrl+S 面板，直接从本工具 Web UI 经 CDP 推送滑块参数，实现"网页里拖滑块、桌面端实时变"
- **AI 配色生成**：输入描述（"赛博朋克霓虹"/"莫兰迪"）调用 LLM 直接产出整套主题
- **对比度/无障碍专项检查页**：全槽位 WCAG 扫描报告（含前景/背景组合矩阵，高亮不通过项）
- **完整 TUI 模拟预览**：在 v0.1 色块映射预览基础上升级为像素级界面模拟
- **主题缩略图**：管理列表用 Canvas 按配色渲染小图，快速识别
- **`.ocskin` 打包分享**：主题 JSON + 关联壁纸打包为 ZIP 单文件导入导出
- **CLI 模式**：`ocskin --apply=mytheme` 供脚本/自动化调用
- **opencode 进程检测**：启动工具时检测运行中的 opencode，提示"更改需重启"
- **每日随机主题 / 定时轮换**
- **更多终端适配器**：iTerm2、Kitty、WezTerm 的背景配置写入（接口已预留，见 3.4）
- **主题分享平台**：工具内发布自己的主题到社区索引
- **opencode 插件形态**：`/skin` 命令在 TUI 内快捷换主题

---

## 9. 附：opencode 相关路径速查（Windows）

| 用途                         | 路径                                  |
| ---------------------------- | ------------------------------------- |
| 全局配置                     | `~/.config/opencode/opencode.json(c)` |
| 主题目录（本工具主要写入点） | `~/.config/opencode/themes/*.json`    |
| TUI 配置（应用主题时写入）   | `~/.config/opencode/tui.json`         |
| 主题 schema                  | https://opencode.ai/theme.json        |
| 主配置 schema                | https://opencode.ai/config.json       |
| TUI 配置 schema              | https://opencode.ai/tui.json          |

---

## 10. 视觉系统 v1 ——「玻璃工作室」（2026-08-25 实施记录）

> 由 impeccable/design-taste 流程重设计；方向由用户选定。工具界面本身就是
> 它所生产的液态玻璃材质的演示。

### 10.1 设计契约

- **THESIS**：换肤工具自己穿着它生产的皮肤——暗色氛围场景上漂浮真实磨砂
  玻璃面板；拒绝通用后台的实色三栏卡片布局。
- **OWN-WORLD**：近黑暖底 #0a0d14；四色低饱和极光氛围层（玫瑰/浅玫/青/琥珀，
  blur 64px，52s 缓漂移，prefers-reduced-motion 时静止）；玻璃 =
  半透明白叠加 rgba(255,255,255,.07→.032) + backdrop-blur(24px)
  saturate(150%) + 1px 内高光描边；细颗粒噪声层 opacity .05。
- **色彩**：单一强调色玫瑰红 #fb7185（用户选定，锁定全站；品牌标记为玫瑰→琥珀落日渐变）；语义色仅
  用于状态（ok #73d7a2 / warn #e8bc70 / err #f28ca0，均为 12% 透明底
  药丸）。深色模式唯一锁定。
- **字体**：Geist Variable（正文/标题）+ Geist Mono Variable（槽位名、hex
  值、日期、状态码），自托管 @fontsource-variable，中文回退微软雅黑。
- **形状系统**：控件 10px / 面板 16px / 导航轨 18px / 药丸全圆，全站一致。
- **动效**：唯一编排动效 = 页面切换 fade-rise（300ms，expo-out）；极光缓漂
  移为氛围层；prefers-reduced-motion 全部静止；按钮 ：active 下压 1px。

### 10.2 关键组件语言

- 侧边栏：悬浮玻璃导航轨（sticky、圆角 18、浮动阴影），导航项 = 图标方块
  （Phosphor，active 时 fill+accent 底）+ 双行文本；分组间 1px 弱分隔线。
- 卡片/面板：统一玻璃配方；hover 提亮描边；active 卡片 accent 双环。
- 输入框：下沉式深色场 rgba(6,9,16,.5)，focus 时 accent 描边 + 3px 光环。
- 主按钮：accent 渐变填充 + 深色墨水文字（对比达标）+ 内高光；ghost 按钮
  透明底。
- 滑杆：4px 细轨道 + accent 圆形滑块（webkit/moz 双写）。
- 市场卡片：官方主题带真实色板预览条（服务端解析主题 JSON 的 defs 引用，
  提取 background/primary/accent/secondary/text 深色变体，缓存于
  %TEMP%\oc-skin-studio\theme-colors，TTL 7 天，并发 6 拉取）。
- 浏览器表面：细滚动条、accent 选区、focus-visible 环均已主题化。
- 无障碍降级：prefers-reduced-transparency 时玻璃退化为实色 #141824。

### 10.3 审查记录

- 检测器（regex 降级模式）：0 findings。
- 截图存档：.impeccable/review/（desktop 1440px 四页 + mobile 390px）。
- 审查方式说明：本环境无 impeccable-finish-reviewer 子代理，以构建线程外
  的人工核查（分批截图 + 修复批次 + 复检）替代，此为降级路径。

## 11. 桌面端皮肤区域三页化（v0.3）

桌面端皮肤与终端侧对齐，拆为三页，共享基础设施：

- **DesktopSkinContext**（App 级）：皮肤参数、壁纸 dataUrl、脏标记、
  400ms 防抖自动应用、lastApplied 回填；`applyNow(override?)` 支持覆盖
  参数，避免「先 update 再 apply」的闭包旧值问题。
- **DesktopStatusBar**：三页共享状态条（端口/守护/页面数胶囊 + 启动并
  连接 / 退出重启 / 刷新 / 守护开关）。
- **主题编辑器**：预设 + 外观/强调色/面板/毛玻璃/标题栏 + 应用/截图/
  恢复 + 「保存为自定义主题」。
- **主题市场**：官方配色映射（33 官方主题色板 → 主色作强调色、背景亮度
  推断深浅，一键注入）+ 精选与自定义主题库（服务端
  `%TEMP%\oc-skin-studio\desktop-themes`，8 内置种子，GET/POST/DELETE
  `/api/desktop/themes`，内置不可删）。
- **壁纸工作台**：上传/内置图库 → 1920 JPEG 壁纸 + 200px 取色双通道；
  调色板色块点击一键设为强调色；焦点 X/Y 与画面四参数集中于此页。
