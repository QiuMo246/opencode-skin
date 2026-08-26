import fs from "node:fs";
import { fileURLToPath } from "node:url";
import Ajv, { type ValidateFunction } from "ajv";

const TUI_SCHEMA_FILE = "theme.schema.json";
const DESKTOP_SCHEMA_FILE = "desktop-theme.schema.json";

export const SCHEMA_SOURCES = {
  tui: "https://opencode.ai/theme.json",
  desktop:
    "https://raw.githubusercontent.com/anomalyco/opencode/dev/packages/ui/src/theme/desktop-theme.schema.json",
} as const;

type Kind = keyof typeof SCHEMA_SOURCES;

const holders: Record<Kind, { validate: ValidateFunction | null; error: string | null }> = {
  tui: { validate: null, error: null },
  desktop: { validate: null, error: null },
};

function schemaPath(kind: Kind): string {
  return fileURLToPath(
    new URL(`../schemas/${kind === "tui" ? TUI_SCHEMA_FILE : DESKTOP_SCHEMA_FILE}`, import.meta.url),
  );
}

function load(kind: Kind): void {
  try {
    const schema = JSON.parse(fs.readFileSync(schemaPath(kind), "utf8"));
    // 独立实例：initSchemas 可被多个模块安全地重复调用（同 $id 二次编译会抛错）
    const instance = new Ajv({ allErrors: true, strict: false });
    holders[kind].validate = instance.compile(schema);
    holders[kind].error = null;
  } catch (e) {
    holders[kind].validate = null;
    holders[kind].error = e instanceof Error ? e.message : String(e);
  }
}

export function initSchemas(): void {
  load("tui");
  load("desktop");
}

export function schemaStatus() {
  return {
    tui: { loaded: !!holders.tui.validate, error: holders.tui.error, source: SCHEMA_SOURCES.tui },
    desktop: {
      loaded: !!holders.desktop.validate,
      error: holders.desktop.error,
      source: SCHEMA_SOURCES.desktop,
    },
  };
}

function run(kind: Kind, data: unknown): { ok: boolean; errors: string[] } {
  const h = holders[kind];
  if (!h.validate) return { ok: false, errors: [`schema not loaded: ${h.error ?? "unknown"}`] };
  if (h.validate(data)) return { ok: true, errors: [] };
  const errors = (h.validate.errors ?? []).map((e) => `${e.instancePath || "/"} ${e.message ?? ""}`.trim());
  return { ok: false, errors: errors.slice(0, 20) };
}

export const validateTuiTheme = (data: unknown) => run("tui", data);
export const validateDesktopTheme = (data: unknown) => run("desktop", data);

export async function refreshSchemas(): Promise<Record<Kind, string>> {
  const result = { tui: "", desktop: "" } as Record<Kind, string>;
  for (const kind of ["tui", "desktop"] as const) {
    try {
      const res = await fetch(SCHEMA_SOURCES[kind]);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      JSON.parse(text);
      fs.writeFileSync(schemaPath(kind), text, "utf8");
      load(kind);
      result[kind] = "refreshed";
    } catch (e) {
      result[kind] = `failed: ${e instanceof Error ? e.message : String(e)}`;
    }
  }
  return result;
}
