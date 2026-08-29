import express, { Router } from "express";
import fsp from "node:fs/promises";
import path from "node:path";
import { extractPalette, buildTuiTheme, type Swatch } from "../lib/palette.js";
import {
  ensureWallpapers,
  ensureVideoWallpapers,
  presetsDir,
  videosDir,
  VIDEO_NAME_RE,
  pruneVideos,
} from "../lib/wallpapers.js";

const router = Router();

/** 客户端压缩到 ≤200px（src/lib/imageClient.ts），上限留出余量即可；过大值会同步阻塞事件循环。 */
const MAX_PIXELS = 250_000;

/* 动态壁纸视频：100MB 上限，超出在缓冲前拒绝（express.raw 的 413 报错信息对用户不友好） */
const MAX_VIDEO_BYTES = 100 * 1024 * 1024;
const VIDEO_EXT = new Set(["mp4", "webm"]);

router.get("/builtin", (_req, res) => {
  try {
    res.json({ wallpapers: ensureWallpapers(), videos: ensureVideoWallpapers() });
  } catch (e) {
    res.status(500).json({ error: `壁纸生成失败: ${e instanceof Error ? e.message : String(e)}` });
  }
});

router.get("/file/:id", (req, res) => {
  const id = String(req.params.id);
  if (!/^[a-z0-9-]{1,40}$/.test(id)) return res.status(400).json({ error: "invalid id" });
  const file = path.join(presetsDir(), `${id}.png`);
  res.setHeader("Content-Type", "image/png");
  res.setHeader("Cache-Control", "public, max-age=86400");
  res.sendFile(file, (err) => {
    if (err && !res.headersSent) res.status(404).json({ error: "wallpaper not found" });
  });
});

router.post(
  "/video",
  /* 原始二进制上传：type:()=>true 接管该路由所有 Content-Type（全局 express.json 只解析 json，不冲突） */
  express.raw({ type: () => true, limit: MAX_VIDEO_BYTES }),
  /* 异步写盘：最大 100MB，同步 write 会阻塞事件循环 */
  async (req, res) => {
    try {
      const ext = String(req.query.ext ?? "").toLowerCase();
      if (!VIDEO_EXT.has(ext)) return res.status(400).json({ error: "仅支持 mp4 / webm 视频" });
      const buf = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      if (buf.length === 0) return res.status(400).json({ error: "视频内容为空" });
      if (buf.length > MAX_VIDEO_BYTES) {
        return res.status(413).json({ error: "视频超过 100MB 上限" });
      }
      const dir = videosDir();
      await fsp.mkdir(dir, { recursive: true });
      const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      await fsp.writeFile(path.join(dir, `${id}.${ext}`), buf);
      pruneVideos();
      res.json({ ok: true, id, path: `/api/images/video/${id}.${ext}` });
    } catch (e) {
      res.status(500).json({ error: `视频保存失败: ${e instanceof Error ? e.message : String(e)}` });
    }
  },
);

router.get("/video/:name", (req, res) => {
  const name = String(req.params.name);
  if (!VIDEO_NAME_RE.test(name)) return res.status(400).json({ error: "invalid name" });
  /* sendFile 走 send：自动带 Content-Type 与 Range 支持（进度拖动必需） */
  res.setHeader("Cache-Control", "public, max-age=86400");
  res.sendFile(path.join(videosDir(), name), (err) => {
    if (err && !res.headersSent) res.status(404).json({ error: "video not found" });
  });
});

router.post("/palette", (req, res) => {
  const { width, height, pixels, k } = req.body ?? {};
  const w = Number(width);
  const h = Number(height);
  if (!Number.isInteger(w) || !Number.isInteger(h) || w < 1 || h < 1 || w * h > MAX_PIXELS) {
    return res.status(400).json({ error: `width/height 非法（总像素需 ≤ ${MAX_PIXELS}）` });
  }
  let buf: Buffer;
  try {
    buf = Buffer.from(String(pixels ?? ""), "base64");
  } catch {
    return res.status(400).json({ error: "pixels base64 解码失败" });
  }
  if (buf.length !== w * h * 4) {
    return res.status(400).json({ error: `pixels 大小不符：期望 ${w * h * 4} 字节，实际 ${buf.length}` });
  }
  try {
    const kk = Number.isInteger(Number(k)) ? Number(k) : 6;
    const { swatches } = extractPalette(new Uint8Array(buf), w, h, kk);
    const built = buildTuiTheme(swatches as Swatch[]);
    res.json({
      palette: swatches,
      theme: built.theme,
      meta: { pixelsUsed: swatches.length },
    });
  } catch (e) {
    res.status(500).json({ error: `取色失败: ${e instanceof Error ? e.message : String(e)}` });
  }
});

export default router;
