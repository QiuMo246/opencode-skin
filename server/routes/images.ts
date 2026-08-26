import { Router } from "express";
import path from "node:path";
import { extractPalette, buildTuiTheme, type Swatch } from "../lib/palette.js";
import { ensureWallpapers, presetsDir } from "../lib/wallpapers.js";

const router = Router();

/** 客户端压缩到 ≤200px（src/lib/imageClient.ts），上限留出余量即可；过大值会同步阻塞事件循环。 */
const MAX_PIXELS = 250_000;

router.get("/builtin", (_req, res) => {
  try {
    res.json({ wallpapers: ensureWallpapers() });
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
