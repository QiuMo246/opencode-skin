import { describe, expect, it } from "vitest";
import {
  emptyTheme,
  normalizeLoaded,
  resolveColor,
  toThemeJson,
  type TuiThemeJson,
} from "../src/lib/themeModel";

describe("resolveColor", () => {
  it("直接解析 hex", () => {
    expect(resolveColor("#ff8800", undefined, "#000000")).toBe("#ff8800");
  });

  it("解析 defs 引用", () => {
    expect(resolveColor("brand", { brand: "#00ff00" }, "#000000")).toBe("#00ff00");
  });

  it("循环引用回退到 fallback 而非死循环", () => {
    const defs = { a: "b", b: "a" };
    expect(resolveColor("a", defs, "#123456")).toBe("#123456");
    expect(resolveColor("b", defs, "#123456")).toBe("#123456");
  });

  it("自引用同样安全", () => {
    expect(resolveColor("x", { x: "x" }, "#abcdef")).toBe("#abcdef");
  });
});

const RAW_WITH_UNKNOWN = {
  $schema: "https://opencode.ai/theme.json",
  theme: {
    primary: { dark: "#111111", light: "#222222" },
    futureSlot: { dark: "#333333" },
    legacy: "#444444",
  },
};

describe("normalizeLoaded → toThemeJson round-trip", () => {
  it("未知槽位在载入→保存往返中不丢失", () => {
    const loaded = normalizeLoaded(RAW_WITH_UNKNOWN);
    const out = toThemeJson(loaded) as { theme: Record<string, unknown> };
    expect(out.theme.futureSlot).toEqual({ dark: "#333333" });
    expect(out.theme.primary).toEqual({ dark: "#111111", light: "#222222" });
  });

  it("字符串简写形式往返后保持等价", () => {
    const loaded = normalizeLoaded(RAW_WITH_UNKNOWN);
    const again = normalizeLoaded(toThemeJson(loaded));
    expect(again.theme).toEqual(loaded.theme);
  });

  it("空变体的槽位被剔除", () => {
    const theme: TuiThemeJson = emptyTheme();
    theme.theme.primary = {};
    const out = toThemeJson(theme) as { theme: Record<string, unknown> };
    expect(out.theme).not.toHaveProperty("primary");
  });

  it("空 defs 不输出；非空 defs 原样保留", () => {
    const empty = toThemeJson(emptyTheme()) as Record<string, unknown>;
    expect(empty).not.toHaveProperty("defs");

    const t = emptyTheme();
    t.defs = { nord0: "#2e3440" };
    const withDefs = toThemeJson(t) as { defs?: Record<string, string> };
    expect(withDefs.defs).toEqual({ nord0: "#2e3440" });
  });
});
