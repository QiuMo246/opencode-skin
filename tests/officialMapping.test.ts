import { describe, expect, it } from "vitest";
import { hexToRgb, mapOfficialColors, respectTransparencyOff, rgbToHsl } from "../src/lib/officialMapping";

/* 夹具取自官方主题真实色板（market.ts pickColors 顺序：background, primary, accent, secondary, text） */
const DRACULA = ["#282a36", "#bd93f9", "#8be9fd", "#ff79c6", "#f8f8f2"];
const EVERFOREST = ["#2d353b", "#a7c080", "#d699b6", "#7fbbb3", "#d3c6aa"];
const MATRIX = ["#0a0e0a", "#2eff6a", "#c770ff", "#00efff", "#62ff94"];
const LUCENT = ["#ec5b2b", "#fff7f1", "#ee7948", "#eeeeee"];

describe("hexToRgb / rgbToHsl", () => {
  it("3 位 hex 扩展为 6 位", () => {
    expect(hexToRgb("#abc")).toEqual({ r: 0xaa, g: 0xbb, b: 0xcc });
  });

  it("非法输入返回黑色", () => {
    expect(hexToRgb("red")).toEqual({ r: 0, g: 0, b: 0 });
  });

  it("灰色的 HSL 饱和度为 0", () => {
    expect(rgbToHsl(128, 128, 128).s).toBe(0);
  });
});

describe("mapOfficialColors", () => {
  it("主色作为强调色，深浅模式按背景明度判定", () => {
    const d = mapOfficialColors(DRACULA);
    expect(d.accentHex).toBe("#bd93f9");
    expect(d.appearance).toBe("dark");
    expect(mapOfficialColors(LUCENT).appearance).toBe("light");
  });

  it("着色强度随主题饱和度拉开，不再全部撞到同一上限", () => {
    const matrix = mapOfficialColors(MATRIX).panelTint ?? 0;
    const dracula = mapOfficialColors(DRACULA).panelTint ?? 0;
    const everforest = mapOfficialColors(EVERFOREST).panelTint ?? 0;
    expect(matrix).toBeGreaterThan(dracula);
    expect(dracula).toBeGreaterThan(everforest);
    expect(everforest).toBeGreaterThanOrEqual(0.05);
    expect(matrix).toBeLessThanOrEqual(0.65);
  });

  it("内容区着色跟随面板着色", () => {
    const d = mapOfficialColors(DRACULA);
    expect(d.contentTint).toBeCloseTo((d.panelTint ?? 0) * 0.7, 1);
  });

  it("壁纸呈现参数（模糊/焦点/滤镜/不透明度）不参与映射，避免污染之后应用的壁纸", () => {
    const m = mapOfficialColors(DRACULA);
    expect(m.imgBrightness).toBeUndefined();
    expect(m.imgContrast).toBeUndefined();
    expect(m.imgSaturate).toBeUndefined();
    expect(m.imgOpacity).toBeUndefined();
    expect(m.windowBlurPx).toBeUndefined();
    expect(m.focusX).toBeUndefined();
    expect(m.focusY).toBeUndefined();
  });

  it("色板缺项（不足 5 色）不抛错并回退", () => {
    const m = mapOfficialColors(["#282a36", "#bd93f9"]);
    expect(m.accentHex).toBe("#bd93f9");
    expect(m.appearance).toBe("dark");
  });

  it("参数落在合法区间", () => {
    for (const colors of [DRACULA, EVERFOREST, MATRIX, LUCENT]) {
      const m = mapOfficialColors(colors);
      expect(m.windowAlpha ?? 0).toBeGreaterThanOrEqual(0.25);
      expect(m.windowAlpha ?? 1).toBeLessThanOrEqual(1);
      expect(m.panelTint ?? 0).toBeLessThanOrEqual(0.65);
      expect(m.contentTint ?? 0).toBeLessThanOrEqual(0.46);
    }
  });
});

describe("respectTransparencyOff", () => {
  const mapped = mapOfficialColors(DRACULA);

  it("透明关闭（windowAlpha=1）时映射不得替用户开启透明", () => {
    const eff = respectTransparencyOff(mapped, 1);
    expect(eff.windowAlpha).toBe(1);
    expect(eff.accentHex).toBe(mapped.accentHex);
    expect(eff.panelTint).toBe(mapped.panelTint);
  });

  it("当前值缺失时按关闭处理", () => {
    expect(respectTransparencyOff(mapped).windowAlpha).toBe(1);
  });

  it("透明已开启时保留映射出的强度", () => {
    expect(respectTransparencyOff(mapped, 0.6).windowAlpha).toBe(mapped.windowAlpha);
  });
});
