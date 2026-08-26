export type SkinApplyParams = {
  imageDataUrl?: string;
  accentHex?: string;
  appearance?: "dark" | "light";
  panelAlpha?: number;
  blurPx?: number;
  titlebarAlpha?: number;
  focusX?: number;
  focusY?: number;
  imgBrightness?: number;
  imgContrast?: number;
  imgSaturate?: number;
  imgOpacity?: number;
};

const clamp01 = (v: unknown, dflt: number): number => {
  const n = typeof v === "number" && Number.isFinite(v) ? v : dflt;
  return Math.max(0, Math.min(1, n));
};

const clampPct = (v: unknown, dflt: number): number => {
  const n = typeof v === "number" && Number.isFinite(v) ? v : dflt;
  return Math.max(0, Math.min(200, n));
};

/** 服务端归一化：产出可直接交给注入引擎的纯数据配置。 */
export function normalizeSkinConfig(p: SkinApplyParams) {
  const light = p.appearance !== "dark";
  const accentOk = /^#[0-9a-fA-F]{3,8}$/.test(p.accentHex ?? "");
  return {
    v: 1 as const,
    light,
    accentHex: accentOk ? (p.accentHex as string) : "#88c0d0",
    imageDataUrl:
      typeof p.imageDataUrl === "string" && p.imageDataUrl.startsWith("data:image/") ? p.imageDataUrl : "",
    panelAlpha: clamp01(p.panelAlpha, light ? 0.72 : 0.78),
    blurPx: Math.round(
      Math.max(0, Math.min(40, typeof p.blurPx === "number" && Number.isFinite(p.blurPx) ? p.blurPx : 18)),
    ),
    titlebarAlpha: clamp01(p.titlebarAlpha, 0.6),
    contentAlpha: 0.1,
    focusX: clamp01(p.focusX, 0.5),
    focusY: clamp01(p.focusY, 0.5),
    imgBrightness: clampPct(p.imgBrightness, 100),
    imgContrast: clampPct(p.imgContrast, 100),
    imgSaturate: clampPct(p.imgSaturate, 100),
    imgOpacity: clamp01(p.imgOpacity, 1),
  };
}

export type SkinConfig = ReturnType<typeof normalizeSkinConfig>;

/** 由配置生成 CSS 文本（仅服务端执行；结果随配置一起下发给注入引擎）。 */
function cssRulesFor(c: SkinConfig): string {
  const panelRgb = c.light ? "249,247,241" : "28,28,34";
  const contentRgb = c.light ? "253,251,245" : "30,30,36";
  const fx = (c.focusX * 100).toFixed(1);
  const fy = (c.focusY * 100).toFixed(1);
  const bd = c.light ? "0,0,0" : "255,255,255";
  const bdA = c.light ? 0.08 : 0.1;
  const ca = c.contentAlpha;
  const L: string[] = [];
  L.push(`html.oc-studio-skin{--ocs-accent:${c.accentHex};color-scheme:${c.light ? "light" : "dark"};}`);
  L.push(
    `html.oc-studio-skin,html.oc-studio-skin body,html.oc-studio-skin #root{background:transparent !important;}`,
  );
  L.push(
    `html.oc-studio-skin::before{content:"";position:fixed;inset:0;z-index:-1;pointer-events:none;background:${c.imageDataUrl ? `url("${c.imageDataUrl}")` : "none"} center/${fx}% ${fy}% no-repeat;opacity:${c.imgOpacity};filter:brightness(${c.imgBrightness}%) contrast(${c.imgContrast}%) saturate(${c.imgSaturate}%);}`,
  );
  L.push(
    `html.oc-studio-skin #root > div:first-child{background-color:rgba(${panelRgb},${c.panelAlpha}) !important;-webkit-backdrop-filter:blur(${c.blurPx}px) saturate(1.1);backdrop-filter:blur(${c.blurPx}px) saturate(1.1);contain:layout style;}`,
  );
  L.push(
    `html.oc-studio-skin header[data-slot="titlebar-v2"]{background-color:rgba(${panelRgb},${c.titlebarAlpha}) !important;border-bottom:1px solid rgba(${bd},${bdA}) !important;}`,
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
  if (c.light) {
    L.push(`html.oc-studio-skin #root{color:#2d3748 !important;text-shadow:0 1px 2px rgba(0,0,0,0.08);}`);
    L.push(
      `html.oc-studio-skin,html.oc-studio-skin #root,html.oc-studio-skin #root *{--v2-text-text-base:#2d3748 !important;--v2-text-text-faint:#6b7280 !important;--v2-text-text-accent:${c.accentHex} !important;--v2-icon-icon-base:#4b5563 !important;--v2-icon-icon-accent:${c.accentHex} !important;--v2-border-border:rgba(0,0,0,0.1) !important;--v2-border-border-accent:${c.accentHex} !important;--v2-accent-accent:${c.accentHex} !important;--v2-surface-surface:rgba(255,255,255,0.4) !important;}`,
    );
  } else {
    L.push(`html.oc-studio-skin #root{color:#e2e8f0 !important;text-shadow:0 1px 2px rgba(0,0,0,0.3);}`);
  }
  L.push(`html.oc-studio-skin ::-webkit-scrollbar{width:6px;height:6px;}`);
  L.push(`html.oc-studio-skin ::-webkit-scrollbar-track{background:transparent !important;}`);
  L.push(
    `html.oc-studio-skin ::-webkit-scrollbar-thumb{background:rgba(${bd},${c.light ? 0.18 : 0.15}) !important;border-radius:3px;}`,
  );
  L.push(
    `html.oc-studio-skin.oc-active-home #root > div{background-color:rgba(${panelRgb},${c.panelAlpha}) !important;backdrop-filter:none !important;-webkit-backdrop-filter:none !important;box-shadow:none !important;}`,
  );
  L.push(
    `html.oc-studio-skin.oc-active-home #root > div > *{background-color:rgba(${contentRgb},0.6) !important;}`,
  );
  return L.join("\n");
}

/* 引擎只负责把「已归一化的配置 + 已生成的 CSS 文本」应用到页面并持久化，
 * 不再内嵌 cssRulesFor 源码 —— 避免依赖 Function.prototype.toString()（打包/压缩会破坏它）。
 * localStorage 键升级为 v2：存 { cfg, css }，重启/刷新后直接复用 CSS 文本。 */
const ENGINE_BODY = [
  "if(window.__ocSkinEngine__&&window.__ocSkinEngine__.v===3){try{window.__ocSkinEngine__.apply(__CFG__,__CSS__);}catch(e){}return;}",
  "if(window.__ocSkinEngine__){try{var os=document.getElementById('__oc_studio_style__');if(os)os.remove();document.documentElement.classList.remove('oc-studio-skin');document.documentElement.classList.remove('oc-active-home');delete window.__ocSkinEngine__;}catch(e){}}",
  'var KEY="__oc_skin_cfg_v2",ID="__oc_studio_style__",HD=null,st=null,mo=null,cfg=null,cssText="",HOME_SEL=\'[data-component="session-new-design"],[data-component="home"],[data-component="welcome"],[data-component="session-list"],[data-component="session-manager"]\';',
  "function homeCheck(){var on=false;try{on=!!document.querySelector(HOME_SEL);}catch(e){}try{HD.classList.toggle('oc-active-home',on);}catch(e){}}",
  "function ensure(){st=document.getElementById(ID);",
  "if(!st){st=document.createElement('style');st.id=ID;HD.appendChild(st);}",
  "st.textContent='@layer oc-studio-skin{\\n'+cssText+'\\n}';HD.classList.add('oc-studio-skin');",
  "try{HD.style.removeProperty('background-color');}catch(e){}",
  "homeCheck();}",
  "function cleanup(){if(st)st.remove();st=null;HD.classList.remove('oc-studio-skin');HD.classList.remove('oc-active-home');}",
  "function apply(c,css){cfg=c;cssText=String(css||'');try{localStorage.setItem(KEY,JSON.stringify({v:1,cfg:c,css:cssText}));}catch(e){}ensure();",
  "if(!mo){mo=new MutationObserver(function(){if(!document.getElementById(ID)||!HD.classList.contains('oc-studio-skin'))ensure();homeCheck();});",
  "mo.observe(HD,{childList:true,attributes:true,attributeFilter:['class']});try{mo.observe(document.getElementById('root')||HD,{childList:true,subtree:true});}catch(e){}}}",
  "function restore(){cfg=null;cssText='';try{localStorage.removeItem(KEY);}catch(e){}cleanup();if(mo){mo.disconnect();mo=null;}delete window.__ocSkinEngine__;return 'ok';}",
  "function boot(){var raw=null;try{raw=JSON.parse(localStorage.getItem(KEY));}catch(e){raw=null;}",
  "if(raw&&raw.v===1&&raw.cfg&&typeof raw.css==='string'){cfg=raw.cfg;cssText=raw.css;}",
  "if(cfg){try{ensure();}catch(e){window.__ocSkinErr__='boot:'+String(e&&e.message||e);}}}",
  "function start(c,css){HD=document.documentElement||document.getElementsByTagName('html')[0];try{boot();}catch(e){window.__ocSkinErr__='boot0:'+String(e&&e.message||e);}try{apply(c,css);}catch(e){window.__ocSkinErr__='start:'+String(e&&e.message||e);}}",
  "window.__ocSkinEngine__={v:3,apply:apply,restore:restore,kill:function(){if(mo){mo.disconnect();mo=null;}cleanup();}};",
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
