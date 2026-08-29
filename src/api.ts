export type ThemeInfo = { name: string; size: number; mtime: number };
export type Swatch = { hex: string; share: number; h: number; s: number; l: number };
export type WallpaperInfo = { id: string; title: string };
export type VideoWallpaperInfo = { id: string; title: string; file: string; poster: string };
export type WtProfile = { id: string; name: string };
export type WtDetect = {
  found: boolean;
  settingsPath: string | null;
  profiles: WtProfile[];
  defaultProfileId: string | null;
  backupExists: boolean;
};
export type InjectorDetect = {
  found: boolean;
  repoPath: string | null;
  presetsDir: string | null;
  launcher: string | null;
};
export type OfficialTheme = { id: string; rawUrl: string };
export type PresetInfo = { id: string; title: string; desc: string };
export type Curated = { official: OfficialTheme[]; presets: PresetInfo[] };
export type RepoHit = {
  owner: string;
  repo: string;
  description: string;
  stars: number;
  pushedAt: string;
  url: string;
};
export type MarketSource = {
  kind: "official" | "preset" | "github";
  id?: string;
  owner?: string;
  repo?: string;
};
export type InstalledEntry = {
  name: string;
  source: MarketSource;
  installedAt: string;
  modified: boolean;
  updateAvailable: boolean | null;
};

export type SkinLastApplied = {
  light?: boolean;
  accentHex?: string;
  imageDataUrl?: string;
  focusX?: number;
  focusY?: number;
  imgBrightness?: number;
  imgContrast?: number;
  imgSaturate?: number;
  imgOpacity?: number;
  windowAlpha?: number;
  windowBlurPx?: number;
  appliedAt?: string;
  healthOk?: boolean;
};

/** 守护 tick 结果 → 中文摘要 */
export function watchTickLabel(result: string | null | undefined): string | null {
  if (!result) return null;
  if (result === "present") return "皮肤在位";
  if (result === "port-down") return "端口未开";
  if (result === "no-config") return "无注入记录";
  if (result === "no-targets") return "无页面目标";
  const m = /^reapplied:(\d+)$/.exec(result);
  if (m) return `已重注 ×${m[1]}`;
  return result;
}

export type CdpStatus = {
  exeFound: boolean;
  exePath: string | null;
  cdpPort: number;
  portUp: boolean;
  browserVersion: string | null;
  pages: Array<{ title: string; url: string }>;
  lastApplied: SkinLastApplied | null;
  watchEnabled?: boolean;
  watchLastTickAt?: string | null;
  watchLastTickResult?: string | null;
};
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

export type CdpApplyResult = {
  ok: boolean;
  injected: number;
  total: number;
  healthOk?: boolean;
  windowFx?: string;
  badHealth?: Array<{ label: string; bg?: string; sel?: string }>;
  errors?: Array<{ label: string; error: string }>;
};

export type DesktopTheme = {
  id: string;
  name: string;
  desc?: string;
  builtin?: boolean;
  createdAt?: string;
  params: SkinApplyParams;
};

async function handle<T>(res: Response): Promise<T> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const details = (data as { details?: unknown }).details;
    const detail = Array.isArray(details) ? ` (${details.map(String).join("; ")})` : "";
    const msg = (data as { error?: string }).error ?? res.statusText;
    throw new Error(`[${res.status}] ${msg}${detail}`);
  }
  return data as T;
}

export const api = {
  health: () => fetch("/api/health").then((r) => handle<{ ok: boolean; version: string }>(r)),
  listThemes: () => fetch("/api/themes").then((r) => handle<{ themes: ThemeInfo[] }>(r)),
  getTheme: (name: string) => fetch(`/api/themes/${encodeURIComponent(name)}`).then(handle<object>),
  putTheme: (name: string, theme: object) =>
    fetch(`/api/themes/${encodeURIComponent(name)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(theme),
    }).then(handle<{ ok: boolean }>),
  deleteTheme: (name: string) =>
    fetch(`/api/themes/${encodeURIComponent(name)}`, { method: "DELETE" }).then(handle<{ ok: boolean }>),
  applyTheme: (name: string) =>
    fetch(`/api/themes/${encodeURIComponent(name)}/apply`, { method: "POST" }).then(
      handle<{ ok: boolean; applied: string; restartRequired: boolean }>,
    ),
  tuiConfig: () => fetch("/api/themes/__tui/config").then(handle<Record<string, unknown>>),
  exportThemesUrl: "/api/themes/export",
  importThemes: (file: File) =>
    new Promise<{ ok: boolean; imported: string[]; skipped: string[]; invalid: string[] }>(
      (resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error("读取 zip 文件失败"));
        reader.onload = () => {
          const dataUrl = String(reader.result ?? "");
          const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
          fetch("/api/themes/import", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ contentBase64: base64 }),
          })
            .then(handle<{ ok: boolean; imported: string[]; skipped: string[]; invalid: string[] }>)
            .then(resolve, reject);
        };
        reader.readAsDataURL(file);
      },
    ),
  builtinWallpapers: () =>
    fetch("/api/images/builtin").then(handle<{ wallpapers: WallpaperInfo[]; videos: VideoWallpaperInfo[] }>),
  paletteFromPixels: (width: number, height: number, pixels: string, k = 6) =>
    fetch("/api/images/palette", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ width, height, pixels, k }),
    }).then(handle<{ palette: Swatch[]; theme: object }>),
  terminalDetect: () => fetch("/api/terminal/detect").then(handle<WtDetect>),
  terminalSetBackground: (body: {
    profileId?: string;
    imageDataUrl: string;
    acrylic?: boolean;
    opacity?: number;
    imageOpacity?: number;
    stretchMode?: string;
  }) =>
    fetch("/api/terminal/background", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then(handle<{ ok: boolean; backgroundImage: string; backup: string; note?: string }>),
  terminalRestore: () => fetch("/api/terminal/restore", { method: "POST" }).then(handle<{ ok: boolean }>),
  injectorDetect: () => fetch("/api/desktop/injector/detect").then(handle<InjectorDetect>),
  buildSkinPack: (body: {
    id: string;
    name: string;
    imageDataUrl: string;
    accentHex?: string;
    focusX?: number;
    focusY?: number;
    appearance?: string;
  }) =>
    fetch("/api/desktop/skin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then(handle<{ ok: boolean; themePath: string }>),
  runInjector: () =>
    fetch("/api/desktop/inject", { method: "POST" }).then(
      handle<{ ok: boolean; launcher: string; outputTail: string }>,
    ),
  marketCurated: () => fetch("/api/market/curated").then(handle<Curated>),
  marketOfficialColors: () =>
    fetch("/api/market/official-colors")
      .then(handle<{ colors: Record<string, string[]> }>)
      .then((d) => d.colors),
  marketSearch: (q: string) =>
    fetch(`/api/market/search?q=${encodeURIComponent(q)}`).then(
      handle<{ totalCount: number; repos: RepoHit[] }>,
    ),
  marketInstall: (
    body:
      | { kind: "official"; id: string }
      | { kind: "preset"; id: string }
      | { kind: "github"; owner: string; repo: string },
  ) =>
    fetch("/api/market/install", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then(handle<{ ok: boolean; name: string; path: string }>),
  marketInstalled: () => fetch("/api/market/installed").then(handle<{ themes: InstalledEntry[] }>),
  marketCheckUpdates: () =>
    fetch("/api/market/check-updates", { method: "POST" }).then(
      handle<{ results: Array<{ name: string; updateAvailable: boolean | null }>; checkedAt: string }>,
    ),
  cdpStatus: (port?: number) =>
    fetch(`/api/desktop/cdp/status${port ? `?port=${port}` : ""}`).then(handle<CdpStatus>),
  cdpLaunch: (port?: number) =>
    fetch("/api/desktop/cdp/launch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(port ? { port } : {}),
    }).then(handle<CdpStatus & { ok: boolean; launched: boolean }>),
  cdpLaunchForce: (port?: number) =>
    fetch("/api/desktop/cdp/launch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ port, force: true }),
    }).then(handle<CdpStatus & { ok: boolean; launched: boolean }>),
  cdpApply: (params: SkinApplyParams, port?: number) =>
    fetch("/api/desktop/cdp/apply", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...params, port }),
    }).then(handle<CdpApplyResult>),
  /** 动态壁纸：原始二进制上传视频，返回可注入的服务路径（需拼 origin 成绝对地址） */
  uploadVideo: async (file: File) => {
    const lower = file.name.toLowerCase();
    const ext = lower.endsWith(".webm") || file.type === "video/webm" ? "webm" : "mp4";
    if (!lower.endsWith(".mp4") && !lower.endsWith(".webm") && !file.type.startsWith("video/")) {
      throw new Error("仅支持 mp4 / webm 视频文件");
    }
    const r = await fetch(`/api/images/video?ext=${ext}`, {
      method: "POST",
      headers: { "Content-Type": `video/${ext}` },
      body: file,
    });
    return handle<{ ok: boolean; id: string; path: string }>(r);
  },
  cdpRestore: (port?: number) =>
    fetch("/api/desktop/cdp/restore", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ port }),
    }).then(handle<{ ok: boolean }>),
  cdpWatch: (enabled: boolean, port?: number) =>
    fetch("/api/desktop/cdp/watch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled, port }),
    }).then(handle<{ ok: boolean; watchEnabled: boolean }>),
  cdpScreenshot: (port?: number) =>
    fetch("/api/desktop/cdp/screenshot", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ port, format: "jpeg" }),
    }).then(handle<{ ok: boolean; dataUrl: string }>),
  desktopThemes: () => fetch("/api/desktop/themes").then(handle<{ themes: DesktopTheme[] }>),
  saveDesktopTheme: (body: { name: string; desc?: string; params: SkinApplyParams }) =>
    fetch("/api/desktop/themes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then(handle<{ ok: boolean; theme: DesktopTheme }>),
  deleteDesktopTheme: (id: string) =>
    fetch(`/api/desktop/themes/${encodeURIComponent(id)}`, { method: "DELETE" }).then(
      handle<{ ok: boolean }>,
    ),
};
