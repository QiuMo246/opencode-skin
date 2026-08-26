import os from "node:os";
import path from "node:path";
import fs from "node:fs";

export function opencodeConfigDir(): string {
  const xdg = process.env.XDG_CONFIG_HOME;
  const base = xdg && path.isAbsolute(xdg) ? xdg : path.join(os.homedir(), ".config");
  return path.join(base, "opencode");
}

export const themesDir = (): string => {
  const override = process.env.OC_SKIN_THEMES_DIR;
  if (override && path.isAbsolute(override)) return override;
  return path.join(opencodeConfigDir(), "themes");
};
export const tuiJsonPath = (): string => path.join(opencodeConfigDir(), "tui.json");

export function ensureDirs(): void {
  fs.mkdirSync(themesDir(), { recursive: true });
}
