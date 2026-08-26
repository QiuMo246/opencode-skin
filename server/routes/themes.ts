import { Router } from "express";
import fs from "node:fs";
import path from "node:path";
import { themesDir, tuiJsonPath, ensureDirs } from "../lib/paths.js";
import { writeFileAtomic, readJsonSafe } from "../lib/fsio.js";
import { deepMerge } from "../lib/merge.js";
import { validateTuiTheme, validateDesktopTheme } from "../lib/schema.js";
import { buildDesktopSeeds } from "../lib/palette.js";

const router = Router();
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const SCHEMA_ID = "https://opencode.ai/desktop-theme.json";

function themePath(name: string): string | null {
  if (!NAME_RE.test(name)) return null;
  return path.join(themesDir(), `${name}.json`);
}

function listThemes() {
  ensureDirs();
  const dir = themesDir();
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json") && !f.startsWith("."))
    .map((f) => {
      const full = path.join(dir, f);
      const stat = fs.statSync(full);
      return { name: path.basename(f, ".json"), size: stat.size, mtime: stat.mtimeMs };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

router.get("/", (_req, res) => {
  res.json({ themes: listThemes() });
});

router.get("/__tui/config", (_req, res) => {
  res.json(readJsonSafe(tuiJsonPath()) ?? {});
});

router.get("/:name", (req, res) => {
  const p = themePath(req.params.name);
  if (!p) return res.status(400).json({ error: "invalid theme name" });
  const data = readJsonSafe(p);
  if (!data) return res.status(404).json({ error: "theme not found or unreadable" });
  res.json(data);
});

router.put("/:name", (req, res) => {
  const p = themePath(req.params.name);
  if (!p) return res.status(400).json({ error: "invalid theme name" });
  const body = req.body;
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return res.status(400).json({ error: "body must be a JSON object" });
  }
  const theme = { $schema: "https://opencode.ai/theme.json", ...body };
  const check = validateTuiTheme(theme);
  if (!check.ok) return res.status(400).json({ error: "schema validation failed", details: check.errors });
  try {
    writeFileAtomic(p, JSON.stringify(theme, null, 2) + "\n");
  } catch (e) {
    return res.status(500).json({ error: `write failed: ${String(e)}` });
  }
  res.json({ ok: true, name: req.params.name });
});

router.delete("/:name", (req, res) => {
  const p = themePath(req.params.name);
  if (!p) return res.status(400).json({ error: "invalid theme name" });
  if (!fs.existsSync(p)) return res.status(404).json({ error: "theme not found" });
  fs.rmSync(p);
  res.json({ ok: true });
});

router.post("/:name/apply", (req, res) => {
  const p = themePath(req.params.name);
  if (!p) return res.status(400).json({ error: "invalid theme name" });
  if (!fs.existsSync(p)) return res.status(404).json({ error: "theme not found" });
  const tui = readJsonSafe<Record<string, unknown>>(tuiJsonPath()) ?? {};
  const next = deepMerge(tui, { $schema: "https://opencode.ai/tui.json", theme: req.params.name });
  try {
    writeFileAtomic(tuiJsonPath(), JSON.stringify(next, null, 2) + "\n");
  } catch (e) {
    return res.status(500).json({ error: `write failed: ${String(e)}` });
  }
  res.json({ ok: true, applied: req.params.name, restartRequired: true, tuiPath: tuiJsonPath() });
});

router.post("/:name/export/desktop", (req, res) => {
  const p = themePath(req.params.name);
  if (!p) return res.status(400).json({ error: "invalid theme name" });
  const tui = readJsonSafe<{ defs?: Record<string, string>; theme?: Record<string, Record<string, string>> }>(p);
  if (!tui?.theme) return res.status(404).json({ error: "theme not found or unreadable" });

  const rawName = typeof req.body?.name === "string" && req.body.name.trim() ? String(req.body.name).trim() : req.params.name;
  const id = rawName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "imported-theme";
  const seeds = buildDesktopSeeds(tui.theme, tui.defs ?? {});
  const desktop = { $schema: SCHEMA_ID, name: rawName, id, light: { seeds: seeds.light }, dark: { seeds: seeds.dark } };

  const check = validateDesktopTheme(desktop);
  if (!check.ok) return res.status(500).json({ error: "生成的 DesktopTheme 未通过官方 schema 校验", details: check.errors });

  const outPath = path.join(themesDir(), `${id}.desktop-theme.json`);
  try {
    writeFileAtomic(outPath, JSON.stringify(desktop, null, 2) + "\n");
  } catch (e) {
    return res.status(500).json({ error: `write failed: ${String(e)}` });
  }
  res.json({ ok: true, path: outPath, theme: desktop });
});


export default router;
