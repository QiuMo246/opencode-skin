import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { encodePng } from "./png.js";
import { mulberry32 } from "./prng.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const presetsDir = (): string => path.join(__dirname, "..", "..", "presets", "wallpapers");

export type WallpaperInfo = { id: string; title: string; file: string };

type Shader = (x: number, y: number, w: number, h: number) => [number, number, number];

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const mix3 = (
  a: [number, number, number],
  b: [number, number, number],
  t: number,
): [number, number, number] => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

const add = (
  base: [number, number, number],
  c: [number, number, number],
  k: number,
): [number, number, number] => [
  Math.min(255, base[0] + c[0] * k),
  Math.min(255, base[1] + c[1] * k),
  Math.min(255, base[2] + c[2] * k),
];

const SHADERS: Record<string, Shader> = {
  aurora: (x, y) => {
    let c = mix3([11, 16, 38], [18, 58, 74], y);
    const w1 = Math.sin((x * 6.28 + y * 2.4)) * 0.5 + 0.5;
    const w2 = Math.sin((x * 12.56 - y * 4.2) + 1.7) * 0.5 + 0.5;
    c = add(c, [60, 230, 160], 0.22 * w1 * Math.pow(1 - y, 1.6));
    c = add(c, [150, 110, 240], 0.18 * w2 * Math.pow(1 - y, 2.2));
    return c;
  },
  sunset: (x, y) => {
    let c = y < 0.55
      ? mix3([53, 35, 93], [179, 70, 110], y / 0.55)
      : mix3([179, 70, 110], [255, 154, 90], (y - 0.55) / 0.45);
    const d = Math.hypot(x - 0.5, (y - 0.6) * 1.4);
    c = add(c, [255, 220, 160], Math.max(0, 0.9 - d * 2.4));
    return c;
  },
  ocean: (x, y) => {
    let c = mix3([4, 18, 31], [10, 77, 104], (x + y) / 2);
    const ca = Math.sin(x * 22) * Math.sin(y * 14 + x * 6);
    c = add(c, [90, 200, 220], Math.max(0, ca - 0.55) * 0.5);
    return c;
  },
  forest: (x, y) => {
    let c = mix3([12, 31, 20], [39, 69, 48], y);
    const fog = Math.sin(x * 8 + y * 30) * 0.5 + 0.5;
    c = add(c, [140, 180, 150], fog * fog * 0.12 * y);
    return c;
  },
  neon: (x, y) => {
    let c: [number, number, number] = [10, 7, 20];
    const d1 = Math.abs((x * 0.9 - y + 0.15) % 1 - 0.5);
    const d2 = Math.abs((x * 0.7 + y * 0.6 - 0.2) % 1 - 0.5);
    c = add(c, [230, 40, 160], Math.max(0, 0.5 - d1 * 3));
    c = add(c, [40, 200, 240], Math.max(0, 0.5 - d2 * 3));
    return mix3(c, [5, 4, 12], y * 0.35);
  },
  lavender: (x, y) => {
    let c = mix3([142, 197, 252], [224, 195, 252], (x + y) / 2);
    const d = Math.hypot(x - 0.35, y - 0.4);
    c = mix3(c, [255, 250, 255], Math.max(0, 0.55 - d) * 0.7);
    return c;
  },
  ember: (x, y, w, h) => {
    let c = mix3([20, 17, 15], [36, 27, 22], Math.hypot(x - 0.5, y - 0.5));
    const rnd = mulberry32(77);
    for (let i = 0; i < 26; i++) {
      const ex = rnd();
      const ey = rnd();
      const r = 0.05 + rnd() * 0.1;
      const d = Math.hypot(x - ex, (y - ey) * (h / w)) / r;
      if (d < 1) c = add(c, [255, 120 + rnd() * 80, 40], (1 - d) ** 2 * 0.9);
    }
    return c;
  },
  glacier: (x, y) => {
    let c = mix3([234, 247, 253], [143, 195, 221], y);
    const s = Math.sin((x * 1.4 + y * 0.6) * 6.28) * 0.5 + 0.5;
    c = add(c, [255, 255, 255], s * 0.18 * y);
    return c;
  },
};

const CATALOG: Array<{ id: string; title: string }> = [
  { id: "aurora", title: "Aurora 极光" },
  { id: "sunset", title: "Sunset 落日" },
  { id: "ocean", title: "Ocean 深海" },
  { id: "forest", title: "Forest 雾林" },
  { id: "neon", title: "Neon 霓虹" },
  { id: "lavender", title: "Lavender 薰衣草" },
  { id: "ember", title: "Ember 余烬" },
  { id: "glacier", title: "Glacier 冰川" },
];

const W = 800;
const H = 500;

/** 缺失时程序化生成内置壁纸，返回图库清单。 */
export function ensureWallpapers(): WallpaperInfo[] {
  const dir = presetsDir();
  fs.mkdirSync(dir, { recursive: true });
  const out: WallpaperInfo[] = [];
  for (const item of CATALOG) {
    const file = `${item.id}.png`;
    const full = path.join(dir, file);
    if (!fs.existsSync(full)) {
      const rgba = new Uint8Array(W * H * 4);
      const shader = SHADERS[item.id];
      for (let py = 0; py < H; py++) {
        for (let px = 0; px < W; px++) {
          const c = shader(px / (W - 1), py / (H - 1), W, H);
          const o = (py * W + px) * 4;
          rgba[o] = Math.round(c[0]);
          rgba[o + 1] = Math.round(c[1]);
          rgba[o + 2] = Math.round(c[2]);
          rgba[o + 3] = 255;
        }
      }
      fs.writeFileSync(full, encodePng(W, H, rgba));
    }
    out.push({ id: item.id, title: item.title, file });
  }
  return out;
}







