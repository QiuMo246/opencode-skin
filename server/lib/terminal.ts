import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { opencodeConfigDir } from "./paths.js";
import { writeFileAtomic } from "./fsio.js";
import { decodeDataUrl } from "./dataurl.js";

export type WtProfile = { id: string; name: string };
export type WtDetect = {
  found: boolean;
  settingsPath: string | null;
  profiles: WtProfile[];
  defaultProfileId: string | null;
  backupExists: boolean;
};

const CANDIDATES = (): string[] => {
  const la = process.env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData", "Local");
  return [
    path.join(la, "Packages", "Microsoft.WindowsTerminal_8wekyb3d8bbwe", "LocalState", "settings.json"),
    path.join(la, "Packages", "Microsoft.WindowsTerminalPreview_8wekyb3d8bbwe", "LocalState", "settings.json"),
    path.join(la, "Microsoft", "Windows Terminal", "settings.json"),
  ];
};

export function wtSettingsPath(): string | null {
  const override = process.env.OC_SKIN_WT_SETTINGS;
  if (override) return override;
  return CANDIDATES().find((p) => fs.existsSync(p)) ?? null;
}

/** 宽容解析 WT settings.json（容忍行注释、块注释与尾逗号；字符串内的 /* 不当作注释）。 */
export function parseJsonc(text: string): unknown {
  const src = text.replace(/^\uFEFF/, "");
  const noComments = [];
  let inStr = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inStr) {
      noComments.push(ch);
      if (ch === "\\") {
        noComments.push(src[i + 1] ?? "");
        i++;
      } else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') {
      inStr = true;
      noComments.push(ch);
    } else if (ch === "/" && src[i + 1] === "/") {
      while (i < src.length && src[i] !== "\n") i++;
      noComments.push("\n");
    } else if (ch === "/" && src[i + 1] === "*") {
      // 块注释：保留换行以维持行号，其余替换为空格；未闭合则吞到结尾
      const end = src.indexOf("*/", i + 2);
      const stop = end === -1 ? src.length : end + 2;
      for (let k = i; k < stop; k++) noComments.push(src[k] === "\n" ? "\n" : " ");
      i = stop - 1;
    } else noComments.push(ch);
  }
  let body = noComments.join("");
  for (let pass = 0; pass < 3; pass++) {
    body = body.replace(/,(\s*[}\]])/g, "$1");
  }
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

export function backupPath(settingsPath: string): string {
  return settingsPath + ".ocskin-backup";
}

type WtSettings = Record<string, unknown> & {
  profiles?: { list?: Array<Record<string, unknown>>; defaults?: Record<string, unknown> };
  defaultProfile?: string;
};

function profileIdOf(p: Record<string, unknown>): string | null {
  if (typeof p.guid === "string" && p.guid) return p.guid;
  if (typeof p.name === "string" && p.name) return "name:" + p.name;
  return null;
}

export function detectWt(): WtDetect {
  const settingsPath = wtSettingsPath();
  if (!settingsPath) {
    return { found: false, settingsPath: null, profiles: [], defaultProfileId: null, backupExists: false };
  }
  const raw = fs.readFileSync(settingsPath, "utf8");
  const data = (parseJsonc(raw) ?? {}) as WtSettings;
  const profiles: WtProfile[] = (data.profiles?.list ?? [])
    .map((p) => ({ id: profileIdOf(p) ?? "", name: String(p.name ?? "未命名 Profile") }))
    .filter((p) => p.id);
  return {
    found: true,
    settingsPath,
    profiles,
    defaultProfileId: typeof data.defaultProfile === "string" ? data.defaultProfile : null,
    backupExists: fs.existsSync(backupPath(settingsPath)),
  };
}

export type BackgroundParams = {
  profileId?: string;
  imageDataUrl: string;
  acrylic?: boolean;
  opacity?: number;
  imageOpacity?: number;
  stretchMode?: string;
};

export function setWtBackground(params: BackgroundParams): Record<string, unknown> {
  const settingsPath = wtSettingsPath();
  if (!settingsPath) throw new Error("未找到 Windows Terminal settings.json");
  const raw = fs.readFileSync(settingsPath, "utf8");
  const bp = backupPath(settingsPath);
  if (!fs.existsSync(bp)) fs.copyFileSync(settingsPath, bp);

  const data = parseJsonc(raw) as WtSettings | null;
  if (!data || typeof data !== "object") throw new Error("settings.json 解析失败，已保留备份");

  const list = data.profiles?.list ?? [];
  let target: Record<string, unknown> | undefined;
  if (params.profileId) {
    target = list.find((p) => profileIdOf(p) === params.profileId);
    if (!target) throw new Error(`未找到指定 Profile：${params.profileId}`);
  } else {
    target = list.find((p) => profileIdOf(p) && profileIdOf(p) === data.defaultProfile);
    target ??= list[0];
    target ??= data.profiles?.defaults;
  }
  if (!target) {
    data.profiles ??= {};
    data.profiles.defaults ??= {};
    target = data.profiles.defaults;
  }

  const { buf, ext } = decodeDataUrl(params.imageDataUrl);
  const bgDir = path.join(opencodeConfigDir(), "backgrounds");
  fs.mkdirSync(bgDir, { recursive: true });
  const bgFile = path.join(bgDir, `bg-${Date.now()}.${ext}`);
  fs.writeFileSync(bgFile, buf);

  target.backgroundImage = bgFile;
  target.backgroundImageOpacity = Math.max(0.05, Math.min(1, params.imageOpacity ?? 0.3));
  target.backgroundImageStretchMode = params.stretchMode ?? "uniformToFill";
  target.useAcrylic = params.acrylic ?? true;
  if (params.opacity !== undefined) {
    target.opacity = Math.max(5, Math.min(100, Math.round(params.opacity)));
  }

  writeFileAtomic(settingsPath, JSON.stringify(data, null, 4) + "\n");
  return {
    ok: true,
    settingsPath,
    backgroundImage: bgFile,
    backup: bp,
    note: "注释已被规范化移除（原文件保留在备份中）；重开 WT 窗口生效",
  };
}

export function restoreWt(): Record<string, unknown> {
  const settingsPath = wtSettingsPath();
  if (!settingsPath) throw new Error("未找到 Windows Terminal settings.json");
  const bp = backupPath(settingsPath);
  if (!fs.existsSync(bp)) throw new Error("不存在备份文件，无法还原");
  fs.copyFileSync(bp, settingsPath);
  return { ok: true, restored: settingsPath, backupKept: bp };
}





