export type RGB = { r: number; g: number; b: number };
export type HSL = { h: number; s: number; l: number };

export const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

export function hexToRgb(hex: string): RGB {
  let h = hex.trim().replace(/^#/, "");
  if (h.length === 3)
    h = h
      .split("")
      .map((c) => c + c)
      .join("");
  if (h.length !== 6 || /[^0-9a-fA-F]/.test(h)) return { r: 0, g: 0, b: 0 };
  const n = parseInt(h, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export function rgbToHex({ r, g, b }: RGB): string {
  const to = (v: number) =>
    Math.round(Math.min(255, Math.max(0, v)))
      .toString(16)
      .padStart(2, "0");
  return "#" + to(r) + to(g) + to(b);
}

export function rgbToHsl(rgb: RGB): HSL {
  const rn = rgb.r / 255;
  const gn = rgb.g / 255;
  const bn = rgb.b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6;
  else if (max === gn) h = ((bn - rn) / d + 2) / 6;
  else h = ((rn - gn) / d + 4) / 6;
  return { h, s, l };
}

export function hslToRgb(hsl: HSL): RGB {
  const hh = ((hsl.h % 1) + 1) % 1;
  if (hsl.s === 0) {
    const v = Math.round(hsl.l * 255);
    return { r: v, g: v, b: v };
  }
  const q = hsl.l < 0.5 ? hsl.l * (1 + hsl.s) : hsl.l + hsl.s - hsl.l * hsl.s;
  const p = 2 * hsl.l - q;
  const hue = (t: number): number => {
    const tt = ((t % 1) + 1) % 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };
  return {
    r: Math.round(hue(hh + 1 / 3) * 255),
    g: Math.round(hue(hh) * 255),
    b: Math.round(hue(hh - 1 / 3) * 255),
  };
}

export function relLuminance(rgb: RGB): number {
  const f = (c: number): number => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(rgb.r) + 0.7152 * f(rgb.g) + 0.0722 * f(rgb.b);
}

function lumOf(c: string | RGB): number {
  return relLuminance(typeof c === "string" ? hexToRgb(c) : c);
}

export function contrastRatio(a: string | RGB, b: string | RGB): number {
  const la = lumOf(a);
  const lb = lumOf(b);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

export function mix(a: string, b: string, t: number): string {
  const ca = hexToRgb(a);
  const cb = hexToRgb(b);
  const k = clamp01(t);
  return rgbToHex({
    r: ca.r + (cb.r - ca.r) * k,
    g: ca.g + (cb.g - ca.g) * k,
    b: ca.b + (cb.b - ca.b) * k,
  });
}

export function setHsl(hex: string, over: Partial<HSL>): string {
  const hsl = rgbToHsl(hexToRgb(hex));
  return rgbToHex(hslToRgb({ ...hsl, ...over }));
}

export function withLightness(hex: string, l: number): string {
  return setHsl(hex, { l: clamp01(l) });
}

export function saturate(hex: string, factor: number): string {
  const hsl = rgbToHsl(hexToRgb(hex));
  return rgbToHex(hslToRgb({ h: hsl.h, s: Math.min(1, hsl.s * factor), l: hsl.l }));
}

export function hueColor(deg: number, s: number, l: number): string {
  return rgbToHex(hslToRgb({ h: (deg % 360) / 360, s, l }));
}

/** 迭代调整前景色明度直到与背景达到目标对比度（尽量少改动色相/饱和度）。 */
export function ensureContrast(fg: string, bg: string, target = 4.5): string {
  let out = fg;
  const bgL = rgbToHsl(hexToRgb(bg)).l;
  for (let i = 0; i < 40; i++) {
    if (contrastRatio(out, bg) >= target) return out;
    const cur = rgbToHsl(hexToRgb(out)).l;
    const step = 0.02 * (i < 20 ? 1 : 2);
    const next = bgL > 0.5 ? cur - step : cur + step;
    const moved = withLightness(out, next);
    if (moved === out) break;
    out = moved;
  }
  return out;
}
