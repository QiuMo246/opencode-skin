import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { themesDir, ensureDirs } from "./paths.js";
import { writeFileAtomic } from "./fsio.js";
import { validateTuiTheme } from "./schema.js";

/* ---- 简易 HTTP 内存缓存（避免重复请求 GitHub API） ---- */
type CacheEntry = { value: unknown; expiresAt: number };
const httpCache = new Map<string, CacheEntry>();
const HTTP_CACHE_MAX = 128;

function httpCacheGet<T>(url: string): T | undefined {
  const e = httpCache.get(url);
  if (!e) return undefined;
  if (Date.now() > e.expiresAt) {
    httpCache.delete(url);
    return undefined;
  }
  return e.value as T;
}

function httpCacheSet(url: string, value: unknown, ttlMs: number): void {
  if (httpCache.size >= HTTP_CACHE_MAX) {
    const oldest = httpCache.keys().next().value;
    if (oldest !== undefined) httpCache.delete(oldest);
  }
  httpCache.set(url, { value, expiresAt: Date.now() + ttlMs });
}

export const OFFICIAL = {
  owner: "anomalyco",
  repo: "opencode",
  ref: "dev",
  dir: "packages/tui/src/theme/assets",
};

const UA = "oc-skin-studio/0.1 (local theme tool)";
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const FALLBACK_THEMES = [
  "aura",
  "ayu",
  "carbonfox",
  "catppuccin",
  "catppuccin-frappe",
  "catppuccin-macchiato",
  "cobalt2",
  "cursor",
  "dracula",
  "everforest",
  "flexoki",
  "github",
  "gruvbox",
  "kanagawa",
  "lucent-orng",
  "material",
  "matrix",
  "mercury",
  "monokai",
  "nightowl",
  "nord",
  "one-dark",
  "opencode",
  "orng",
  "osaka-jade",
  "palenight",
  "rosepine",
  "solarized",
  "synthwave84",
  "tokyonight",
  "vercel",
  "vesper",
  "zenburn",
];

export async function ghJson<T>(url: string): Promise<T> {
  const cached = httpCacheGet<T>(url);
  if (cached !== undefined) return cached;
  const res = await fetchWithRetry(url, {
    "User-Agent": UA,
    Accept: "application/vnd.github+json",
  });
  const data = (await res.json()) as T;
  httpCacheSet(url, data, 5 * 60_000);
  return data;
}

async function fetchWithRetry(url: string, headers: Record<string, string>, tries = 3): Promise<Response> {
  let lastErr: unknown;
  for (let i = 0; i < tries; i++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 20000);
    try {
      const res = await fetch(url, { headers, signal: ctrl.signal });
      if (res.ok) {
        clearTimeout(timer);
        return res;
      }
      clearTimeout(timer);
      if (res.status !== 0 && res.status < 500 && res.status !== 429) {
        throw new Error(`HTTP ${res.status} ${res.statusText}`);
      }
      lastErr = new Error(`HTTP ${res.status} ${res.statusText}`);
    } catch (e) {
      clearTimeout(timer);
      lastErr = e;
      if (e instanceof Error && e.message.startsWith("HTTP 4")) throw e;
    }
    await new Promise((r) => setTimeout(r, 800 * (i + 1)));
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

async function ghText(url: string): Promise<string> {
  const cached = httpCacheGet<string>(url);
  if (cached !== undefined) return cached;
  const res = await fetchWithRetry(url, { "User-Agent": UA });
  const text = await res.text();
  httpCacheSet(url, text, 30 * 60_000);
  return text;
}

export const sha256 = (s: string): string => crypto.createHash("sha256").update(s).digest("hex");

export type OfficialItem = { id: string; rawUrl: string };

export async function listOfficial(): Promise<OfficialItem[]> {
  try {
    const url = `https://api.github.com/repos/${OFFICIAL.owner}/${OFFICIAL.repo}/contents/${OFFICIAL.dir}?ref=${OFFICIAL.ref}`;
    const items = await ghJson<Array<{ name: string; download_url: string | null }>>(url);
    const list = items
      .filter((i) => i.name.endsWith(".json") && i.download_url)
      .map((i) => ({ id: i.name.slice(0, -5), rawUrl: i.download_url as string }));
    if (list.length > 0) return list;
    throw new Error("empty listing");
  } catch {
    return FALLBACK_THEMES.map((id) => ({
      id,
      rawUrl: `https://raw.githubusercontent.com/${OFFICIAL.owner}/${OFFICIAL.repo}/${OFFICIAL.ref}/${OFFICIAL.dir}/${id}.json`,
    }));
  }
}

/* ---- 官方主题色板提取（市场卡片预览条，落盘缓存 7 天） ---- */

const COLOR_CACHE_DIR = path.join(os.tmpdir(), "oc-skin-studio", "theme-colors");
const COLOR_TTL_MS = 7 * 24 * 3600 * 1000;
const HEX_RE = /^#[0-9a-fA-F]{3,8}$/;

const colorCachePath = (id: string): string => path.join(COLOR_CACHE_DIR, `${id}.json`);

type CachedColors = { colors: string[]; fetchedAt: string };

export function readOfficialColors(): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  try {
    for (const f of fs.readdirSync(COLOR_CACHE_DIR)) {
      if (!f.endsWith(".json")) continue;
      try {
        const c = JSON.parse(fs.readFileSync(path.join(COLOR_CACHE_DIR, f), "utf8")) as CachedColors;
        out[f.slice(0, -5)] = c.colors;
      } catch {
        /* 单个缓存损坏不影响其余 */
      }
    }
  } catch {
    /* 缓存目录不存在 */
  }
  return out;
}

function resolveColor(v: unknown, defs: Record<string, unknown>): string | null {
  if (v && typeof v === "object" && !Array.isArray(v)) v = (v as { dark?: unknown }).dark;
  if (typeof v !== "string") return null;
  if (HEX_RE.test(v)) return v.toLowerCase();
  const d = defs[v];
  if (typeof d === "string" && HEX_RE.test(d)) return d.toLowerCase();
  return null;
}

function pickColors(json: unknown): string[] {
  const root = json as { theme?: Record<string, unknown>; defs?: Record<string, unknown> };
  const slots = root?.theme;
  if (!slots || typeof slots !== "object") return [];
  const defs = (root?.defs && typeof root.defs === "object" ? root.defs : {}) as Record<string, unknown>;
  const picked: string[] = [];
  for (const key of ["background", "primary", "accent", "secondary", "text"]) {
    if (picked.length >= 5) break;
    const c = resolveColor(slots[key], defs);
    if (c && !picked.includes(c)) picked.push(c);
  }
  return picked;
}

let colorRefreshInFlight: Promise<void> | null = null;

export function refreshOfficialColors(): Promise<void> {
  if (colorRefreshInFlight) return colorRefreshInFlight;
  colorRefreshInFlight = (async () => {
    let items: OfficialItem[];
    try {
      items = await listOfficial();
    } catch {
      return;
    }
    fs.mkdirSync(COLOR_CACHE_DIR, { recursive: true });
    const stale = items.filter((it) => {
      try {
        const st = fs.statSync(colorCachePath(it.id));
        return Date.now() - st.mtimeMs > COLOR_TTL_MS;
      } catch {
        return true;
      }
    });
    const CONCURRENCY = 6;
    let cursor = 0;
    const worker = async () => {
      while (cursor < stale.length) {
        const it = stale[cursor++];
        try {
          const text = await ghText(it.rawUrl);
          const colors = pickColors(JSON.parse(text));
          if (colors.length >= 2) {
            const entry: CachedColors = { colors, fetchedAt: new Date().toISOString() };
            fs.writeFileSync(colorCachePath(it.id), JSON.stringify(entry));
          }
        } catch {
          /* 拉取失败的主题不显示色板 */
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, stale.length) }, worker));
  })().finally(() => {
    colorRefreshInFlight = null;
  });
  return colorRefreshInFlight;
}

type Slot = { dark: string; light: string };
const S = (dark: string, light: string): Slot => ({ dark, light });

function glassTheme(palette: Record<string, Slot>, rawSlots: Record<string, Slot>) {
  const theme: Record<string, Slot> = {};
  for (const [k, v] of Object.entries(rawSlots)) {
    const dk = palette[v.dark] ? palette[v.dark].dark : v.dark;
    const lt = palette[v.light] ? palette[v.light].light : v.light;
    theme[k] = { dark: dk, light: lt };
  }
  return { $schema: "https://opencode.ai/theme.json", theme };
}

export type PresetInfo = { id: string; title: string; desc: string };

export const PRESETS: PresetInfo[] = [
  {
    id: "liquid-glass",
    title: "Liquid Glass 磨砂玻璃",
    desc: "冷灰蓝底 + 冰蓝高光的半透明质感，深浅双模式",
  },
  {
    id: "liquid-glass-aurora",
    title: "Liquid Glass 极光",
    desc: "墨绿底 + 薄荷/紫罗兰渐层点缀的玻璃质感，深浅双模式",
  },
];

export function buildPreset(id: string): object | null {
  if (id === "liquid-glass") {
    return glassTheme(
      {
        ink: S("#e8ecf4", "#1a2230"),
        inkSoft: S("#8a93a6", "#5b6577"),
        canvas: S("#10131a", "#f4f6fa"),
        panel: S("#171b24", "#eceff5"),
        elem: S("#1d2230", "#e3e8f0"),
        line: S("#2a3142", "#cdd5e1"),
        lineHot: S("#3d4759", "#aab4c4"),
        glow: S("#7dd3fc", "#0ea5e9"),
        haze: S("#a5b4fc", "#6366f1"),
        mint: S("#6ee7b7", "#059669"),
        amber: S("#fbbf24", "#b45309"),
        rose: S("#f87171", "#dc2626"),
        cyan: S("#67e8f9", "#0891b2"),
        addedBg: S("#12332b", "#d7f2e5"),
        removedBg: S("#3a1d20", "#fbdddb"),
      },
      {
        primary: S("glow", "glow"),
        secondary: S("haze", "haze"),
        accent: S("cyan", "cyan"),
        error: S("rose", "rose"),
        warning: S("amber", "amber"),
        success: S("mint", "mint"),
        info: S("glow", "haze"),
        text: S("ink", "ink"),
        textMuted: S("inkSoft", "inkSoft"),
        background: S("canvas", "canvas"),
        backgroundPanel: S("panel", "panel"),
        backgroundElement: S("elem", "elem"),
        border: S("line", "line"),
        borderActive: S("lineHot", "lineHot"),
        borderSubtle: S("line", "line"),
        diffAdded: S("mint", "mint"),
        diffRemoved: S("rose", "rose"),
        diffContext: S("lineHot", "line"),
        diffHunkHeader: S("haze", "haze"),
        diffHighlightAdded: S("mint", "mint"),
        diffHighlightRemoved: S("rose", "rose"),
        diffAddedBg: S("addedBg", "addedBg"),
        diffRemovedBg: S("removedBg", "removedBg"),
        diffContextBg: S("panel", "panel"),
        diffLineNumber: S("line", "line"),
        diffAddedLineNumberBg: S("addedBg", "addedBg"),
        diffRemovedLineNumberBg: S("removedBg", "removedBg"),
        markdownText: S("ink", "ink"),
        markdownHeading: S("glow", "haze"),
        markdownLink: S("cyan", "cyan"),
        markdownLinkText: S("mint", "mint"),
        markdownCode: S("mint", "mint"),
        markdownBlockQuote: S("inkSoft", "inkSoft"),
        markdownEmph: S("amber", "amber"),
        markdownStrong: S("cyan", "cyan"),
        markdownHorizontalRule: S("line", "line"),
        markdownListItem: S("glow", "haze"),
        markdownListEnumeration: S("cyan", "cyan"),
        markdownImage: S("cyan", "cyan"),
        markdownImageText: S("mint", "mint"),
        markdownCodeBlock: S("ink", "ink"),
        syntaxComment: S("inkSoft", "inkSoft"),
        syntaxKeyword: S("haze", "haze"),
        syntaxFunction: S("glow", "glow"),
        syntaxVariable: S("cyan", "cyan"),
        syntaxString: S("mint", "mint"),
        syntaxNumber: S("amber", "amber"),
        syntaxType: S("cyan", "cyan"),
        syntaxOperator: S("haze", "haze"),
        syntaxPunctuation: S("ink", "ink"),
      },
    );
  }
  if (id === "liquid-glass-aurora") {
    return glassTheme(
      {
        ink: S("#e6f2ec", "#16241d"),
        inkSoft: S("#84a396", "#4f6b60"),
        canvas: S("#0c1512", "#f2f8f4"),
        panel: S("#121e19", "#e7efe9"),
        elem: S("#17271f", "#dde9e1"),
        line: S("#23362d", "#c2d4c8"),
        lineHot: S("#33493e", "#a3baac"),
        mint: S("#5eead4", "#0d9488"),
        violet: S("#c4b5fd", "#7c3aed"),
        lime: S("#bef264", "#4d7c0f"),
        sky: S("#7dd3fc", "#0369a1"),
        rose: S("#fb7185", "#be123c"),
        amber: S("#fcd34d", "#a16207"),
        addedBg: S("#10312a", "#d5f0e4"),
        removedBg: S("#371a22", "#fadde2"),
      },
      {
        primary: S("mint", "mint"),
        secondary: S("violet", "violet"),
        accent: S("lime", "lime"),
        error: S("rose", "rose"),
        warning: S("amber", "amber"),
        success: S("mint", "mint"),
        info: S("sky", "sky"),
        text: S("ink", "ink"),
        textMuted: S("inkSoft", "inkSoft"),
        background: S("canvas", "canvas"),
        backgroundPanel: S("panel", "panel"),
        backgroundElement: S("elem", "elem"),
        border: S("line", "line"),
        borderActive: S("lineHot", "lineHot"),
        borderSubtle: S("line", "line"),
        diffAdded: S("mint", "mint"),
        diffRemoved: S("rose", "rose"),
        diffContext: S("lineHot", "line"),
        diffHunkHeader: S("violet", "violet"),
        diffHighlightAdded: S("lime", "lime"),
        diffHighlightRemoved: S("rose", "rose"),
        diffAddedBg: S("addedBg", "addedBg"),
        diffRemovedBg: S("removedBg", "removedBg"),
        diffContextBg: S("panel", "panel"),
        diffLineNumber: S("line", "line"),
        diffAddedLineNumberBg: S("addedBg", "addedBg"),
        diffRemovedLineNumberBg: S("removedBg", "removedBg"),
        markdownText: S("ink", "ink"),
        markdownHeading: S("mint", "mint"),
        markdownLink: S("sky", "sky"),
        markdownLinkText: S("lime", "lime"),
        markdownCode: S("amber", "amber"),
        markdownBlockQuote: S("inkSoft", "inkSoft"),
        markdownEmph: S("violet", "violet"),
        markdownStrong: S("sky", "sky"),
        markdownHorizontalRule: S("line", "line"),
        markdownListItem: S("mint", "mint"),
        markdownListEnumeration: S("violet", "violet"),
        markdownImage: S("sky", "sky"),
        markdownImageText: S("lime", "lime"),
        markdownCodeBlock: S("ink", "ink"),
        syntaxComment: S("inkSoft", "inkSoft"),
        syntaxKeyword: S("violet", "violet"),
        syntaxFunction: S("mint", "mint"),
        syntaxVariable: S("sky", "sky"),
        syntaxString: S("lime", "lime"),
        syntaxNumber: S("amber", "amber"),
        syntaxType: S("mint", "sky"),
        syntaxOperator: S("violet", "violet"),
        syntaxPunctuation: S("ink", "ink"),
      },
    );
  }
  return null;
}

export type SourceMeta = {
  kind: "official" | "preset" | "github";
  id?: string;
  owner?: string;
  repo?: string;
  ref?: string;
  path?: string;
};

export type Sidecar = {
  source: SourceMeta;
  contentSha256: string;
  installedAt: string;
  updateAvailable?: boolean | null;
};

const sidecarPath = (name: string): string => path.join(themesDir(), `${name}.market.json`);

function sanitizeName(base: string): string {
  const n = base
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return NAME_RE.test(n) ? n.slice(0, 63) : "";
}

function uniqueName(name: string): string {
  let candidate = name;
  let i = 2;
  while (fs.existsSync(path.join(themesDir(), `${candidate}.json`))) {
    const suffix = i <= 6 ? `-${i}` : `-${Date.now().toString(36)}`;
    candidate = `${name.slice(0, 63 - suffix.length)}${suffix}`;
    i += 1;
    if (i > 40) break;
  }
  return candidate;
}

async function writeInstalled(
  desiredName: string,
  themeObj: object,
  source: SourceMeta,
): Promise<{ name: string; path: string }> {
  const withSchema = { $schema: "https://opencode.ai/theme.json", ...(themeObj as Record<string, unknown>) };
  const check = validateTuiTheme(withSchema);
  if (!check.ok) {
    throw new Error(`schema 校验失败: ${check.errors.slice(0, 3).join("; ")}`);
  }
  ensureDirs();
  const name = uniqueName(sanitizeName(desiredName));
  if (!name) throw new Error(`无法从 "${desiredName}" 生成合法主题名`);
  const p = path.join(themesDir(), `${name}.json`);
  const text = JSON.stringify(withSchema, null, 2) + "\n";
  writeFileAtomic(p, text);
  const car: Sidecar = { source, contentSha256: sha256(text), installedAt: new Date().toISOString() };
  writeFileAtomic(sidecarPath(name), JSON.stringify(car, null, 2) + "\n");
  return { name, path: p };
}

export type InstallRequest =
  | { kind: "official"; id: string }
  | { kind: "preset"; id: string }
  | { kind: "github"; owner: string; repo: string; ref?: string };

function parseThemeCandidate(text: string, fileLabel: string): object {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`${fileLabel} 不是有效 JSON`);
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new Error(`${fileLabel} 不是 JSON 对象`);
  }
  const obj = data as Record<string, unknown>;
  if (!("theme" in obj)) throw new Error(`${fileLabel} 缺少 theme 键`);
  return obj;
}

export async function install(req: InstallRequest): Promise<{ name: string; path: string }> {
  if (req.kind === "preset") {
    const obj = buildPreset(req.id);
    if (!obj) throw new Error(`未知预设: ${req.id}`);
    return writeInstalled(req.id, obj, { kind: "preset", id: req.id });
  }
  if (req.kind === "official") {
    if (!sanitizeName(req.id)) throw new Error("非法主题 id");
    const url = `https://raw.githubusercontent.com/${OFFICIAL.owner}/${OFFICIAL.repo}/${OFFICIAL.ref}/${OFFICIAL.dir}/${req.id}.json`;
    const text = await ghText(url);
    return writeInstalled(req.id, parseThemeCandidate(text, req.id), { kind: "official", id: req.id });
  }
  // github repo
  const owner = String(req.owner || "").trim();
  const repo = String(req.repo || "").trim();
  if (!/^[A-Za-z0-9_.-]{1,64}$/.test(owner) || !/^[A-Za-z0-9_.-]{1,128}$/.test(repo)) {
    throw new Error("非法 owner/repo");
  }
  let ref = (req.ref ?? "").trim();
  if (!ref) {
    const info = await ghJson<{ default_branch: string }>(`https://api.github.com/repos/${owner}/${repo}`);
    ref = info.default_branch || "main";
  }
  const tree = await ghJson<{ tree: Array<{ path: string; type: string; size?: number }> }>(
    `https://api.github.com/repos/${owner}/${repo}/git/trees/${encodeURIComponent(ref)}?recursive=1`,
  );
  const candidates = tree.tree
    .filter(
      (n) =>
        n.type === "blob" &&
        n.path.endsWith(".json") &&
        !/(^|\/)(package|package-lock|tsconfig|bun\.lockb?|deno)\.jsonc?$/i.test(n.path) &&
        !n.path.includes("node_modules") &&
        (n.size ?? 99999) < 200000,
    )
    .slice(0, 12)
    .map((n) => n.path);
  let lastErr = "未在仓库中找到可用的 opencode 主题文件";
  for (const p of candidates) {
    try {
      const raw = await ghText(
        `https://raw.githubusercontent.com/${owner}/${repo}/${encodeURIComponent(ref)}/${p}`,
      );
      const obj = parseThemeCandidate(raw, p);
      const base = path.basename(p, ".json");
      const desired = candidates.length > 1 ? `${repo}-${base}` : repo;
      return await writeInstalled(desired, obj, { kind: "github", owner, repo, ref, path: p });
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e);
    }
  }
  throw new Error(lastErr);
}

export type InstalledEntry = {
  name: string;
  source: SourceMeta;
  installedAt: string;
  modified: boolean;
  updateAvailable: boolean | null;
};

function readSidecar(name: string): Sidecar | null {
  try {
    const raw = fs.readFileSync(sidecarPath(name), "utf8");
    const data = JSON.parse(raw) as Sidecar;
    if (data?.source?.kind && typeof data.contentSha256 === "string") return data;
  } catch {
    /* no sidecar */
  }
  return null;
}

export function installedList(): InstalledEntry[] {
  ensureDirs();
  const dir = themesDir();
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".market.json"))
    .map((f) => {
      const name = path.basename(f, ".market.json");
      const car = readSidecar(name);
      if (!car) return null;
      let modified: boolean;
      try {
        const text = fs.readFileSync(path.join(dir, `${name}.json`), "utf8");
        modified = sha256(text) !== car.contentSha256;
      } catch {
        return null;
      }
      return {
        name,
        source: car.source,
        installedAt: car.installedAt,
        modified,
        updateAvailable: car.updateAvailable ?? null,
      };
    })
    .filter((x): x is InstalledEntry => x !== null)
    .sort((a, b) => a.name.localeCompare(b.name));
}

async function remoteSha(car: Sidecar): Promise<string | null> {
  const s = car.source;
  try {
    if (s.kind === "official" && s.id) {
      const url = `https://raw.githubusercontent.com/${OFFICIAL.owner}/${OFFICIAL.repo}/${OFFICIAL.ref}/${OFFICIAL.dir}/${s.id}.json`;
      return sha256(JSON.stringify(parseThemeCandidate(await ghText(url), s.id), null, 2) + "\n");
    }
    if (s.kind === "github" && s.owner && s.repo && s.path && s.ref) {
      const raw = await ghText(
        `https://raw.githubusercontent.com/${s.owner}/${s.repo}/${encodeURIComponent(s.ref)}/${s.path}`,
      );
      return sha256(JSON.stringify(parseThemeCandidate(raw, s.path), null, 2) + "\n");
    }
  } catch {
    return null;
  }
  return null;
}

export async function checkUpdates(): Promise<{
  results: Array<Pick<InstalledEntry, "name" | "updateAvailable">>;
  checkedAt: string;
}> {
  const entries = installedList()
    .map((e) => ({ e, car: readSidecar(e.name) }))
    .filter((x): x is { e: InstalledEntry; car: Sidecar } => {
      return !!x.car && (x.car.source.kind === "official" || x.car.source.kind === "github");
    });
  const results: Array<Pick<InstalledEntry, "name" | "updateAvailable">> = [];
  const CONCURRENCY = 6;
  let cursor = 0;
  const worker = async () => {
    while (cursor < entries.length) {
      const { e, car } = entries[cursor++];
      const remote = await remoteSha(car);
      const avail = remote === null ? null : remote !== car.contentSha256;
      if (avail !== null) {
        car.updateAvailable = avail;
        await writeFileAtomic(sidecarPath(e.name), JSON.stringify(car, null, 2) + "\n");
      }
      results.push({ name: e.name, updateAvailable: avail });
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, entries.length) }, worker));
  return { results, checkedAt: new Date().toISOString() };
}
