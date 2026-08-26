import { describe, expect, it } from "vitest";
import { buildSkinEngineJs, normalizeSkinConfig, type SkinApplyParams } from "../server/lib/desktopSkin.js";

describe("normalizeSkinConfig", () => {
  it("非法 accentHex 回退默认值", () => {
    expect(normalizeSkinConfig({ accentHex: "red" }).accentHex).toBe("#88c0d0");
  });

  it("数值越界被收敛到合法区间", () => {
    const cfg = normalizeSkinConfig({
      panelAlpha: 5,
      blurPx: -3,
      imgBrightness: 999,
      imgOpacity: -1,
    });
    expect(cfg.panelAlpha).toBe(1);
    expect(cfg.blurPx).toBe(0);
    expect(cfg.imgBrightness).toBe(200);
    expect(cfg.imgOpacity).toBe(0);
  });

  it("appearance 非 dark 一律视为 light", () => {
    expect(normalizeSkinConfig({ appearance: undefined }).light).toBe(true);
    expect(normalizeSkinConfig({ appearance: "dark" }).light).toBe(false);
  });
});

describe("buildSkinEngineJs", () => {
  const params: SkinApplyParams = { appearance: "dark", accentHex: "#123456", blurPx: 20 };

  it("内嵌归一化后的配置 JSON", () => {
    const js = buildSkinEngineJs(normalizeSkinConfig(params));
    expect(js).toContain('"accentHex":"#123456"');
  });

  it("内嵌预计算的 CSS 文本（含 @layer 包裹标记）", () => {
    const js = buildSkinEngineJs(normalizeSkinConfig(params));
    expect(js).toContain("--ocs-accent:#123456");
    expect(js).toContain("@layer oc-studio-skin");
  });

  it("不依赖 Function.prototype.toString()", () => {
    const js = buildSkinEngineJs(normalizeSkinConfig(params));
    expect(js).not.toContain(".toString()");
    expect(js).toMatch(/__ocSkinEngine__=\{v:3/);
  });

  it("壁纸 dataURL 进入 CSS 背景", () => {
    const cfg = normalizeSkinConfig({ ...params, imageDataUrl: "data:image/png;base64,AAAA" });
    const js = buildSkinEngineJs(cfg);
    expect(js).toContain('url(\\"data:image/png;base64,AAAA\\")');
  });
});
