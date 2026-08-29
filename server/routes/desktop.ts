import { Router } from "express";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { detectInjector, buildSkinPack, runInjector } from "../lib/desktop.js";
import {
  CDP_PORT_DEFAULT,
  collectStatus,
  findDesktopExe,
  launchDesktop,
  isPortUp,
  closeDesktopInstances,
  applySkinOnTarget,
  restoreOnTarget,
  evaluateOnTarget,
  setBgOverrideOnTarget,
  captureScreenshotOnTarget,
  skinHealthCheckOnTarget,
  type SkinHealth,
} from "../lib/cdp.js";
import { setWindowTransparency, windowFxMode } from "../lib/windowFx.js";
import { buildSkinEngineJs, normalizeSkinConfig, type SkinApplyParams } from "../lib/desktopSkin.js";
import { writeFileAtomic } from "../lib/fsio.js";
import { opencodeConfigDir } from "../lib/paths.js";

const router = Router();

/* 守护状态恢复：首次访问本路由时按 flag 文件惰性启动（避免模块导入期副作用） */
let watchBootstrapped = false;
router.use((_req, _res, next) => {
  if (watchBootstrapped) return next();
  watchBootstrapped = true;
  try {
    const flag = JSON.parse(fs.readFileSync(watchFlagPath(), "utf8")) as { enabled?: boolean; port?: number };
    if (flag.enabled === false) stopWatch();
    else startWatch(Number(flag.port) || CDP_PORT_DEFAULT);
  } catch {
    startWatch(CDP_PORT_DEFAULT); /* 首次运行默认开启守护 */
  }
  return next();
});

const bad = (res: import("express").Response, e: unknown) =>
  res.status(400).json({ error: e instanceof Error ? e.message : String(e) });

router.get("/injector/detect", (_req, res) => {
  res.json(detectInjector());
});

router.post("/skin", (req, res) => {
  try {
    res.json(buildSkinPack(req.body ?? {}));
  } catch (e) {
    bad(res, e);
  }
});

router.post("/inject", async (_req, res) => {
  try {
    res.json(await runInjector());
  } catch (e) {
    bad(res, e);
  }
});

/* ---------- 内置 CDP 注入（M6） ---------- */

function lastConfigDir(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "presets", "desktop-skins");
}

function lastConfigPath(): string {
  return path.join(lastConfigDir(), "last.json");
}

function lastCssCachePath(): string {
  return path.join(lastConfigDir(), "last.css");
}

router.get("/cdp/status", async (req, res) => {
  try {
    const port = Number(req.query.port) || CDP_PORT_DEFAULT;
    const status = await collectStatus(port);
    let lastApplied: unknown = null;
    try {
      lastApplied = JSON.parse(fs.readFileSync(lastConfigPath(), "utf8"));
    } catch {
      /* 无记录 */
    }
    res.json({
      ...status,
      lastApplied,
      watchEnabled: !!watchState.timer,
      watchLastTickAt: watchState.lastTickAt,
      watchLastTickResult: watchState.lastTickResult,
    });
  } catch (e) {
    bad(res, e);
  }
});

router.post("/cdp/launch", async (req, res) => {
  try {
    const port = Number(req.body?.port) || CDP_PORT_DEFAULT;
    if (!(await isPortUp(port))) {
      const wantForce = !!req.body?.force;
      if (wantForce) await closeDesktopInstances();
      try {
        await launchDesktop(port);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        // 面向大众的一键可用：普通“启动并连接”若因单实例锁快败，自动走“退出重启”路径
        if (!wantForce && msg.includes("已有")) {
          await closeDesktopInstances();
          await launchDesktop(port);
        } else {
          throw e;
        }
      }
    }
    res.json({ ok: true, ...(await collectStatus(port)) });
  } catch (e) {
    bad(res, e);
  }
});

/** 所有可注入的 page 目标（支持多窗口/多 tab）；单次 /json 请求完成探测。 */
async function pageWsUrls(port: number): Promise<string[]> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 3000);
  let list: unknown;
  try {
    const r = await fetch(`http://127.0.0.1:${port}/json`, { signal: ctl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    list = await r.json();
  } catch {
    throw new Error("调试端口未就绪，请先「启动并连接」");
  } finally {
    clearTimeout(timer);
  }
  return (Array.isArray(list) ? list : [])
    .filter(
      (t: { type?: string; webSocketDebuggerUrl?: string }) => t.type === "page" && !!t.webSocketDebuggerUrl,
    )
    .map((t: { webSocketDebuggerUrl: string }) => t.webSocketDebuggerUrl as string);
}

type ApplyOutcome = { label: string; error?: string; present?: boolean; health?: SkinHealth };

async function applyToAllPages(urls: string[], js: string): Promise<ApplyOutcome[]> {
  const outcomes: ApplyOutcome[] = [];
  for (let i = 0; i < urls.length; i++) {
    const o: ApplyOutcome = { label: urls.length > 1 ? `窗口${i + 1}` : "主窗口" };
    try {
      const r = await applySkinOnTarget(urls[i], js);
      o.present = r.present;
      o.health = await skinHealthCheckOnTarget(urls[i]).catch(() => undefined);
    } catch (e) {
      o.error = e instanceof Error ? e.message : String(e);
    }
    outcomes.push(o);
  }
  return outcomes;
}

router.post("/cdp/apply", async (req, res) => {
  try {
    const cfg = normalizeSkinConfig(req.body as SkinApplyParams);
    const port = Number(req.body?.port) || CDP_PORT_DEFAULT;
    const js = buildSkinEngineJs(cfg);
    const urls = await pageWsUrls(port);
    if (urls.length === 0) throw new Error("未发现可注入的页面目标");
    const outcomes = await applyToAllPages(urls, js);
    const injected = outcomes.filter((o) => !o.error && o.present).length;
    if (injected === 0) {
      throw new Error(
        outcomes.map((o) => `${o.label}: ${o.error ?? "样式节点未出现"}`).join("；") || "注入失败",
      );
    }
    const badHealth = outcomes.filter((o) => o.health && o.health.ok === false && !o.health.unknown);
    const healthOk = badHealth.length === 0;
    /* 窗口特效：透明>0 一律真实透出桌面（系统毛玻璃对 Electron 窗口不可用，见 windowFx.ts 头注），
     * 模糊由页面内面板/壁纸垫底层承接 */
    let windowFx = "";
    try {
      const winBlur = (cfg as { windowBlurPx?: number }).windowBlurPx ?? 4;
      const mode = windowFxMode(cfg.windowAlpha ?? 1);
      for (const u of urls) await setBgOverrideOnTarget(u, mode === "transparent");
      if (mode === "transparent") {
        const exe = findDesktopExe();
        if (!exe) throw new Error("未找到 OpenCode Desktop 可执行文件");
        const r = await setWindowTransparency(exe, cfg.windowAlpha ?? 1);
        windowFx = `窗口透明已应用（${r.windows} 个窗口）${winBlur > 0 ? ` · 面板磨砂 ${winBlur}px` : ""}`;
      } else {
        const exe = findDesktopExe();
        if (exe) await setWindowTransparency(exe, 1).catch(() => undefined);
        windowFx = "窗口透明已关闭";
      }
    } catch (e) {
      windowFx = `窗口透明失败：${e instanceof Error ? e.message : e}`;
    }
    try {
      const p = lastConfigPath();
      writeFileAtomic(
        p,
        JSON.stringify({ ...cfg, appliedAt: new Date().toISOString(), healthOk }, null, 2) + "\n",
      );
      /* 预生成 CSS 缓存：守护轮询时可直接读取，跳过重复的 normalizeSkinConfig + cssRulesFor 计算。
       * 引擎 JS 不是 JSON，走 writeFileAtomic 会被其 JSON 校验拒绝，直接落盘
       * （目录已由上方 last.json 的原子写创建）。 */
      fs.writeFileSync(lastCssCachePath(), buildSkinEngineJs(cfg), "utf8");
    } catch {
      /* 记录失败不影响注入 */
    }
    res.json({
      ok: true,
      injected,
      total: outcomes.length,
      healthOk,
      windowFx,
      badHealth: badHealth.map((o) => ({ label: o.label, bg: o.health?.bg, sel: o.health?.sel })),
      errors: outcomes.filter((o) => o.error).map((o) => ({ label: o.label, error: o.error })),
    });
  } catch (e) {
    bad(res, e);
  }
});

router.post("/cdp/screenshot", async (req, res) => {
  try {
    const port = Number(req.body?.port) || CDP_PORT_DEFAULT;
    const urls = await pageWsUrls(port);
    if (urls.length === 0) throw new Error("未发现可截图的页面目标");
    const format = req.body?.format === "png" ? "png" : "jpeg";
    const dataUrl = await captureScreenshotOnTarget(urls[0], format);
    res.json({ ok: true, dataUrl });
  } catch (e) {
    bad(res, e);
  }
});

router.post("/cdp/restore", async (req, res) => {
  try {
    const port = Number(req.body?.port) || CDP_PORT_DEFAULT;
    const urls = await pageWsUrls(port);
    const results: unknown[] = [];
    for (const u of urls) {
      try {
        await setBgOverrideOnTarget(u, false).catch(() => undefined);
        results.push(await restoreOnTarget(u));
      } catch {
        /* 单个目标失败不影响其余窗口 */
      }
    }
    const exe = findDesktopExe();
    if (exe) await setWindowTransparency(exe, 1).catch(() => undefined);
    try {
      fs.rmSync(lastConfigPath(), { force: true });
      fs.rmSync(lastCssCachePath(), { force: true });
    } catch {
      /* 忽略 */
    }
    res.json({ ok: true, restored: results.length, result: results[0] });
  } catch (e) {
    bad(res, e);
  }
});

/* ---------- 自动注入守护（参考 opencodedev-skin 的 auto-inject 思路） ---------- */

const watchState: {
  timer: ReturnType<typeof setInterval> | null;
  port: number;
  lastTickAt: string | null;
  lastTickResult: string | null;
} = {
  timer: null,
  port: CDP_PORT_DEFAULT,
  lastTickAt: null,
  lastTickResult: null,
};

function watchFlagPath(): string {
  return path.join(path.dirname(lastConfigPath()), "watch.json");
}

async function reapplyIfMissing(): Promise<string> {
  // pageWsUrls 失败即端口未就绪，单次 /json 请求完成探测（无需先 isPortUp）
  let urls: string[];
  try {
    urls = await pageWsUrls(watchState.port);
  } catch {
    return "port-down";
  }
  let raw: SkinApplyParams | null;
  try {
    raw = JSON.parse(fs.readFileSync(lastConfigPath(), "utf8"));
  } catch {
    return "no-config";
  }
  if (!raw) return "no-config";
  if (urls.length === 0) return "no-targets";
  /* 优先读取预生成的 CSS 缓存，避免每 5 秒重复 normalizeSkinConfig + cssRulesFor */
  let js: string;
  try {
    js = fs.readFileSync(lastCssCachePath(), "utf8");
  } catch {
    js = buildSkinEngineJs(normalizeSkinConfig(raw));
  }
  const winAlpha = (raw as { windowAlpha?: number }).windowAlpha ?? 1;
  const fxMode = windowFxMode(winAlpha);
  const needWindowFx = fxMode === "transparent";
  const needBgOverride = needWindowFx;
  let present = 0;
  let reapplied = 0;
  for (const u of urls) {
    try {
      if ((await evaluateOnTarget(u, "!!document.getElementById('__oc_studio_style__')", 5000)) === true) {
        present++;
        continue;
      }
      await applySkinOnTarget(u, js);
      /* 重载后渲染器底色覆盖会失效，随守护一起恢复 */
      if (needBgOverride) await setBgOverrideOnTarget(u, true);
      reapplied++;
    } catch {
      /* 单个目标失败不影响其余窗口 */
    }
  }
  // 窗口透明需随守护一起恢复：即使样式节点仍在（localStorage 自举），窗口句柄重建后 layered 会丢失
  if (needWindowFx && (reapplied > 0 || watchState.lastTickResult !== "present")) {
    try {
      const exe = findDesktopExe();
      if (exe) {
        await setWindowTransparency(exe, winAlpha);
        // 已重建的窗口也需补一次渲染器透明（present 的窗口之前跳过了上面的 setBgOverride）
        if (present > 0 && reapplied === 0) {
          for (const u of urls) await setBgOverrideOnTarget(u, true).catch(() => undefined);
        }
      }
    } catch {
      /* 窗口透明失败不影响注入守护 */
    }
  }
  return reapplied > 0 ? `reapplied:${reapplied}` : present > 0 ? "present" : "no-targets";
}

function startWatch(port: number): void {
  stopWatch();
  watchState.port = port;
  watchState.timer = setInterval(() => {
    void reapplyIfMissing()
      .then((result) => {
        watchState.lastTickAt = new Date().toISOString();
        watchState.lastTickResult = result;
      })
      .catch((e) => {
        console.warn("[cdp-watch] 自动注入守护失败:", e instanceof Error ? e.message : e);
      });
  }, 5000);
  try {
    fs.mkdirSync(path.dirname(watchFlagPath()), { recursive: true });
    fs.writeFileSync(watchFlagPath(), JSON.stringify({ enabled: true, port }));
  } catch {
    /* 忽略 */
  }
}

/** 停止守护定时器。persist=false 用于进程退出等场景：只清定时器，不把用户开启的
 * 守护状态覆写为 disabled，保证下次启动仍能按 flag 文件恢复。 */
function stopWatch(persist = true): void {
  if (watchState.timer) clearInterval(watchState.timer);
  watchState.timer = null;
  if (!persist) return;
  try {
    fs.writeFileSync(watchFlagPath(), JSON.stringify({ enabled: false, port: watchState.port }));
  } catch {
    /* 忽略 */
  }
}

router.post("/cdp/watch", (req, res) => {
  const enabled = req.body?.enabled === true;
  const port = Number(req.body?.port) || CDP_PORT_DEFAULT;
  if (enabled) startWatch(port);
  else stopWatch();
  res.json({ ok: true, watchEnabled: !!watchState.timer });
});

/* 退出时只清定时器；若写入 enabled:false，下次启动的「按 flag 恢复守护」永远失效 */
process.on("exit", () => stopWatch(false));
export default router;

/* ---------- 桌面端主题库（精选 + 用户自定义） ---------- */

type DesktopThemeFile = {
  id: string;
  name: string;
  desc?: string;
  builtin?: boolean;
  createdAt?: string;
  params: SkinApplyParams;
};

const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

function desktopThemesDir(): string {
  return path.join(opencodeConfigDir(), "oc-skin-studio", "desktop-themes");
}

/** 旧版本把主题存在 %TEMP%，迁移到用户配置目录，避免被系统清理掉。 */
let legacyMigrated = false;
function migrateLegacyThemes(): void {
  if (legacyMigrated) return;
  legacyMigrated = true;
  const legacy = path.join(os.tmpdir(), "oc-skin-studio", "desktop-themes");
  const dir = desktopThemesDir();
  try {
    if (!fs.existsSync(legacy)) return;
    fs.mkdirSync(dir, { recursive: true });
    for (const f of fs.readdirSync(legacy)) {
      const dst = path.join(dir, f);
      if (!f.endsWith(".json") || fs.existsSync(dst)) continue;
      fs.copyFileSync(path.join(legacy, f), dst);
    }
    fs.rmSync(legacy, { recursive: true, force: true });
  } catch {
    /* 迁移失败不影响正常功能 */
  }
}

const BUILTIN_DESKTOP_THEMES: Array<Omit<DesktopThemeFile, "createdAt">> = [
  {
    id: "frost-plume",
    name: "霜羽",
    desc: "浅色 · 雾绒白",
    builtin: true,
    params: {
      appearance: "light",
      accentHex: "#8ea9c7",
      imgBrightness: 106,
      imgContrast: 98,
      imgSaturate: 94,
      imgOpacity: 1,
    },
  },
  {
    id: "ink-tide",
    name: "夜汐",
    desc: "深色 · 午夜蓝",
    builtin: true,
    params: {
      appearance: "dark",
      accentHex: "#7fb0b3",
      imgBrightness: 82,
      imgContrast: 104,
      imgSaturate: 98,
      imgOpacity: 1,
    },
  },
  {
    id: "rice-paper",
    name: "素笺",
    desc: "浅色 · 米纸米灰",
    builtin: true,
    params: {
      appearance: "light",
      accentHex: "#c1a48a",
      imgBrightness: 108,
      imgContrast: 96,
      imgSaturate: 90,
      imgOpacity: 1,
    },
  },
  {
    id: "ember-rock",
    name: "烬岩",
    desc: "深色 · 窑火陶橙",
    builtin: true,
    params: {
      appearance: "dark",
      accentHex: "#c98a6f",
      imgBrightness: 78,
      imgContrast: 107,
      imgSaturate: 104,
      imgOpacity: 1,
    },
  },
  {
    id: "moss-court",
    name: "苔庭",
    desc: "浅色 · 苔绿晨雾",
    builtin: true,
    params: {
      appearance: "light",
      accentHex: "#8da89b",
      imgBrightness: 104,
      imgContrast: 99,
      imgSaturate: 96,
      imgOpacity: 1,
    },
  },
  {
    id: "abyss-blue",
    name: "渊蓝",
    desc: "深色 · 深海钢蓝",
    builtin: true,
    params: {
      appearance: "dark",
      accentHex: "#7ea6d1",
      imgBrightness: 80,
      imgContrast: 106,
      imgSaturate: 98,
      imgOpacity: 1,
    },
  },
  {
    id: "obsidian-ink",
    name: "曜夜",
    desc: "深色 · 曜石墨",
    builtin: true,
    params: {
      appearance: "dark",
      accentHex: "#b07a77",
      imgBrightness: 74,
      imgContrast: 110,
      imgSaturate: 94,
      imgOpacity: 1,
    },
  },
  {
    id: "moon-veil",
    name: "月绡",
    desc: "浅色 · 月白绡纱",
    builtin: true,
    params: {
      appearance: "light",
      accentHex: "#a7bcd6",
      imgBrightness: 110,
      imgContrast: 96,
      imgSaturate: 88,
      imgOpacity: 1,
    },
  },
];

function ensureBuiltinDesktopThemes(): void {
  const dir = desktopThemesDir();
  fs.mkdirSync(dir, { recursive: true });
  const keep = new Set(BUILTIN_DESKTOP_THEMES.map((t) => `${t.id}.json`));
  // 清理已下架的旧内置（丑版）——仅删 builtin=true 的遗留文件，不动用户自定义
  try {
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith(".json") || keep.has(f)) continue;
      try {
        const doc = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as DesktopThemeFile;
        if (doc.builtin) fs.rmSync(path.join(dir, f), { force: true });
      } catch {
        /* 忽略损坏文件，交由外层跳过 */
      }
    }
  } catch {
    /* 目录首次创建时无文件 */
  }
  for (const t of BUILTIN_DESKTOP_THEMES) {
    const p = path.join(dir, `${t.id}.json`);
    if (fs.existsSync(p)) continue;
    try {
      writeFileAtomic(p, JSON.stringify({ ...t, createdAt: new Date().toISOString() }, null, 2) + "\n");
    } catch {
      /* 单个写入失败不影响其余 */
    }
  }
}

router.get("/themes", (_req, res) => {
  try {
    migrateLegacyThemes();
    ensureBuiltinDesktopThemes();
    const list: DesktopThemeFile[] = [];
    for (const f of fs.readdirSync(desktopThemesDir())) {
      if (!f.endsWith(".json")) continue;
      try {
        list.push(JSON.parse(fs.readFileSync(path.join(desktopThemesDir(), f), "utf8")) as DesktopThemeFile);
      } catch {
        /* 跳过损坏文件 */
      }
    }
    const order = new Map(BUILTIN_DESKTOP_THEMES.map((t, i) => [t.id, i]));
    list.sort((a, b) => {
      if (a.builtin !== b.builtin) return a.builtin ? -1 : 1;
      if (a.builtin && b.builtin) return (order.get(a.id) ?? 999) - (order.get(b.id) ?? 999);
      return (b.createdAt ?? "").localeCompare(a.createdAt ?? "");
    });
    res.json({ themes: list });
  } catch (e) {
    bad(res, e);
  }
});

router.post("/themes", (req, res) => {
  try {
    migrateLegacyThemes();
    const name = String(req.body?.name ?? "").trim();
    if (!name) throw new Error("主题名称不能为空");
    const params = normalizeSkinConfig(req.body?.params ?? {}) as SkinApplyParams;
    delete (params as Record<string, unknown>).imageDataUrl;
    const base =
      name
        .toLowerCase()
        .replace(/[^a-z0-9-]+/g, "-")
        .replace(/^-+|-+$/g, "") || "theme";
    const dir = desktopThemesDir();
    fs.mkdirSync(dir, { recursive: true });
    let id = base;
    let n = 2;
    while (fs.existsSync(path.join(dir, `${id}.json`))) id = `${base}-${n++}`;
    const doc: DesktopThemeFile = {
      id,
      name,
      desc: typeof req.body?.desc === "string" ? req.body.desc : undefined,
      createdAt: new Date().toISOString(),
      params,
    };
    writeFileAtomic(path.join(dir, `${id}.json`), JSON.stringify(doc, null, 2) + "\n");
    res.json({ ok: true, theme: doc });
  } catch (e) {
    bad(res, e);
  }
});

router.delete("/themes/:id", (req, res) => {
  try {
    const id = String(req.params.id ?? "");
    if (!NAME_RE.test(id)) throw new Error("非法的主题 ID");
    const p = path.join(desktopThemesDir(), `${id}.json`);
    if (!fs.existsSync(p)) throw new Error("主题不存在");
    const doc = JSON.parse(fs.readFileSync(p, "utf8")) as DesktopThemeFile;
    if (doc.builtin) throw new Error("内置主题不可删除");
    fs.rmSync(p, { force: true });
    res.json({ ok: true });
  } catch (e) {
    bad(res, e);
  }
});
