# Architecture

## 渲染管线

```
┌─────────────────────────────────────────────────────────┐
│  <html class="opencode-dream-skin dream-active-home">   │
│  background-image: var(--dream-art)  ← 壁纸             │
│  ┌───────────────────────────────────────────────────┐  │
│  │  #root > div:first-child                          │  │
│  │  background-color: rgba(249,247,241, α)           │  │
│  │  backdrop-filter: blur(Npx)  ← 毛玻璃            │  │
│  │  filter: brightness/contrast/saturate             │  │
│  │  ┌─────────────────────────────────────────────┐  │  │
│  │  │  header[data-slot="titlebar-v2"]            │  │  │
│  │  │  background-color: rgba(..., titlebar-α)    │  │  │
│  │  ├─────────────────────────────────────────────┤  │  │
│  │  │  main .bg-v2-background-bg-base             │  │  │
│  │  │  background-color: rgba(..., content-α)     │  │  │
│  │  ├─────────────────────────────────────────────┤  │  │
│  │  │  [data-component="session-composer"]        │  │  │
│  │  │  background-color: rgba(..., composer-α)    │  │  │
│  │  └─────────────────────────────────────────────┘  │  │
│  └───────────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────────┐  │
│  │  #dream-settings-panel (z-index: 2147483647)     │  │
│  │  深色半透明 + backdrop-filter: blur(12px)         │  │
│  │  10个滑块 + Change/Reset 按钮                      │  │
│  └───────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

## 注入流程

1. `injector.mjs` 通过 CDP 连接 OpenCode 渲染进程
2. 使用 `Page.addScriptToEvaluateOnNewDocument` 注入 JS（页面加载前执行）
3. `renderer-inject.js` 在页面内：
   - 注入 CSS（`dream-skin.css`）
   - 创建设置面板 DOM
   - 设置 CSS 变量
   - 启动 MutationObserver 监听页面变化
   - 启动 500ms 定时轮询保底检测

## CSS Specificity 策略

OpenCode 使用 Tailwind CSS 内联样式，注入的 CSS 必须用 `!important` + 高 specificity 覆盖：

```css
/* 基础规则 1-1-3 */
html.opencode-dream-skin #root > div:first-child { ... }

/* 首页规则 1-2-3（更高 specificity）*/
html.opencode-dream-skin #root > div:first-child.dream-home { ... }

/* 通用首页规则 1-1-2（覆盖所有 #root > div）*/
html.dream-active-home #root > div { ... }
```

## 状态管理

```javascript
window.__OPENCODE_DREAM_SKIN_STATE__ = {
  version: "2.0.0",
  cleanup: Function,        // 清理所有注入
  appearance: "light|dark",
  settings: Object,         // 持久化到 localStorage
  applySettings: Function   // 批量更新 CSS 变量（rAF + 脏标记）
};
```

## 性能优化

1. **脏标记检查**：拖动单个滑块只更新 1 个 CSS 变量（而非 10 个）
2. **视频后台暂停**：`visibilitychange` 事件暂停/恢复视频
3. **`requestIdleCallback`**：localStorage 写入延迟到 idle 时段
4. **图片服务器内存缓存**：响应 <1ms

## 已知的 CSS 陷阱

- `::before` 伪元素无法被父元素 `background-color` 覆盖（CSS 堆叠规范）
- `will-change: transform` 在 `backdrop-filter` 场景下是反优化
- `dream-home` 规则必须用 CSS 变量，不能用 `transparent`（否则 opacity 滑块失效）
