import { Router } from "express";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { detectInjector, buildSkinPack, runInjector } from "../lib/desktop.js";
import {
  CDP_PORT_DEFAULT,
  collectStatus,
  launchDesktop,
  isPortUp,
  closeDesktopInstances,
  applySkinOnTarget,
  restoreOnTarget,
  evaluateOnTarget,
  captureScreenshotOnTarget,
  skinHealthCheckOnTarget,
  type SkinHealth,
} from "../lib/cdp.js";
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

router.post("/inject", (_req, res) => {
  try {
    res.json(runInjector());
  } catch (e) {
    bad(res, e);
  }
});

/* ---------- 内置 CDP 注入（M6） ---------- */

function lastConfigPath(): string {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
  return path.join(root, "presets", "desktop-skins", "last.json");
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
      if (req.body?.force) await closeDesktopInstances();
      await launchDesktop(port);
    }
    res.json({ ok: true, ...(await collectStatus(port)) });
  } catch (e) {
    bad(res, e);
  }
});

/** 所有可注入的 page 目标（支持多窗口/多 tab）；单次 /json 请求完成探测。 */
async function pageWsUrls(port: number): Promise<string[]> {
  let list: unknown;
  try {
    const r = await fetch(`http://127.0.0.1:${port}/json`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    list = await r.json();
  } catch {
    throw new Error("调试端口未就绪，请先「启动并连接」");
  }
  return (Array.isArray(list) ? list : [])
    .filter(
      (t: { type?: string; webSocketDebuggerUrl?: string }) => t.type === "page" && !!t.webSocketDebuggerUrl,
    )
    .map((t: { webSocketDebuggerUrl: string }) => t.webSocketDebuggerUrl as string);
}

type ApplyOutcome = { label: string; error?: string; present?: boolean; health?: SkinHealth };

async function applyToAllPages(js: string, port = CDP_PORT_DEFAULT): Promise<ApplyOutcome[]> {
  const urls = await pageWsUrls(port);
  if (urls.length === 0) throw new Error("未发现可注入的页面目标");
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
    const outcomes = await applyToAllPages(js, port);
    const injected = outcomes.filter((o) => !o.error && o.present).length;
    if (injected === 0) {
      throw new Error(
        outcomes.map((o) => `${o.label}: ${o.error ?? "样式节点未出现"}`).join("；") || "注入失败",
      );
    }
    const badHealth = outcomes.filter((o) => o.health && o.health.ok === false && !o.health.unknown);
    const healthOk = badHealth.length === 0;
    try {
      const p = lastConfigPath();
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(
        p,
        JSON.stringify({ ...cfg, appliedAt: new Date().toISOString(), healthOk }, null, 2),
      );
    } catch {
      /* 记录失败不影响注入 */
    }
    res.json({
      ok: true,
      injected,
      total: outcomes.length,
      healthOk,
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
        results.push(await restoreOnTarget(u));
      } catch {
        /* 单个目标失败不影响其余窗口 */
      }
    }
    try {
      fs.rmSync(lastConfigPath(), { force: true });
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
  const js = buildSkinEngineJs(normalizeSkinConfig(raw));
  let present = 0;
  let reapplied = 0;
  for (const u of urls) {
    try {
      if ((await evaluateOnTarget(u, "!!document.getElementById('__oc_studio_style__')", 5000)) === true) {
        present++;
        continue;
      }
      await applySkinOnTarget(u, js);
      reapplied++;
    } catch {
      /* 单个目标失败不影响其余窗口 */
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

function stopWatch(): void {
  if (watchState.timer) clearInterval(watchState.timer);
  watchState.timer = null;
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
    id: "cream-glass",
    name: "奶油玻璃",
    desc: "浅色 · 柔和磨砂",
    builtin: true,
    params: {
      appearance: "light",
      accentHex: "#d8a7b1",
      panelAlpha: 0.5,
      blurPx: 24,
      titlebarAlpha: 0.4,
      imgBrightness: 105,
      imgContrast: 100,
      imgSaturate: 105,
      imgOpacity: 1,
    },
  },
  {
    id: "midnight-frost",
    name: "暗夜磨砂",
    desc: "深色 · 冷色玻璃",
    builtin: true,
    params: {
      appearance: "dark",
      accentHex: "#88c0d0",
      panelAlpha: 0.62,
      blurPx: 22,
      titlebarAlpha: 0.55,
      imgBrightness: 85,
      imgContrast: 105,
      imgSaturate: 100,
      imgOpacity: 1,
    },
  },
  {
    id: "minimal-clear",
    name: "极简透明",
    desc: "浅色 · 高透低模糊",
    builtin: true,
    params: {
      appearance: "light",
      accentHex: "#a3be8c",
      panelAlpha: 0.32,
      blurPx: 12,
      titlebarAlpha: 0.25,
      imgBrightness: 112,
      imgContrast: 98,
      imgSaturate: 95,
      imgOpacity: 1,
    },
  },
  {
    id: "sunset-rose",
    name: "落日玫瑰",
    desc: "深色 · 玫瑰暖调",
    builtin: true,
    params: {
      appearance: "dark",
      accentHex: "#fb7185",
      panelAlpha: 0.6,
      blurPx: 20,
      titlebarAlpha: 0.5,
      imgBrightness: 80,
      imgContrast: 108,
      imgSaturate: 110,
      imgOpacity: 1,
    },
  },
  {
    id: "aurora-teal",
    name: "极光青夜",
    desc: "深色 · 峡湾青",
    builtin: true,
    params: {
      appearance: "dark",
      accentHex: "#8fbcbb",
      panelAlpha: 0.58,
      blurPx: 18,
      titlebarAlpha: 0.48,
      imgBrightness: 82,
      imgContrast: 104,
      imgSaturate: 102,
      imgOpacity: 1,
    },
  },
  {
    id: "cedar-mist",
    name: "雪松晨雾",
    desc: "浅色 · 雾紫拿铁",
    builtin: true,
    params: {
      appearance: "light",
      accentHex: "#b48ead",
      panelAlpha: 0.45,
      blurPx: 22,
      titlebarAlpha: 0.35,
      imgBrightness: 108,
      imgContrast: 100,
      imgSaturate: 102,
      imgOpacity: 1,
    },
  },
  {
    id: "obsidian-crimson",
    name: "曜石深红",
    desc: "深色 · 低亮高对比",
    builtin: true,
    params: {
      appearance: "dark",
      accentHex: "#bf616a",
      panelAlpha: 0.7,
      blurPx: 26,
      titlebarAlpha: 0.6,
      imgBrightness: 70,
      imgContrast: 112,
      imgSaturate: 96,
      imgOpacity: 1,
    },
  },
  {
    id: "moonlight-whisper",
    name: "月白低语",
    desc: "浅色 · 极光蓝白",
    builtin: true,
    params: {
      appearance: "light",
      accentHex: "#5e81ac",
      panelAlpha: 0.55,
      blurPx: 30,
      titlebarAlpha: 0.42,
      imgBrightness: 118,
      imgContrast: 96,
      imgSaturate: 92,
      imgOpacity: 1,
    },
  },
];

function ensureBuiltinDesktopThemes(): void {
  const dir = desktopThemesDir();
  fs.mkdirSync(dir, { recursive: true });
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
    list.sort((a, b) =>
      a.builtin === b.builtin ? (b.createdAt ?? "").localeCompare(a.createdAt ?? "") : a.builtin ? -1 : 1,
    );
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
