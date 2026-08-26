import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import JSZip from "jszip";
import { exportThemesZip, importThemesZip } from "../server/lib/themePack.js";

const TEST_DIR = path.join(os.tmpdir(), `oc-skin-themepack-${Date.now()}`);

const VALID_THEME = {
  $schema: "https://opencode.ai/theme.json",
  theme: {
    primary: { dark: "#111111", light: "#222222" },
    background: { dark: "#000000", light: "#ffffff" },
  },
};

beforeAll(() => {
  process.env.OC_SKIN_THEMES_DIR = TEST_DIR;
  fs.mkdirSync(TEST_DIR, { recursive: true });
});

afterAll(() => {
  fs.rmSync(TEST_DIR, { recursive: true, force: true });
  delete process.env.OC_SKIN_THEMES_DIR;
});

async function makeZip(entries: Record<string, unknown | string>): Promise<string> {
  const zip = new JSZip();
  for (const [name, content] of Object.entries(entries)) {
    if (typeof content === "string") zip.file(name, content);
    else zip.file(name, JSON.stringify(content));
  }
  const buf = await zip.generateAsync({ type: "base64" });
  return buf;
}

describe("themePack", () => {
  it("导出包含主题目录中的全部 json（跳过隐藏与衍生文件）", async () => {
    fs.writeFileSync(path.join(TEST_DIR, "alpha.json"), JSON.stringify(VALID_THEME));
    fs.writeFileSync(
      path.join(TEST_DIR, "beta.json"),
      JSON.stringify({ ...VALID_THEME, theme: { primary: { dark: "#123456" } } }),
    );
    fs.writeFileSync(path.join(TEST_DIR, ".hidden.json"), "{}");
    fs.writeFileSync(path.join(TEST_DIR, "beta.desktop-theme.json"), "{}");
    const { count } = await exportThemesZip();
    expect(count).toBe(2);
  });

  it("空目录导出报错", async () => {
    const emptyDir = path.join(os.tmpdir(), `oc-skin-empty-${Date.now()}`);
    process.env.OC_SKIN_THEMES_DIR = emptyDir;
    try {
      await expect(exportThemesZip()).rejects.toThrow("没有可导出的主题");
    } finally {
      fs.rmSync(emptyDir, { recursive: true, force: true });
      process.env.OC_SKIN_THEMES_DIR = TEST_DIR;
    }
  });

  it("导入：合法收下、同名跳过、非法忽略、嵌套目录按末级名处理", async () => {
    // 预置一个同名主题以触发 skipped
    fs.writeFileSync(path.join(TEST_DIR, "dup.json"), JSON.stringify(VALID_THEME));

    const b64 = await makeZip({
      "good.json": VALID_THEME,
      "dup.json": VALID_THEME,
      "bad-schema.json": { hello: "world" },
      "broken.json": "{not json",
      "nested/inner-good.json": {
        $schema: "https://opencode.ai/theme.json",
        theme: { primary: { dark: "#abcdef" } },
      },
      "not-a-theme.txt": "ignore me",
    });

    const r = await importThemesZip(b64);
    expect(r.imported.sort()).toEqual(["good", "inner-good"]);
    expect(fs.existsSync(path.join(TEST_DIR, "good.json"))).toBe(true);
    expect(fs.existsSync(path.join(TEST_DIR, "inner-good.json"))).toBe(true);
    expect(r.skipped).toEqual(["dup"]);
    expect(r.invalid.sort()).toEqual(["bad-schema.json", "broken.json"]);
  });
});
