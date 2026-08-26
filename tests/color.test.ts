import { describe, expect, it } from "vitest";
import {
  contrastRatio,
  ensureContrast,
  hexToRgb,
  hslToRgb,
  mix,
  rgbToHex,
  rgbToHsl,
} from "../server/lib/color.js";

describe("color", () => {
  it("hexToRgb 支持缩写与完整格式", () => {
    expect(hexToRgb("#fff")).toEqual({ r: 255, g: 255, b: 255 });
    expect(hexToRgb("#ff8800")).toEqual({ r: 255, g: 136, b: 0 });
  });

  it("hexToRgb 对非法输入返回黑色", () => {
    expect(hexToRgb("#zzzzzz")).toEqual({ r: 0, g: 0, b: 0 });
  });

  it("rgb↔hex 往返一致", () => {
    expect(rgbToHex({ r: 255, g: 136, b: 0 })).toBe("#ff8800");
    expect(rgbToHex({ r: 300, g: -5, b: 12 })).toBe("#ff000c");
  });

  it("hsl 往返保持色相", () => {
    const rgb = { r: 30, g: 144, b: 255 };
    const back = hslToRgb(rgbToHsl(rgb));
    expect(Math.abs(back.r - rgb.r)).toBeLessThanOrEqual(1);
    expect(Math.abs(back.g - rgb.g)).toBeLessThanOrEqual(1);
    expect(Math.abs(back.b - rgb.b)).toBeLessThanOrEqual(1);
  });

  it("黑白对比度为 21", () => {
    expect(contrastRatio("#ffffff", "#000000")).toBeCloseTo(21, 1);
  });

  it("mix 在端点间插值", () => {
    expect(mix("#000000", "#ffffff", 0)).toBe("#000000");
    expect(mix("#000000", "#ffffff", 1)).toBe("#ffffff");
    expect(mix("#000000", "#ffffff", 2)).toBe("#ffffff");
  });

  it("ensureContrast 达到目标对比度", () => {
    const out = ensureContrast("#777777", "#888888", 4.5);
    expect(contrastRatio(out, "#888888")).toBeGreaterThanOrEqual(4.5);
  });
});
