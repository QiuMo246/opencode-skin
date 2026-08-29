import { describe, expect, it } from "vitest";
import { buildSkinEngineJs, normalizeSkinConfig, type SkinApplyParams } from "../server/lib/desktopSkin.js";
import { windowFxMode } from "../server/lib/windowFx.js";

describe("normalizeSkinConfig", () => {
  it("非法 accentHex 回退默认值", () => {
    expect(normalizeSkinConfig({ accentHex: "red" }).accentHex).toBe("#88c0d0");
  });

  it("数值越界被收敛到合法区间", () => {
    const cfg = normalizeSkinConfig({
      imgBrightness: 999,
      imgOpacity: -1,
      windowBlurPx: 999,
    });
    expect(cfg.imgBrightness).toBe(200);
    expect(cfg.imgOpacity).toBe(0);
    expect(cfg.windowBlurPx).toBe(30);
  });

  it("appearance 非 dark 一律视为 light", () => {
    expect(normalizeSkinConfig({ appearance: undefined }).light).toBe(true);
    expect(normalizeSkinConfig({ appearance: "dark" }).light).toBe(false);
  });

  it("动态壁纸：合法 videoUrl/海报保留，非法值丢弃", () => {
    const url = "http://127.0.0.1:5175/api/images/video/abc123.mp4";
    const ok = normalizeSkinConfig({ videoUrl: url, videoPoster: "data:image/jpeg;base64,POST" });
    expect(ok.videoUrl).toBe(url);
    expect(ok.videoPoster).toBe("data:image/jpeg;base64,POST");
    /* 非本机地址 / 非视频路径 / 未知扩展名一律拒绝 */
    expect(normalizeSkinConfig({ videoUrl: "https://evil.example/a.mp4" }).videoUrl).toBe("");
    expect(normalizeSkinConfig({ videoUrl: "http://127.0.0.1:5175/other/x.mp4" }).videoUrl).toBe("");
    expect(normalizeSkinConfig({ videoUrl: "http://127.0.0.1:5175/api/images/video/a.gif" }).videoUrl).toBe(
      "",
    );
    /* 没有视频时海报无意义；视频与图片互斥，视频优先 */
    expect(normalizeSkinConfig({ videoPoster: "data:image/jpeg;base64,POST" }).videoPoster).toBe("");
    expect(
      normalizeSkinConfig({
        videoUrl: url,
        imageDataUrl: "data:image/png;base64,AAAA",
      }).imageDataUrl,
    ).toBe("");
  });
});

describe("buildSkinEngineJs", () => {
  const params: SkinApplyParams = { appearance: "dark", accentHex: "#123456", windowBlurPx: 20 };

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
    expect(js).toMatch(/__ocSkinEngine__=\{v:4/);
  });

  it("壁纸 dataURL 进入 CSS 背景", () => {
    const cfg = normalizeSkinConfig({ ...params, imageDataUrl: "data:image/png;base64,AAAA" });
    const js = buildSkinEngineJs(cfg);
    expect(js).toContain('url(\\"data:image/png;base64,AAAA\\")');
  });

  it("官方不透明背景令牌被覆盖为半透明", () => {
    const js = buildSkinEngineJs(normalizeSkinConfig(params));
    expect(js).toContain("--v2-background-bg-base:rgba(30,30,36,0.06)");
    expect(js).toContain("--v2-background-bg-deep:rgba(28,28,34,0.225)");
  });

  it("窗口透明且模糊为 0 时不渲染壁纸层（纯透明直透桌面）", () => {
    const cfg = normalizeSkinConfig({
      ...params,
      windowAlpha: 0.5,
      windowBlurPx: 0,
      imageDataUrl: "data:image/png;base64,AAAA",
    });
    const js = buildSkinEngineJs(cfg);
    expect(js).toContain("html.oc-studio-skin::before{content:none");
  });

  it("窗口透明且有模糊时保留模拟桌面层承接 CSS blur（壁纸全强度，散景低强度）", () => {
    /* Win11 对 Electron 窗口忽略系统毛玻璃，透明 + blur>0 需靠应用内壁纸/渐变层呈现磨砂；
     * 壁纸是用户明确选择的背景，须按 imgOpacity 全强度渲染，否则会被面板着色盖过 */
    const cfg = normalizeSkinConfig({
      ...params,
      windowAlpha: 0.5,
      imageDataUrl: "data:image/png;base64,AAAA",
    });
    const js = buildSkinEngineJs(cfg);
    const cssSection = js.slice(js.indexOf('"html.oc-studio-skin'));
    const beforeRule = cssSection.slice(
      0,
      cssSection.indexOf("html.oc-studio-skin #root > div:first-child{background-color"),
    );
    expect(beforeRule).toContain("html.oc-studio-skin::before{");
    expect(beforeRule).toContain("opacity:1.00");
    expect(beforeRule).toContain("blur(20px)");
    expect(beforeRule).toContain('url(\\"data:image/png;base64,AAAA\\")');

    /* 无壁纸的散景变体只是装饰，维持低强度让真实桌面主导 */
    const bokeh = buildSkinEngineJs(normalizeSkinConfig({ ...params, windowAlpha: 0.5 }));
    expect(bokeh).toContain("opacity:0.45");
  });

  it("窗口透明激活时面板不透明度按比例降低，且随壁纸不透明度减半面纱", () => {
    const cfg = normalizeSkinConfig({ ...params, windowAlpha: 0.5 });
    const js = buildSkinEngineJs(cfg);
    expect(cfg.panelAlpha).toBe(0.78);
    /* 0.78 × wScale(0.5) × veilK(0.5，imgOpacity 默认 1) = 0.195 */
    expect(js).toContain("rgba(28,28,34,0.195)");

    /* 壁纸不透明度调低 → 面纱回到较重的玻璃：0.78 × veilK(0.9) = 0.702 */
    const dim = buildSkinEngineJs(normalizeSkinConfig({ ...params, imgOpacity: 0.2 }));
    expect(dim).toContain("rgba(28,28,34,0.702)");
  });

  it("windowBlurPx 作用于 body 与 #root 且 saturate 递增", () => {
    const lo = buildSkinEngineJs(normalizeSkinConfig({ ...params, windowAlpha: 0.5, windowBlurPx: 8 }));
    const hi = buildSkinEngineJs(normalizeSkinConfig({ ...params, windowAlpha: 0.5, windowBlurPx: 28 }));
    expect(lo).toContain("blur(8px)");
    expect(hi).toContain("blur(28px)");
    expect(hi).toContain("html.oc-studio-skin body,html.oc-studio-skin #root");
  });

  it("动态壁纸：引擎包含视频元素管理与隐藏暂停，海报进入 CSS 背景", () => {
    const cfg = normalizeSkinConfig({
      ...params,
      videoUrl: "http://127.0.0.1:5175/api/images/video/abc123.mp4",
      videoPoster: "data:image/jpeg;base64,POST",
    });
    const js = buildSkinEngineJs(cfg);
    /* 视频元素：静音循环自动播放 + 页面隐藏暂停（省电）+ 恢复时清理 */
    expect(js).toContain("__oc_studio_video__");
    expect(js).toContain("playsinline");
    expect(js).toContain("visibilitychange");
    expect(js).toContain('"videoUrl":"http://127.0.0.1:5175/api/images/video/abc123.mp4"');
    /* 海报作为加载中/失败时的垫底画面（与图片壁纸同一 CSS 背景路径） */
    expect(js).toContain('url(\\"data:image/jpeg;base64,POST\\")');
  });

  it("动态壁纸在透明+模糊模式下按全强度渲染（不被散景阻尼压制）", () => {
    const cfg = normalizeSkinConfig({
      ...params,
      windowAlpha: 0.5,
      windowBlurPx: 20,
      videoUrl: "http://127.0.0.1:5175/api/images/video/abc123.mp4",
    });
    const js = buildSkinEngineJs(cfg);
    const cssSection = js.slice(js.indexOf('"html.oc-studio-skin'));
    const beforeRule = cssSection.slice(
      0,
      cssSection.indexOf("html.oc-studio-skin #root > div:first-child{background-color"),
    );
    expect(beforeRule).toContain("opacity:1.00");
  });
});

describe("windowFxMode", () => {
  it("不透明（alpha>=1）→ opaque：清除 layered、alpha 复位 255", () => {
    expect(windowFxMode(1)).toBe("opaque");
  });

  it("透明>0 → transparent（layered 整窗 alpha；模糊不改变该决定，桌面必须保持可见）", () => {
    expect(windowFxMode(0.7)).toBe("transparent");
    expect(windowFxMode(0.3)).toBe("transparent");
  });
});
