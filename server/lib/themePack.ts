import fs from "node:fs";
import path from "node:path";
import JSZip from "jszip";
import { themesDir, ensureDirs } from "./paths.js";
import { writeFileAtomic } from "./fsio.js";
import { initSchemas, validateTuiTheme } from "./schema.js";

/* 独立于服务入口也可用（单测/脚本直跑时 Ajv 校验器已就绪） */
initSchemas();

const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

/** 列出可导出的 TUI 主题文件（跳过隐藏文件与桌面端/市场衍生文件）。 */
function exportableThemeFiles(): string[] {
  ensureDirs();
  return fs
    .readdirSync(themesDir())
    .filter(
      (f) =>
        f.toLowerCase().endsWith(".json") &&
        !f.startsWith(".") &&
        !f.endsWith(".desktop-theme.json") &&
        !f.endsWith(".market.json"),
    )
    .sort();
}

export async function exportThemesZip(): Promise<{ buf: Buffer; count: number }> {
  const files = exportableThemeFiles();
  if (files.length === 0) throw new Error("没有可导出的主题");
  const zip = new JSZip();
  for (const f of files) {
    zip.file(f, fs.readFileSync(path.join(themesDir(), f)));
  }
  return { buf: await zip.generateAsync({ type: "nodebuffer" }), count: files.length };
}

export type ImportResult = {
  imported: string[];
  skipped: string[];
  invalid: string[];
};

/** 从 zip 的 base64 内容导入主题：逐个过官方 schema 校验，同名跳过，非法忽略。 */
export async function importThemesZip(contentBase64: string): Promise<ImportResult> {
  const zip = await JSZip.loadAsync(Buffer.from(contentBase64, "base64"));
  ensureDirs();
  const result: ImportResult = { imported: [], skipped: [], invalid: [] };
  for (const entry of Object.values(zip.files)) {
    if (entry.dir || !entry.name.toLowerCase().endsWith(".json")) continue;
    // 只取包内末级文件名，忽略目录结构（macOS 压缩常带 __MACOSX 等）
    const base = entry.name.split(/[/\\]/).pop() as string;
    if (base.startsWith(".")) continue;
    let doc: unknown;
    try {
      doc = JSON.parse(await entry.async("string"));
    } catch {
      result.invalid.push(base);
      continue;
    }
    if (typeof doc !== "object" || doc === null || Array.isArray(doc)) {
      result.invalid.push(base);
      continue;
    }
    const theme = { $schema: "https://opencode.ai/theme.json", ...(doc as object) };
    const check = validateTuiTheme(theme);
    if (!check.ok) {
      result.invalid.push(base);
      continue;
    }
    const name = base.replace(/\.json$/i, "");
    if (!NAME_RE.test(name) || name === "__tui") {
      result.invalid.push(name);
      continue;
    }
    const p = path.join(themesDir(), `${name}.json`);
    if (fs.existsSync(p)) {
      result.skipped.push(name);
      continue;
    }
    writeFileAtomic(p, JSON.stringify(theme, null, 2) + "\n");
    result.imported.push(name);
  }
  return result;
}
