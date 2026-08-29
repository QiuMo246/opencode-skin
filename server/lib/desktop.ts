import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { writeFileAtomic } from "./fsio.js";
import { decodeDataUrl } from "./dataurl.js";
import { clamp01 } from "./color.js";

export type InjectorInfo = {
  found: boolean;
  repoPath: string | null;
  presetsDir: string | null;
  launcher: string | null;
};

export type SkinPackParams = {
  id: string;
  name: string;
  imageDataUrl: string;
  accentHex?: string;
  focusX?: number;
  focusY?: number;
  appearance?: string;
};

const ID_RE = /^[a-z0-9][a-z0-9-]{0,47}$/;

/** sRGB hex → OKLCH 字符串（opencodedev-skin 的 accent 用 oklch() 格式）。 */
export function hexToOklch(hex: string): string {
  let h = hex.replace("#", "");
  if (h.length === 3)
    h = h
      .split("")
      .map((c) => c + c)
      .join("");
  const n = parseInt(h, 16);
  let r = ((n >> 16) & 255) / 255;
  let g = ((n >> 8) & 255) / 255;
  let b = (n & 255) / 255;
  const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  r = lin(r);
  g = lin(g);
  b = lin(b);
  const l0 = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
  const m0 = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
  const s0 = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;
  const l_ = Math.cbrt(l0),
    m_ = Math.cbrt(m0),
    s_ = Math.cbrt(s0);
  const L = 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_;
  const A = 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_;
  const B = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_;
  const C = Math.sqrt(A * A + B * B);
  let Hdeg = (Math.atan2(B, A) * 180) / Math.PI;
  if (Hdeg < 0) Hdeg += 360;
  return `oklch(${L.toFixed(3)} ${C.toFixed(3)} ${Hdeg.toFixed(1)})`;
}

const REPO_CANDIDATES = (): string[] => {
  const home = os.homedir();
  const la = process.env.LOCALAPPDATA ?? path.join(home, "AppData", "Local");
  const base = [
    process.env.OC_SKIN_INJECTOR_DIR,
    path.join(home, "opencodedev-skin"),
    path.join(home, "Documents", "opencodedev-skin"),
    path.join(la, "opencodedev-skin"),
    path.join("D:", "opencode", "opencodedev-skin"),
  ].filter((p): p is string => typeof p === "string" && p.length > 0);
  return base;
};

function findLauncher(repo: string): string | null {
  for (const f of ["injector.mjs", "start.ps1", "start.command"]) {
    const p = path.join(repo, f);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

export function detectInjector(): InjectorInfo {
  for (const repo of REPO_CANDIDATES()) {
    if (fs.existsSync(path.join(repo, ".git")) || fs.existsSync(path.join(repo, "injector.mjs"))) {
      const presets = process.env.OC_SKIN_PRESETS_DIR ?? path.join(repo, "presets");
      return { found: true, repoPath: repo, presetsDir: presets, launcher: findLauncher(repo) };
    }
  }
  const fallbackPresets = process.env.OC_SKIN_PRESETS_DIR ?? null;
  return { found: false, repoPath: null, presetsDir: fallbackPresets, launcher: null };
}

/** 生成 opencodedev-skin 兼容皮肤包（theme.json + 壁纸）。 */
export function buildSkinPack(params: SkinPackParams): Record<string, unknown> {
  if (!ID_RE.test(params.id)) throw new Error("皮肤 id 仅允许小写字母/数字/连字符");
  const injector = detectInjector();
  const presets = injector.presetsDir;
  if (!presets) throw new Error("未找到注入器 presets 目录（可用 OC_SKIN_PRESETS_DIR 指定）");

  const dir = path.join(presets, params.id);
  fs.mkdirSync(dir, { recursive: true });

  const { buf, ext } = decodeDataUrl(params.imageDataUrl);
  const imgName = `background.${ext}`;
  fs.writeFileSync(path.join(dir, imgName), buf);

  const theme = {
    schemaVersion: 1,
    id: params.id,
    name: params.name || params.id,
    image: imgName,
    appearance: ["auto", "light", "dark"].includes(params.appearance ?? "") ? params.appearance : "auto",
    art: {
      focusX: clamp01(params.focusX ?? 0.5),
      focusY: clamp01(params.focusY ?? 0.5),
      safeArea: "auto",
      taskMode: "ambient",
    },
    palette: {
      accent: hexToOklch(params.accentHex ?? "#88c0d0"),
    },
  };
  writeFileAtomic(path.join(dir, "theme.json"), JSON.stringify(theme, null, 2) + "\n");
  return {
    ok: true,
    skinDir: dir,
    themePath: path.join(dir, "theme.json"),
    imagePath: path.join(dir, imgName),
  };
}

/** 调用上游注入管线（injector.mjs / start.ps1）。异步执行，不阻塞事件循环。 */
export async function runInjector(): Promise<Record<string, unknown>> {
  const injector = detectInjector();
  if (!injector.found || !injector.repoPath || !injector.launcher) {
    throw new Error(
      "未找到 opencodedev-skin 注入器，请先克隆仓库到 ~/opencodedev-skin 或设置 OC_SKIN_INJECTOR_DIR",
    );
  }
  const { repoPath, launcher } = injector;
  const cmd = launcher.endsWith(".ps1")
    ? ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", launcher]
    : ["node", launcher];
  const r = await new Promise<{ stdout: string; stderr: string; code: number | null }>(
    (resolve, reject) => {
      const child = spawn(cmd[0], cmd.slice(1), { cwd: repoPath, windowsHide: true });
      let stdout = "";
      let stderr = "";
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        child.kill();
        reject(new Error("注入器执行超时（60s）"));
      }, 60_000);
      child.stdout.on("data", (d) => (stdout += String(d)));
      child.stderr.on("data", (d) => (stderr += String(d)));
      child.on("error", (e) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(e instanceof Error ? e : new Error(String(e)));
      });
      child.on("close", (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ stdout, stderr, code });
      });
    },
  );
  const tail = (r.stdout + "\n" + r.stderr).trim().split(/\r?\n/).slice(-12).join("\n");
  if (r.code !== 0) {
    throw new Error(`注入器执行失败（exit=${r.code ?? "?"}）：\n${tail}`);
  }
  return { ok: true, launcher, outputTail: tail };
}
