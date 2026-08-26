import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import WebSocket from "ws";

export const CDP_PORT_DEFAULT = 9222;

export type DesktopStatus = {
  exeFound: boolean;
  exePath: string | null;
  cdpPort: number;
  portUp: boolean;
  browserVersion: string | null;
  pages: Array<{ title: string; url: string }>;
};

function exeCandidates(): string[] {
  const la = process.env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData", "Local");
  const out: string[] = [];
  if (process.env.OC_SKIN_DESKTOP_EXE) out.push(process.env.OC_SKIN_DESKTOP_EXE);
  const programs = path.join(la, "Programs");
  try {
    for (const d of fs.readdirSync(programs)) {
      if (!/open\s?code/i.test(d)) continue;
      const dir = path.join(programs, d);
      let files: fs.Dirent[] = [];
      try {
        files = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const f of files) {
        if (f.isFile() && /\.exe$/i.test(f.name) && !/^unins/i.test(f.name)) {
          out.push(path.join(dir, f.name));
        }
      }
    }
  } catch {
    /* Programs 目录不存在 */
  }
  return out;
}

/** 结果短缓存：watchdog 每 5s 轮询时避免反复扫描 %LOCALAPPDATA%\Programs。 */
let exeCache: { path: string | null; at: number } | null = null;
const EXE_CACHE_TTL_MS = 30_000;

export function findDesktopExe(): string | null {
  if (exeCache && Date.now() - exeCache.at < EXE_CACHE_TTL_MS) return exeCache.path;
  let found: string | null = null;
  for (const p of exeCandidates()) {
    if (fs.existsSync(p)) {
      found = p;
      break;
    }
  }
  exeCache = { path: found, at: Date.now() };
  return found;
}

async function fetchJson(url: string, timeoutMs: number): Promise<unknown> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: ctl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally {
    clearTimeout(t);
  }
}

export async function isPortUp(port: number): Promise<boolean> {
  try {
    await fetchJson(`http://127.0.0.1:${port}/json/version`, 1200);
    return true;
  } catch {
    return false;
  }
}

export async function collectStatus(port: number): Promise<DesktopStatus> {
  const exePath = findDesktopExe();
  let portUp = false;
  let browserVersion: string | null = null;
  let pages: DesktopStatus["pages"] = [];
  try {
    const v = (await fetchJson(`http://127.0.0.1:${port}/json/version`, 1200)) as { Browser?: string };
    portUp = true;
    browserVersion = v?.Browser ?? null;
    const list = await fetchJson(`http://127.0.0.1:${port}/json`, 1200);
    pages = (Array.isArray(list) ? list : [])
      .filter((t) => (t as { type?: string }).type === "page")
      .map((t) => ({ title: (t as { title?: string }).title ?? "", url: (t as { url?: string }).url ?? "" }));
  } catch {
    /* 端口未开 */
  }
  return { exeFound: !!exePath, exePath, cdpPort: port, portUp, browserVersion, pages };
}

export async function launchDesktop(port: number): Promise<{ launched: boolean; exePath: string }> {
  const exePath = findDesktopExe();
  if (!exePath) throw new Error("未找到 OpenCode Desktop 可执行文件（可用 OC_SKIN_DESKTOP_EXE 指定）");
  if (await isPortUp(port)) return { launched: false, exePath };
  // 经由 cmd start 启动，脱离本服务进程树：重启/关闭 Studio 不会连带关闭 OpenCode
  const launcher = spawn("cmd.exe", ["/c", "start", "", exePath, `--remote-debugging-port=${port}`], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  launcher.unref();
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (await isPortUp(port)) return { launched: true, exePath };
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(
    "已尝试启动 Desktop 但调试端口未就绪；若已有实例在运行，请先完全退出所有 OpenCode 窗口再试",
  );
}

export async function closeDesktopInstances(gracefulMs = 2500): Promise<{ closed: number; forced: number }> {
  const exe = findDesktopExe();
  if (!exe) return { closed: 0, forced: 0 };
  const name = path.basename(exe);
  const countProcs = (): number => {
    try {
      const out = spawnSync("tasklist", ["/FI", `IMAGENAME eq ${name}`, "/FO", "CSV", "/NH"], {
        encoding: "utf8",
        windowsHide: true,
      });
      const pat = new RegExp(`^"${name.replace(/[.\\]/g, "\\$&")}"`, "m");
      return (out.stdout ?? "").split(/\r?\n/).filter((l) => pat.test(l)).length;
    } catch {
      return 0;
    }
  };
  const before = countProcs();
  if (before === 0) return { closed: 0, forced: 0 };
  spawn("taskkill", ["/IM", name], { stdio: "ignore", windowsHide: true });
  await new Promise((r) => setTimeout(r, gracefulMs));
  let remaining = countProcs();
  let forced = 0;
  if (remaining > 0) {
    spawn("taskkill", ["/IM", name, "/F"], { stdio: "ignore", windowsHide: true });
    forced = remaining;
    await new Promise((r) => setTimeout(r, 800));
    remaining = countProcs();
  }
  if (remaining > 0) throw new Error(`无法退出已运行的 ${name}（${remaining} 个进程仍在），请手动关闭后重试`);
  return { closed: before, forced };
}

type CdpResponse = {
  id: number;
  result?: { result?: { value?: unknown }; exceptionDetails?: { text?: string } };
  error?: { message?: string };
};

/** 单连接内顺序执行多条 CDP 命令。 */
async function withCdp<T>(
  wsUrl: string,
  timeoutMs: number,
  fn: (send: (method: string, params?: object) => Promise<CdpResponse["result"]>) => Promise<T>,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let ws: WebSocket;
    try {
      ws = new WebSocket(wsUrl);
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
      return;
    }
    let settled = false;
    let nextId = 1;
    const pending = new Map<
      number,
      { resolve: (v: CdpResponse["result"]) => void; reject: (e: Error) => void }
    >();
    const finish = (fn2: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        ws.close();
      } catch {
        /* already closed */
      }
      fn2();
    };
    const timer = setTimeout(() => finish(() => reject(new Error("CDP 调用超时"))), timeoutMs);
    const send = (method: string, params?: object) =>
      new Promise<CdpResponse["result"]>((res2, rej2) => {
        const id = nextId++;
        pending.set(id, { resolve: res2, reject: rej2 });
        ws.send(JSON.stringify({ id, method, params: params ?? {} }));
      });
    ws.on("open", () =>
      fn(send).then(
        (v) => finish(() => resolve(v)),
        (e) => finish(() => reject(e)),
      ),
    );
    ws.on("message", (raw) => {
      let msg: CdpResponse;
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return;
      }
      const p = pending.get(msg.id);
      if (!p) return;
      pending.delete(msg.id);
      if (msg.error) p.reject(new Error(`CDP 错误: ${msg.error.message ?? "unknown"}`));
      else if (msg.result?.exceptionDetails)
        p.reject(new Error(`页面执行异常: ${msg.result.exceptionDetails.text ?? "unknown"}`));
      else p.resolve(msg.result);
    });
    ws.on("error", (err) => finish(() => reject(err)));
  });
}

/* ---------- 每次操作独立 ws 连接（用完即关，避免复用失效会话导致静默失败） ----------
 * 注：addScriptToEvaluateOnNewDocument 的注册可能随会话断开而丢失，
 * 刷新/重启后的持久化由「自动注入守护」（watch）兜底。 */

const PRESENT_CHECK = "!!document.getElementById('__oc_studio_style__')";

/** 应用皮肤：立即注入 + 注册新文档重放，并校验样式节点存在。 */
export async function applySkinOnTarget(
  wsUrl: string,
  js: string,
): Promise<{ immediate: unknown; present: boolean; registered: boolean }> {
  return withCdp(wsUrl, 20000, async (send) => {
    const immediate = (await send("Runtime.evaluate", { expression: js, returnByValue: true }))?.result
      ?.value;
    const r = (await send("Page.addScriptToEvaluateOnNewDocument", { source: js })) as
      { identifier?: string } | undefined;
    const chk = (await send("Runtime.evaluate", { expression: PRESENT_CHECK, returnByValue: true }))?.result
      ?.value;
    return { immediate, present: chk === true, registered: !!r?.identifier };
  });
}

const HEALTH_CHECK_JS = `(function(){
var sels=['main [class*="bg-background"],main [class*="bg-v2-background"]','aside','header[data-slot="titlebar-v2"]'];
for(var i=0;i<sels.length;i++){
var el=document.querySelector(sels[i]);
if(!el)continue;
var bg=getComputedStyle(el).backgroundColor;
var m=bg.match(/rgba?\\(([^)]+)\\)/);
var a=m?parseFloat(m[1].split(',')[3]):NaN;
return JSON.stringify({ok:isFinite(a)&&a<0.98,bg:bg,sel:sels[i]});
}
return JSON.stringify({ok:true,unknown:true});
})()`;

export type SkinHealth = { ok: boolean; unknown?: boolean; bg?: string; sel?: string };

/** 健康检查：验证关键表面确实是半透明（类名变化/被覆盖时能及时发现）。 */
export async function skinHealthCheckOnTarget(wsUrl: string): Promise<SkinHealth> {
  const v = await withCdp(
    wsUrl,
    10000,
    async (send) =>
      (await send("Runtime.evaluate", { expression: HEALTH_CHECK_JS, returnByValue: true }))?.result?.value,
  );
  try {
    const parsed = JSON.parse(String(v)) as SkinHealth;
    return parsed;
  } catch {
    return { ok: false, bg: String(v) };
  }
}

export async function restoreOnTarget(wsUrl: string): Promise<unknown> {
  return withCdp(wsUrl, 15000, async (send) => {
    const value = (await send("Runtime.evaluate", { expression: RESTORE_JS_SOURCE, returnByValue: true }))
      ?.result?.value;
    return value;
  });
}

const RESTORE_JS_SOURCE = `(function(){
if(window.__ocSkinEngine__ && typeof window.__ocSkinEngine__.restore==="function"){
try{return window.__ocSkinEngine__.restore();}catch(e){}
}
var e=document.getElementById("__oc_studio_style__"); if(e) e.remove();
document.documentElement.classList.remove("oc-studio-skin");
return "ok";
})()`;
/** 截取页面当前帧（fromSurface 强制渲染器出帧，窗口被遮挡也能拿到最新画面）。 */
export async function captureScreenshotOnTarget(
  wsUrl: string,
  format: "png" | "jpeg" = "png",
  quality = 70,
): Promise<string> {
  return withCdp(wsUrl, 15000, async (send) => {
    const params: Record<string, unknown> = { format, fromSurface: true };
    if (format === "jpeg") params.quality = quality;
    const r = (await send("Page.captureScreenshot", params)) as { data?: string } | undefined;
    if (!r?.data) throw new Error("截图失败：未返回图像数据");
    return `data:image/${format};base64,${r.data}`;
  });
}

export async function evaluateOnTarget(
  wsUrl: string,
  expression: string,
  timeoutMs = 8000,
): Promise<unknown> {
  return withCdp(
    wsUrl,
    timeoutMs,
    async (send) => (await send("Runtime.evaluate", { expression, returnByValue: true }))?.result?.value,
  );
}
