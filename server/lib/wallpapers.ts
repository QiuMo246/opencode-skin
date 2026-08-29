import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const presetsDir = (): string => path.join(__dirname, "..", "..", "presets", "wallpapers");

export type WallpaperInfo = { id: string; title: string; file: string };
export type VideoWallpaperInfo = { id: string; title: string; file: string; poster: string };

/** 动态壁纸视频的存储目录（presets/ 整体 git-ignore）。 */
export const videosDir = (): string => path.join(presetsDir(), "videos");

/** 可服务的视频文件名：<id>.<ext>，ext 仅 mp4/webm（Chromium <video> 可靠播放的两种）；jpg 仅限内置海报。 */
export const VIDEO_NAME_RE = /^[a-z0-9-]+\.(mp4|webm|jpg)$/;

/** 最多保留的视频文件数：超出按修改时间淘汰最旧的，防止磁盘被 100MB 级文件悄悄吃满。 */
export const MAX_VIDEO_FILES = 10;

export function pruneVideos(max = MAX_VIDEO_FILES): void {
  const dir = videosDir();
  let files: string[];
  try {
    files = fs.readdirSync(dir).filter((f) => VIDEO_NAME_RE.test(f) && !f.startsWith("builtin-"));
  } catch {
    return;
  }
  if (files.length <= max) return;
  const byAge = files
    .map((f) => ({ f, m: fs.statSync(path.join(dir, f)).mtimeMs }))
    .sort((a, b) => b.m - a.m);
  for (const { f } of byAge.slice(max)) {
    try {
      fs.rmSync(path.join(dir, f), { force: true });
    } catch {
      /* 单个删除失败不影响其余 */
    }
  }
}

const CATALOG: Array<{ id: string; title: string }> = [
  { id: "rose-lotus", title: "出水芙蓉" },
  { id: "anime-cold", title: "冷艳少女" },
  { id: "glance-girl", title: "回眸少女" },
  { id: "cold-gaze", title: "冷峻眼神" },
  { id: "gojo", title: "五条悟" },
  { id: "summer-cartoon", title: "夏日卡通" },
];

/** 内置动态壁纸：1080p30 无音轨压缩版，随 presets 分发；builtin- 前缀文件不参与 pruneVideos 淘汰。 */
const VIDEO_CATALOG: Array<{ id: string; title: string }> = [
  { id: "builtin-kuroha-lineart", title: "动漫线稿 · 动态" },
  { id: "builtin-cold-charm", title: "冷艳少女 · 动态" },
  { id: "builtin-water-healing", title: "卡通水面 · 动态" },
];

/** 返回图库清单（仅列出存在的文件）。 */
export function ensureWallpapers(): WallpaperInfo[] {
  const dir = presetsDir();
  fs.mkdirSync(dir, { recursive: true });
  const out: WallpaperInfo[] = [];
  for (const item of CATALOG) {
    const file = `${item.id}.png`;
    const full = path.join(dir, file);
    if (fs.existsSync(full)) {
      out.push({ id: item.id, title: item.title, file });
    }
  }
  return out;
}

/** 返回内置动态壁纸清单（仅列出存在的视频与海报）。 */
export function ensureVideoWallpapers(): VideoWallpaperInfo[] {
  const dir = videosDir();
  fs.mkdirSync(dir, { recursive: true });
  const out: VideoWallpaperInfo[] = [];
  for (const item of VIDEO_CATALOG) {
    const file = `${item.id}.mp4`;
    if (fs.existsSync(path.join(dir, file))) {
      out.push({ id: item.id, title: item.title, file, poster: `/api/images/video/${item.id}-poster.jpg` });
    }
  }
  return out;
}
