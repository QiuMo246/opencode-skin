import type { SkinApplyParams } from "../api";

export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  let h = hex.trim().replace(/^#/, "");
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  if (h.length !== 6 || /[^0-9a-fA-F]/.test(h)) return { r: 0, g: 0, b: 0 };
  const n = parseInt(h, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  const rn = r / 255,
    gn = g / 255,
    bn = b / 255;
  const max = Math.max(rn, gn, bn),
    min = Math.min(rn, gn, bn);
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

export function hexHsl(hex: string): { h: number; s: number; l: number } {
  const { r, g, b } = hexToRgb(hex);
  return rgbToHsl(r, g, b);
}

export function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

/**
 * 官方主题配色 → 桌面端玻璃参数。
 * 色板顺序与 market.ts pickColors 一致：[background, primary, accent, secondary, text]。
 *
 * 只映射「颜色与窗口合成」参数（强调色/深浅/透明度/面板着色）。
 * 一切「画面呈现」参数刻意不映射——壁纸模糊、渐变焦点、亮度/对比度/饱和度/不透明度
 * 描述的是壁纸长什么样，与主题颜色无关；应用配色时可能还没有壁纸，预先写入会在此后
 * 应用壁纸时静默生效（如 27px 磨砂 + 70% 对比度把壁纸洗成一片色雾）。配色与壁纸
 * 互不越界——壁纸的观感由壁纸工作台的滑杆负责。
 */
export function mapOfficialColors(colors: string[]): Partial<SkinApplyParams> {
  const bg = hexHsl(colors[0] ?? "");
  const accent = hexHsl(colors[1] ?? "");

  const appearance = bg.l > 0.42 ? "light" : "dark";

  // 强调色：取第二个提取色（主色），fallback 到第三、第一
  const accentHex = colors[1] || colors[2] || colors[0] || "#88c0d0";

  // 窗口透明度：背景越深越透明（让壁纸透出），浅色背景则偏不透明
  const windowAlpha =
    appearance === "dark" ? clamp(0.5 + bg.l * 0.9, 0.25, 0.85) : clamp(0.85 + bg.l * 0.15, 0.8, 1);

  // 面板着色：随强调色饱和度线性拉开（0.05–0.65），亮强调色降系数防面板过亮
  const tintFactor = accent.l > 0.7 ? 0.5 : 0.65;
  const panelTint = clamp(accent.s * tintFactor, 0.05, 0.65);
  // 内容区着色：面板的 7 折
  const contentTint = clamp(panelTint * 0.7, 0.04, 0.46);

  return {
    appearance,
    accentHex,
    windowAlpha: Math.round(windowAlpha * 100) / 100,
    panelTint: Math.round(panelTint * 100) / 100,
    contentTint: Math.round(contentTint * 100) / 100,
  };
}

/**
 * 透明"关闭"（windowAlpha ≥ 1）是用户的明确选择：官方配色映射只重调已开启透明的强度，
 * 不得替用户把透明打开（否则应用任意主题都会把窗口透明从 0% 强推到 ~30%）。
 */
export function respectTransparencyOff(
  mapped: Partial<SkinApplyParams>,
  currentWindowAlpha?: number,
): Partial<SkinApplyParams> {
  return (currentWindowAlpha ?? 1) >= 1 ? { ...mapped, windowAlpha: 1 } : mapped;
}
