export type SkinApplyParams = {
  imageDataUrl?: string;
  videoUrl?: string;
  videoPoster?: string;
  accentHex?: string;
  appearance?: "dark" | "light";
  focusX?: number;
  focusY?: number;
  imgBrightness?: number;
  imgContrast?: number;
  imgSaturate?: number;
  imgOpacity?: number;
  windowAlpha?: number;
  windowBlurPx?: number;
  panelTint?: number;
  contentTint?: number;
};

const clamp01 = (v: unknown, dflt: number): number => {
  const n = typeof v === "number" && Number.isFinite(v) ? v : dflt;
  return Math.max(0, Math.min(1, n));
};

const clampPct = (v: unknown, dflt: number): number => {
  const n = typeof v === "number" && Number.isFinite(v) ? v : dflt;
  return Math.max(0, Math.min(200, n));
};

/** 固定面板玻璃参数：不再暴露给用户调节，统一视觉基线 */
const FIXED_PANEL_ALPHA_LIGHT = 0.72;
const FIXED_PANEL_ALPHA_DARK = 0.78;
const FIXED_BLUR_PX = 18;

/** 动态壁纸地址白名单：仅本机 Studio 服务器提供的视频文件（OpenCode 渲染进程跨源加载 video 无需 CORS） */
const VIDEO_URL_RE =
  /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?\/api\/images\/video\/[a-z0-9-]+\.(mp4|webm)$/;

/** 服务端归一化：产出可直接交给注入引擎的纯数据配置。 */
export function normalizeSkinConfig(p: SkinApplyParams) {
  const light = p.appearance !== "dark";
  const accentOk = /^#[0-9a-fA-F]{3,8}$/.test(p.accentHex ?? "");
  const panelAlpha = light ? FIXED_PANEL_ALPHA_LIGHT : FIXED_PANEL_ALPHA_DARK;
  const videoUrlOk = typeof p.videoUrl === "string" && VIDEO_URL_RE.test(p.videoUrl);
  return {
    v: 1 as const,
    light,
    accentHex: accentOk ? (p.accentHex as string) : "#88c0d0",
    imageDataUrl:
      !videoUrlOk && typeof p.imageDataUrl === "string" && p.imageDataUrl.startsWith("data:image/")
        ? p.imageDataUrl
        : "",
    videoUrl: videoUrlOk ? (p.videoUrl as string) : "",
    /* 首帧海报：视频加载中/失败时的降级画面，随配置持久化，服务器下线也不黑屏 */
    videoPoster:
      videoUrlOk && typeof p.videoPoster === "string" && p.videoPoster.startsWith("data:image/")
        ? p.videoPoster
        : "",
    panelAlpha,
    blurPx: FIXED_BLUR_PX,
    titlebarAlpha: panelAlpha,
    contentAlpha: 0.1,
    focusX: clamp01(p.focusX, 0.5),
    focusY: clamp01(p.focusY, 0.5),
    imgBrightness: clampPct(p.imgBrightness, 100),
    imgContrast: clampPct(p.imgContrast, 100),
    imgSaturate: clampPct(p.imgSaturate, 100),
    imgOpacity: clamp01(p.imgOpacity, 1),
    /* 窗口整体透明度：1=不透明（关闭）；下限 0.2 防止窗口完全不可见 */
    windowAlpha: Math.max(
      0.2,
      Math.min(1, typeof p.windowAlpha === "number" && Number.isFinite(p.windowAlpha) ? p.windowAlpha : 1),
    ),
    windowBlurPx: Math.round(
      Math.max(
        0,
        Math.min(
          30,
          typeof p.windowBlurPx === "number" && Number.isFinite(p.windowBlurPx) ? p.windowBlurPx : 4,
        ),
      ),
    ),
    panelTint: clamp01(p.panelTint, 0),
    contentTint: clamp01(p.contentTint, 0),
  };
}

export type SkinConfig = ReturnType<typeof normalizeSkinConfig>;

/** 由配置生成 CSS 文本（仅服务端执行；结果随配置一起下发给注入引擎）。 */
function cssRulesFor(c: SkinConfig): string {
  const accentRgb = (() => {
    let h = (c.accentHex || "#88c0d0").replace(/^#/, "");
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    const n = parseInt(h.slice(0, 6), 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  })();
  const mixRgb = (base: string, tint: number): string => {
    const [r, g, b] = base.split(",").map(Number);
    const m = clamp01(tint, 0);
    return `${Math.round(r + (accentRgb.r - r) * m)},${Math.round(g + (accentRgb.g - g) * m)},${Math.round(b + (accentRgb.b - b) * m)}`;
  };
  const fx = (c.focusX * 100).toFixed(1);
  const fy = (c.focusY * 100).toFixed(1);
  const bd = c.light ? "0,0,0" : "255,255,255";
  const bdA = c.light ? 0.08 : 0.1;
  /* 窗口透明激活时面板随之变透：否则高不透明度玻璃面板会把桌面壁纸盖成灰白一片。
   * 壁纸不透明度即「壁纸强弱」：壁纸越不透明，玻璃面纱越轻（imgOpacity=1 时减半），
   * 否则 78%+60% 两层面纱复合 91% 不透明，壁纸只剩 <10% 透出——"只能看见配色"。
   * 面纱的颜色浓淡（panelTint/contentTint）同步缩放：强壁纸时着色玻璃退为轻着色，
   * 否则高饱和主题的着色会把壁纸的色相吞掉，只剩轮廓。
   * 仅作用于背景面纱；按钮/边框/对话框等控件透明度与强调色不动，保证可读性与主题感。 */
  const wScale = (c.windowAlpha ?? 1) < 1 ? (c.windowAlpha as number) : 1;
  const veilK = 1 - 0.5 * clamp01(c.imgOpacity, 1);
  const r3 = (x: number) => Math.round(x * 1000) / 1000;
  const panelTintEff = clamp01(c.panelTint, 0) * veilK;
  const contentTintEff = clamp01(c.contentTint, 0) * veilK;
  const panelRgb = mixRgb(c.light ? "249,247,241" : "28,28,34", panelTintEff);
  const contentRgb = mixRgb(c.light ? "253,251,245" : "30,30,36", contentTintEff);
  const panelA = Math.max(0.05, r3(c.panelAlpha * wScale * veilK));
  const titleA = Math.max(0.05, r3(c.titlebarAlpha * wScale * veilK));
  const ca = r3(c.contentAlpha * wScale * veilK);
  const L: string[] = [];
  L.push(`html.oc-studio-skin{--ocs-accent:${c.accentHex};color-scheme:${c.light ? "light" : "dark"};}`);
  /* 官方不透明背景令牌 → 半透明：会话头部渐变、diffs 头、手风琴消息行等未命中选择器的表面透出壁纸 */
  const sA = (v: number) => Math.max(0.03, r3(v * wScale * veilK));
  L.push(
    `html.oc-studio-skin,html.oc-studio-skin #root,html.oc-studio-skin #root *{--v2-background-bg-deep:rgba(${panelRgb},${sA(0.45)}) !important;--v2-background-bg-base:rgba(${contentRgb},${sA(0.12)}) !important;--v2-background-bg-layer-01:rgba(${contentRgb},${sA(0.16)}) !important;--v2-background-bg-layer-02:rgba(${contentRgb},${sA(0.24)}) !important;--v2-background-bg-layer-03:rgba(${contentRgb},${sA(0.32)}) !important;--v2-background-bg-layer-04:rgba(${contentRgb},${sA(0.45)}) !important;--v2-background-bg-contrast:rgba(${contentRgb},${sA(0.28)}) !important;}`,
  );
  L.push(
    `html.oc-studio-skin,html.oc-studio-skin body,html.oc-studio-skin #root{background:transparent !important;}`,
  );
  const wb = c.windowBlurPx ?? 0;
  const panelBlurBase = FIXED_BLUR_PX;
  // 玻璃面板自身也随 windowBlur 增强：无论是否已开透明，模糊量变化都能在面板区直接感知
  const panelBlurEff = Math.round(panelBlurBase + wb * 0.6);
  const panelSatEff = Math.min(1.6, 1.1 + wb * 0.012).toFixed(2);
  /* 默认背景：优先用用户壁纸（图片直接用，视频用首帧海报——视频元素在其上播放，
   * 加载中/失败时海报无缝垫底）；没有则生成高对比渐变，保证 windowBlurPx 永远有「可糊」的内容
   * （纯色背景糊了也看不出变化，多团径向渐变才有明显软化效果）。透明度固定，不随模糊改。 */
  const bgImage = c.imageDataUrl || (c.videoUrl ? c.videoPoster : "");
  const fallbackBg = bgImage
    ? `url("${bgImage}") ${fx}% ${fy}%/cover no-repeat`
    : `radial-gradient(55% 55% at 22% 18%, ${c.accentHex}99, transparent 60%), radial-gradient(48% 48% at 82% 78%, ${c.accentHex}77, transparent 58%), radial-gradient(42% 42% at 62% 44%, #ffffff22, transparent 62%), linear-gradient(135deg, ${c.light ? "#cdd6e6" : "#2a2f3e"}, ${c.light ? "#aab4c8" : "#171a24"})`;
  const beforeRule = `html.oc-studio-skin::before{content:"";position:fixed;inset:0;z-index:-1;pointer-events:none;background:${fallbackBg};opacity:${c.imgOpacity};filter:brightness(${c.imgBrightness}%) contrast(${c.imgContrast}%) saturate(${c.imgSaturate}%)${wb > 0 ? ` blur(${wb}px)` : ""};}`;
  /* 透明模式的模拟桌面层需要「可糊」的高频细节：平滑渐变糊不糊肉眼无感。
   * 无壁纸时用散景光斑变体——blur=0 是清晰光斑，blur 越大越融成光晕，滑杆反馈立竿见影。 */
  const simBg = bgImage
    ? fallbackBg
    : `radial-gradient(circle at 22% 18%, ${c.accentHex}B3 0 7%, ${c.accentHex}00 9%), radial-gradient(circle at 82% 78%, ${c.accentHex}80 0 5%, ${c.accentHex}00 7%), radial-gradient(circle at 62% 44%, #ffffff45 0 3%, #ffffff00 5%), radial-gradient(circle at 40% 72%, ${c.accentHex}66 0 4%, ${c.accentHex}00 6%), radial-gradient(circle at 70% 26%, ${c.accentHex}52 0 6%, ${c.accentHex}00 8%), linear-gradient(135deg, ${c.light ? "#cdd6e6" : "#2a2f3e"}, ${c.light ? "#aab4c8" : "#171a24"})`;
  /* 窗口透明激活时：Win11（24H2+）对 Electron 窗口静默忽略 SetWindowCompositionAttribute（accent 3/4
   * 任何 tint 都不渲染）与 DWM SYSTEMBACKDROP，系统级毛玻璃不可用（四条路实测均堵死，见 windowFx.ts 头注）。
   * 因此改为保留一层「模拟桌面」（壁纸或主题渐变）承接 CSS blur：窗口经 layered 按透明度真实透出桌面
   * （可见性优先，不能为磨砂牺牲），模糊由本层与面板 backdrop-filter 承接。blur=0 时不渲染该层。
   * 有真实壁纸时按 imgOpacity 全强度渲染——壁纸是用户明确选择的背景，若压到低强度会被
   * 面板着色盖过（主题市场配色 + 壁纸的组合里壁纸几乎不可见）；无壁纸的散景变体只是
   * 装饰，维持低强度让真实桌面主导。 */
  if ((c.windowAlpha ?? 1) < 1) {
    if (wb > 0) {
      const sat = Math.min(1.6, 1 + wb * 0.018).toFixed(2);
      const simA = (
        bgImage || c.videoUrl ? c.imgOpacity : Math.min(0.55, (c.imgOpacity ?? 1) * 0.45)
      ).toFixed(2);
      L.push(
        `html.oc-studio-skin::before{content:"";position:fixed;inset:0;z-index:-1;pointer-events:none;background:${simBg};opacity:${simA};filter:brightness(${c.imgBrightness}%) contrast(${c.imgContrast}%) saturate(${c.imgSaturate}%) blur(${wb}px);}`,
      );
      L.push(
        `html.oc-studio-skin body,html.oc-studio-skin #root{-webkit-backdrop-filter:blur(${wb}px) saturate(${sat});backdrop-filter:blur(${wb}px) saturate(${sat});}`,
      );
    } else {
      L.push(`html.oc-studio-skin::before{content:none !important;}`);
    }
    // 兜底渐变层：模拟桌面层失效时仍提供一点可见的模糊变化，低透明度不挡桌面
    L.push(
      `html.oc-studio-skin #root > div:first-child::before{content:"";position:fixed;inset:0;z-index:-1;pointer-events:none;background:${fallbackBg};opacity:${Math.min(0.5, (c.imgOpacity ?? 1) * 0.5)};filter:brightness(${c.imgBrightness}%) contrast(${c.imgContrast}%) saturate(${c.imgSaturate}%)${wb > 0 ? ` blur(${wb}px)` : ""};}`,
    );
  } else {
    L.push(beforeRule);
  }
  L.push(
    `html.oc-studio-skin #root > div:first-child{background-color:rgba(${panelRgb},${panelA}) !important;-webkit-backdrop-filter:blur(${panelBlurEff}px) saturate(${panelSatEff});backdrop-filter:blur(${panelBlurEff}px) saturate(${panelSatEff});contain:layout style;}`,
  );
  /* 关键：让内容区（main/aside/header）成为磨砂玻璃，直接透出背后被模糊的渐变/壁纸。
   * 否则 OpenCode Desktop 自身的实体背景会盖住 ::before，导致 windowBlurPx 看不见任何变化。 */
  L.push(
    `html.oc-studio-skin main,html.oc-studio-skin aside{background-color:rgba(${contentRgb},${(0.32 * veilK).toFixed(2)}) !important;-webkit-backdrop-filter:blur(${panelBlurEff}px) saturate(${panelSatEff});backdrop-filter:blur(${panelBlurEff}px) saturate(${panelSatEff});}`,
  );
  L.push(
    `html.oc-studio-skin header[data-slot="titlebar-v2"]{background-color:rgba(${panelRgb},${titleA}) !important;border-bottom:1px solid rgba(${bd},${bdA}) !important;-webkit-backdrop-filter:blur(${panelBlurEff}px) saturate(${panelSatEff});backdrop-filter:blur(${panelBlurEff}px) saturate(${panelSatEff});}`,
  );
  L.push(
    `html.oc-studio-skin [data-slot="titlebar-tab-item"]{background-color:rgba(255,255,255,${c.light ? 0.15 : 0.08}) !important;}`,
  );
  L.push(
    `html.oc-studio-skin [data-slot="titlebar-tab-item"][data-active="true"]{background-color:rgba(${contentRgb},${c.light ? 0.35 : 0.4}) !important;}`,
  );
  L.push(
    `html.oc-studio-skin main [class*="bg-background"],html.oc-studio-skin main [class*="bg-v2-background"]{background-color:rgba(${contentRgb},${ca}) !important;}`,
  );
  L.push(
    `html.oc-studio-skin aside,html.oc-studio-skin aside [class*="bg-background"],html.oc-studio-skin aside [class*="bg-v2-background"]{background-color:rgba(${contentRgb},${ca}) !important;}`,
  );
  L.push(
    `html.oc-studio-skin aside [data-component="tabs"],html.oc-studio-skin aside [data-component="session-review-v2"],html.oc-studio-skin aside [data-component="session-review-v2-sidebar-root"],html.oc-studio-skin aside [data-slot="tabs-list"],html.oc-studio-skin aside [data-slot="tabs-trigger-wrapper"],html.oc-studio-skin aside .session-review-v2-tabs-bar{background-color:rgba(${contentRgb},${ca}) !important;}`,
  );
  L.push(
    `html.oc-studio-skin [data-component="session-prompt-dock"],html.oc-studio-skin [data-component="prompt-input-v2"],html.oc-studio-skin [data-component="session-composer"]{background-color:rgba(${contentRgb},${Math.min(1, ca + 0.1)}) !important;border:1px solid rgba(${bd},${bdA}) !important;}`,
  );
  /* 会话详情里的粘性头/diffs 头/消息手风琴行/表面条：官方样式用字面量深色，需按属性选择器显式半透明 */
  L.push(
    `html.oc-studio-skin [data-slot="session-turn-diffs-header"],html.oc-studio-skin [data-component="sticky-accordion-header"],html.oc-studio-skin button[data-slot="accordion-trigger"],html.oc-studio-skin [class*="bg-surface"]{background-color:rgba(${contentRgb},0.15) !important;}`,
  );
  L.push(`html.oc-studio-skin [data-component="prompt-input"]{background-color:transparent !important;}`);
  L.push(
    `html.oc-studio-skin textarea,html.oc-studio-skin [contenteditable="true"]{background-color:rgba(255,255,255,${c.light ? 0.35 : 0.08}) !important;}`,
  );
  L.push(
    `html.oc-studio-skin [data-component="button-v2"],html.oc-studio-skin [data-component="icon-button-v2"],html.oc-studio-skin [data-component="icon-button"]{background-color:rgba(255,255,255,${c.light ? 0.25 : 0.1}) !important;border:1px solid rgba(${bd},${c.light ? 0.06 : 0.1}) !important;}`,
  );
  L.push(
    `html.oc-studio-skin [data-component="button-v2"]:hover,html.oc-studio-skin [data-component="icon-button-v2"]:hover,html.oc-studio-skin [data-component="icon-button"]:hover{background-color:rgba(255,255,255,${c.light ? 0.4 : 0.16}) !important;}`,
  );
  L.push(
    `html.oc-studio-skin [data-component="dialog-stack"],html.oc-studio-skin [data-component="toast-v2-region"]{background-color:rgba(${contentRgb},0.85) !important;}`,
  );
  /* 强调色变量（深浅模式通用）：对齐新版 Desktop UI 实际消费的 --v2-* 变量名 */
  const accentHover = `color-mix(in oklab, ${c.accentHex} 82%, ${c.light ? "black" : "white"})`;
  L.push(
    `html.oc-studio-skin,html.oc-studio-skin #root,html.oc-studio-skin #root *{--v2-background-bg-accent:${c.accentHex} !important;--v2-text-text-accent:${c.accentHex} !important;--v2-text-text-accent-hover:${accentHover} !important;--v2-text-text-code-accent:${c.accentHex} !important;--v2-icon-icon-accent:${c.accentHex} !important;--v2-icon-icon-accent-hover:${accentHover} !important;--v2-border-border-focus:${c.accentHex} !important;}`,
  );
  if (c.light) {
    L.push(`html.oc-studio-skin #root{color:#2d3748 !important;text-shadow:0 1px 2px rgba(0,0,0,0.08);}`);
    L.push(
      `html.oc-studio-skin,html.oc-studio-skin #root,html.oc-studio-skin #root *{--v2-text-text-base:#2d3748 !important;--v2-text-text-faint:#6b7280 !important;--v2-icon-icon-base:#4b5563 !important;--v2-border-border:rgba(0,0,0,0.1) !important;}`,
    );
  } else {
    L.push(`html.oc-studio-skin #root{color:#e2e8f0 !important;text-shadow:0 1px 2px rgba(0,0,0,0.3);}`);
    L.push(
      `html.oc-studio-skin,html.oc-studio-skin #root,html.oc-studio-skin #root *{--v2-text-text-base:#e2e8f0 !important;--v2-text-text-faint:#94a3b8 !important;--v2-icon-icon-base:#cbd5e1 !important;--v2-border-border:rgba(255,255,255,0.12) !important;}`,
    );
  }
  L.push(`html.oc-studio-skin ::-webkit-scrollbar{width:6px;height:6px;}`);
  L.push(`html.oc-studio-skin ::-webkit-scrollbar-track{background:transparent !important;}`);
  L.push(
    `html.oc-studio-skin ::-webkit-scrollbar-thumb{background:rgba(${bd},${c.light ? 0.18 : 0.15}) !important;border-radius:3px;}`,
  );
  L.push(
    `html.oc-studio-skin.oc-active-home #root > div{background-color:rgba(${panelRgb},${panelA}) !important;backdrop-filter:none !important;-webkit-backdrop-filter:none !important;box-shadow:none !important;}`,
  );
  L.push(
    `html.oc-studio-skin.oc-active-home #root > div > *{background-color:rgba(${contentRgb},${(0.6 * veilK).toFixed(2)}) !important;backdrop-filter:none !important;-webkit-backdrop-filter:none !important;}`,
  );
  return L.join("\n");
}

/* 引擎只负责把「已归一化的配置 + 已生成的 CSS 文本」应用到页面并持久化，
 * 不再内嵌 cssRulesFor 源码 —— 避免依赖 Function.prototype.toString()（打包/压缩会破坏它）。
 * localStorage 键升级为 v2：存 { cfg, css }，重启/刷新后直接复用 CSS 文本。 */
const ENGINE_BODY = [
  "if(window.__ocSkinEngine__&&window.__ocSkinEngine__.v===4){try{window.__ocSkinEngine__.apply(__CFG__,__CSS__);}catch(e){}return;}",
  "if(window.__ocSkinEngine__){try{var os=document.getElementById('__oc_studio_style__');if(os)os.remove();var ov=document.getElementById('__oc_studio_video__');if(ov)ov.remove();document.documentElement.classList.remove('oc-studio-skin');document.documentElement.classList.remove('oc-active-home');delete window.__ocSkinEngine__;}catch(e){}}",
  'var KEY="__oc_skin_cfg_v2",ID="__oc_studio_style__",VID="__oc_studio_video__",HD=null,st=null,mo=null,cfg=null,cssText="",HOME_SEL=\'[data-component="session-new-design"],[data-component="home"],[data-component="welcome"],[data-component="session-list"],[data-component="session-manager"]\';',
  "function homeCheck(){var on=false;try{on=!!document.querySelector(HOME_SEL);}catch(e){}try{HD.classList.toggle('oc-active-home',on);}catch(e){}}",
  "function ensure(){st=document.getElementById(ID);",
  "if(!st){st=document.createElement('style');st.id=ID;HD.appendChild(st);}",
  "st.textContent='@layer oc-studio-skin{\\n'+cssText+'\\n}';HD.classList.add('oc-studio-skin');",
  "try{HD.style.removeProperty('background-color');}catch(e){}",
  "homeCheck();}",
  /* 动态壁纸：全屏 <video>（借鉴 Lively/live-wallpaper 的通用做法：muted+playsinline 自动播放、
   * loop 循环、页面隐藏时暂停省电）。挂在 html 下、z-index:-1，与 ::before 同层但在其后绘制，
   * 海报/渐变垫底、视频在其上播放。 */
  "function ensureVideo(c){var v=document.getElementById(VID);if(!c||!c.videoUrl){if(v)v.remove();return;}",
  "if(!v){v=document.createElement('video');v.id=VID;v.muted=true;v.loop=true;v.autoplay=true;v.setAttribute('playsinline','');v.playsInline=true;try{v.disablePictureInPicture=true;v.disableRemotePlayback=true;}catch(e){}HD.appendChild(v);}",
  "if(v.getAttribute('data-src')!==c.videoUrl){v.src=c.videoUrl;v.setAttribute('data-src',c.videoUrl);}",
  "var s=v.style;s.position='fixed';s.left='0';s.top='0';s.width='100vw';s.height='100vh';s.objectFit='cover';",
  "s.objectPosition=Math.round((c.focusX!=null?c.focusX:0.5)*100)+'% '+Math.round((c.focusY!=null?c.focusY:0.5)*100)+'%';",
  "s.filter='brightness('+(c.imgBrightness!=null?c.imgBrightness:100)+'%) contrast('+(c.imgContrast!=null?c.imgContrast:100)+'%) saturate('+(c.imgSaturate!=null?c.imgSaturate:100)+'%)'+((c.windowBlurPx||0)>0?' blur('+c.windowBlurPx+'px)':'');",
  "s.opacity=String(c.imgOpacity!=null?c.imgOpacity:1);s.zIndex='-1';s.pointerEvents='none';",
  "s.background=c.videoPoster?('url(\"'+c.videoPoster+'\") center/cover no-repeat'):'transparent';",
  "try{var p=v.play();if(p&&p.catch)p.catch(function(){});}catch(e){}}",
  "if(typeof document!=='undefined'&&!window.__ocSkinVideoVis__){window.__ocSkinVideoVis__=1;document.addEventListener('visibilitychange',function(){var v=document.getElementById(VID);if(!v)return;try{if(document.hidden){v.pause();}else{var p=v.play();if(p&&p.catch)p.catch(function(){});}}catch(e){}});}",
  "function cleanup(){if(st)st.remove();st=null;var v=document.getElementById(VID);if(v)v.remove();HD.classList.remove('oc-studio-skin');HD.classList.remove('oc-active-home');}",
  "function apply(c,css){cfg=c;cssText=String(css||'');try{localStorage.setItem(KEY,JSON.stringify({v:1,cfg:c,css:cssText}));}catch(e){}ensure();try{ensureVideo(c);}catch(e){}",
  "if(!mo){mo=new MutationObserver(function(){if(!document.getElementById(ID)||!HD.classList.contains('oc-studio-skin'))ensure();homeCheck();});",
  "mo.observe(HD,{childList:true,attributes:true,attributeFilter:['class']});try{mo.observe(document.getElementById('root')||HD,{childList:true,subtree:true});}catch(e){}}}",
  "function restore(){cfg=null;cssText='';try{localStorage.removeItem(KEY);}catch(e){}cleanup();if(mo){mo.disconnect();mo=null;}delete window.__ocSkinEngine__;return 'ok';}",
  "function boot(){var raw=null;try{raw=JSON.parse(localStorage.getItem(KEY));}catch(e){raw=null;}",
  "if(raw&&raw.v===1&&raw.cfg&&typeof raw.css==='string'){cfg=raw.cfg;cssText=raw.css;}",
  "if(cfg){try{ensure();ensureVideo(cfg);}catch(e){window.__ocSkinErr__='boot:'+String(e&&e.message||e);}}}",
  "function start(c,css){HD=document.documentElement||document.getElementsByTagName('html')[0];try{boot();}catch(e){window.__ocSkinErr__='boot0:'+String(e&&e.message||e);}try{apply(c,css);}catch(e){window.__ocSkinErr__='start:'+String(e&&e.message||e);}}",
  "window.__ocSkinEngine__={v:4,apply:apply,restore:restore,kill:function(){if(mo){mo.disconnect();mo=null;}cleanup();}};",
  "if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',function(){try{start(__CFG__,__CSS__);}catch(e){window.__ocSkinErr__='start:'+String(e&&e.message||e);}});}else{try{start(__CFG__,__CSS__);}catch(e){window.__ocSkinErr__='start0:'+String(e&&e.message||e);}}",
].join("\n");

/** 生成完整注入脚本：安装引擎（若已存在则直接换配置）+ 立即应用本次配置。 */
export function buildSkinEngineJs(cfg: SkinConfig): string {
  const cfgJson = JSON.stringify(cfg);
  const cssJson = JSON.stringify(cssRulesFor(cfg));
  return (
    "(function(){\n" + ENGINE_BODY.split("__CSS__").join(cssJson).split("__CFG__").join(cfgJson) + "\n})();"
  );
}
