import {
  ensureContrast,
  hexToRgb,
  hueColor,
  mix,
  rgbToHex,
  rgbToHsl,
  saturate,
  withLightness,
} from "./color.js";
import { mulberry32 } from "./prng.js";

export type Swatch = { hex: string; share: number; h: number; s: number; l: number };

export type SlotMap = Record<string, { dark: string; light: string }>;

/** 对 RGBA 像素做 k-means 聚类提取主色，按占比降序返回。 */
export function extractPalette(
  pixels: Uint8Array,
  width: number,
  height: number,
  k = 6,
): { swatches: Swatch[]; pixelsUsed: number } {
  const samples: Array<[number, number, number]> = [];
  for (let i = 0; i < width * height; i++) {
    const o = i * 4;
    if (pixels[o + 3] < 16) continue;
    samples.push([pixels[o], pixels[o + 1], pixels[o + 2]]);
  }
  if (samples.length === 0) throw new Error("image has no opaque pixels");
  const kk = Math.max(2, Math.min(10, Math.min(k, samples.length)));
  const rnd = mulberry32(samples.length);
  const centers: Array<[number, number, number]> = [samples[Math.floor(rnd() * samples.length)]];
  while (centers.length < kk) {
    let best: [number, number, number] = centers[0];
    let bestD = -1;
    for (let n = 0; n < 24; n++) {
      const cand = samples[Math.floor(rnd() * samples.length)];
      let dMin = Infinity;
      for (const c of centers) {
        const d = (cand[0] - c[0]) ** 2 + (cand[1] - c[1]) ** 2 + (cand[2] - c[2]) ** 2;
        if (d < dMin) dMin = d;
      }
      if (dMin > bestD) {
        bestD = dMin;
        best = cand;
      }
    }
    centers.push(best);
  }
  const sums = centers.map(() => [0, 0, 0, 0]);
  for (let iter = 0; iter < 12; iter++) {
    for (const s of sums) s.fill(0);
    for (const p of samples) {
      let bi = 0;
      let bd = Infinity;
      for (let ci = 0; ci < centers.length; ci++) {
        const c = centers[ci];
        const d = (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 + (p[2] - c[2]) ** 2;
        if (d < bd) {
          bd = d;
          bi = ci;
        }
      }
      sums[bi][0] += p[0];
      sums[bi][1] += p[1];
      sums[bi][2] += p[2];
      sums[bi][3]++;
    }
    for (let ci = 0; ci < centers.length; ci++) {
      if (sums[ci][3] > 0) {
        centers[ci] = [
          Math.round(sums[ci][0] / sums[ci][3]),
          Math.round(sums[ci][1] / sums[ci][3]),
          Math.round(sums[ci][2] / sums[ci][3]),
        ];
      }
    }
  }
  const total = samples.length;
  const swatches: Swatch[] = centers
    .map((c, i) => {
      const hex = "#" + c.map((v) => v.toString(16).padStart(2, "0")).join("");
      const hsl = rgbToHsl({ r: c[0], g: c[1], b: c[2] });
      return { hex, share: total ? sums[i][3] / total : 0, ...hsl };
    })
    .filter((s) => s.share > 0)
    .sort((a, b) => b.share - a.share);
  return { swatches, pixelsUsed: total };
}

function hueDistDeg(a: number, b: number): number {
  const d = Math.abs(a - b);
  return Math.min(d, 1 - d) * 360;
}

function pickAccents(swatches: Swatch[]): string[] {
  const cands = swatches
    .filter((s) => s.l > 0.18 && s.l < 0.88 && s.s > 0.08)
    .map((s) => ({ hex: s.hex, score: s.s * Math.sqrt(s.share), h: s.h }))
    .sort((a, b) => b.score - a.score);
  const picked: Array<{ hex: string; h: number }> = [];
  for (const c of cands) {
    if (picked.length >= 3) break;
    if (picked.every((p) => hueDistDeg(p.h, c.h) >= 30)) picked.push(c);
  }
  while (picked.length < 3) {
    const fallback = swatches[picked.length % Math.max(1, swatches.length)];
    picked.push({ hex: fallback?.hex ?? "#888888", h: fallback?.h ?? 0 });
  }
  return picked.map((p) => p.hex);
}

const STATUS_HUES = { success: 145, warning: 38, error: 4, info: 215 };

export function buildSlotMap(swatches: Swatch[]): SlotMap {
  if (swatches.length === 0) throw new Error("empty palette");
  const byL = [...swatches].sort((a, b) => a.l - b.l);
  const darkest = byL[0];
  const brightest = byL[byL.length - 1];
  const [acc1, acc2, acc3] = pickAccents(swatches);

  const slots: SlotMap = {};
  const put = (key: string, dark: string, light: string): void => {
    slots[key] = { dark, light };
  };

  const dBg = withLightness(darkest.hex, Math.max(0.07, Math.min(0.15, darkest.l * 0.55)));
  const dPanel = withLightness(darkest.hex, rgbToHsl(hexToRgb(dBg)).l + 0.045);
  const dElem = withLightness(darkest.hex, rgbToHsl(hexToRgb(dPanel)).l + 0.04);
  const dText = ensureContrast(withLightness(brightest.hex, 0.9), dBg, 4.5);
  const dMutedRaw = mix(dText, dBg, 0.45);
  const dMuted = ensureContrast(dMutedRaw, dBg, 3.2);

  const lBg = withLightness(saturate(darkest.hex, 0.3), 0.965);
  const lPanel = withLightness(saturate(darkest.hex, 0.25), 1);
  const lElem = withLightness(saturate(darkest.hex, 0.35), 0.92);
  const lText = ensureContrast(withLightness(darkest.hex, 0.16), lBg, 4.5);
  const lMuted = ensureContrast(mix(lText, lBg, 0.42), lBg, 3.2);

  const accentPair = (hex: string): [string, string] => {
    const dk = ensureContrast(saturate(withLightness(hex, 0.68), 1.08), dBg, 3.2);
    const lt = ensureContrast(saturate(withLightness(hex, 0.4), 1.05), lBg, 3.2);
    return [dk, lt];
  };
  const [dPri, lPri] = accentPair(acc1);
  const [dSec, lSec] = accentPair(acc2);
  const [dAcc, lAcc] = accentPair(acc3);

  put("primary", dPri, lPri);
  put("secondary", dSec, lSec);
  put("accent", dAcc, lAcc);
  for (const [name, deg] of Object.entries(STATUS_HUES)) {
    const dk = ensureContrast(mix(hueColor(deg, 0.58, 0.64), dPanel, 0.12), dBg, 3.2);
    const lt = ensureContrast(mix(hueColor(deg, 0.6, 0.44), lPanel, 0.1), lBg, 3.2);
    put(name, dk, lt);
  }

  put("background", dBg, lBg);
  put("backgroundPanel", dPanel, lPanel);
  put("backgroundElement", dElem, lElem);
  put("text", dText, lText);
  put("textMuted", dMuted, lMuted);
  put("border", mix(dText, dBg, 0.78), mix(lText, lBg, 0.75));
  put("borderActive", mix(dPri, dBg, 0.3), mix(lPri, lBg, 0.3));
  put("borderSubtle", mix(dText, dBg, 0.88), mix(lText, lBg, 0.86));

  const dAddBg = mix(hueColor(145, 0.45, 0.32), dBg, 0.8);
  const dRemBg = mix(hueColor(4, 0.45, 0.34), dBg, 0.8);
  const lAddBg = mix(hueColor(145, 0.5, 0.82), lBg, 0.55);
  const lRemBg = mix(hueColor(4, 0.5, 0.84), lBg, 0.55);

  put(
    "diffAdded",
    ensureContrast(hueColor(145, 0.55, 0.68), dBg, 4.5),
    ensureContrast(hueColor(145, 0.58, 0.38), lBg, 4.5),
  );
  put(
    "diffRemoved",
    ensureContrast(hueColor(4, 0.55, 0.7), dBg, 4.5),
    ensureContrast(hueColor(4, 0.58, 0.42), lBg, 4.5),
  );
  put("diffContext", dMuted, lMuted);
  put("diffHunkHeader", hueColor(215, 0.5, 0.72), hueColor(215, 0.6, 0.38));
  put(
    "diffHighlightAdded",
    withLightness(slots.diffAdded.dark, 0.78),
    withLightness(slots.diffAdded.light, 0.3),
  );
  put(
    "diffHighlightRemoved",
    withLightness(slots.diffRemoved.dark, 0.78),
    withLightness(slots.diffRemoved.light, 0.32),
  );
  put("diffAddedBg", dAddBg, lAddBg);
  put("diffRemovedBg", dRemBg, lRemBg);
  put("diffContextBg", mix(dPanel, dBg, 0.5), lPanel);
  put("diffLineNumber", mix(dText, dBg, 0.55), mix(lText, lBg, 0.5));
  put("diffAddedLineNumberBg", dAddBg, lAddBg);
  put("diffRemovedLineNumberBg", dRemBg, lRemBg);

  put("markdownText", dText, lText);
  put("markdownHeading", dPri, lPri);
  put("markdownLink", hueColor(210, 0.65, 0.74), hueColor(215, 0.7, 0.36));
  put("markdownLinkText", dSec, lSec);
  put("markdownCode", hueColor(160, 0.45, 0.7), hueColor(160, 0.55, 0.3));
  put("markdownBlockQuote", dMuted, lMuted);
  put("markdownEmph", mix(dText, dMuted, 0.4), mix(lText, lMuted, 0.4));
  put("markdownStrong", dText, lText);
  put("markdownHorizontalRule", slots.borderSubtle.dark, slots.borderSubtle.light);
  put("markdownListItem", dText, lText);
  put("markdownListEnumeration", dAcc, lAcc);
  put("markdownImage", hueColor(210, 0.65, 0.74), hueColor(215, 0.7, 0.36));
  put("markdownImageText", dSec, lSec);
  put("markdownCodeBlock", dText, lText);

  put("syntaxComment", dMuted, lMuted);
  put("syntaxKeyword", dPri, lPri);
  put("syntaxFunction", dAcc, lAcc);
  put("syntaxVariable", dText, lText);
  put("syntaxString", hueColor(120, 0.45, 0.68), hueColor(125, 0.55, 0.3));
  put("syntaxNumber", slots.warning.dark, slots.warning.light);
  put("syntaxType", slots.info.dark, slots.info.light);
  put("syntaxOperator", dMuted, lMuted);
  put("syntaxPunctuation", mix(dText, dBg, 0.3), mix(lText, lBg, 0.25));

  return slots;
}

export type BuiltTheme = {
  $schema: string;
  theme: Record<string, { dark: string; light: string }>;
};

export function buildTuiTheme(swatches: Swatch[]): { theme: BuiltTheme; palette: Swatch[] } {
  const slots = buildSlotMap(swatches);
  return {
    theme: { $schema: "https://opencode.ai/theme.json", theme: slots },
    palette: swatches,
  };
}

export type DesktopSeeds = {
  neutral: string;
  primary: string;
  success: string;
  warning: string;
  error: string;
  info: string;
  interactive: string;
  diffAdd: string;
  diffDelete: string;
};

const FALLBACK = "#888888";

/** 把槽位值解析成 hex：支持 hex/引用名/ANSI/none，无法解析时回退中性灰。 */
export function resolveToHex(
  value: string | number | undefined,
  defs: Record<string, string> = {},
  seen = new Set<string>(),
): string {
  if (value === undefined) return FALLBACK;
  if (typeof value === "number") return ANSI[Math.max(0, Math.min(255, Math.round(value)))];
  const v = String(value).trim();
  if (/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(v)) return v;
  if (v === "none" || v === "") return FALLBACK;
  if (defs[v] && !seen.has(v)) {
    seen.add(v);
    return resolveToHex(defs[v], defs, seen);
  }
  return FALLBACK;
}

export function buildDesktopSeeds(
  slots: Record<string, { dark?: string; light?: string }>,
  defs: Record<string, string> = {},
): { light: DesktopSeeds; dark: DesktopSeeds } {
  const pick = (key: string, side: "dark" | "light"): string => resolveToHex(slots[key]?.[side], defs);
  const mk = (side: "dark" | "light"): DesktopSeeds => ({
    neutral: pick("background", side),
    primary: pick("primary", side),
    success: pick("success", side),
    warning: pick("warning", side),
    error: pick("error", side),
    info: pick("info", side),
    interactive: slots["markdownLink"]?.[side] ? pick("markdownLink", side) : pick("secondary", side),
    diffAdd: pick("diffAdded", side),
    diffDelete: pick("diffRemoved", side),
  });
  return { light: mk("light"), dark: mk("dark") };
}

export const ANSI: string[] = (() => {
  const out = [
    "#000000",
    "#800000",
    "#008000",
    "#808000",
    "#000080",
    "#800080",
    "#008080",
    "#c0c0c0",
    "#808080",
    "#ff0000",
    "#00ff00",
    "#ffff00",
    "#0000ff",
    "#ff00ff",
    "#00ffff",
    "#ffffff",
  ];
  const lv = [0, 95, 135, 175, 215, 255];
  for (let r = 0; r < 6; r++)
    for (let g = 0; g < 6; g++)
      for (let b = 0; b < 6; b++) out.push(rgbToHex({ r: lv[r], g: lv[g], b: lv[b] }));
  for (let i = 0; i < 24; i++) {
    const v = 8 + i * 10;
    out.push(rgbToHex({ r: v, g: v, b: v }));
  }
  return out;
})();
