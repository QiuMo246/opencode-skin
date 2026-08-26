import os from "node:os";
import path from "node:path";
import { defineConfig } from "@playwright/test";

const PORT = Number(process.env.PORT ?? 5199);

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npx tsx server/index.ts",
    port: PORT,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
    env: {
      ...process.env,
      PORT: String(PORT),
      // E2E 专用主题目录，避免污染真实 ~/.config/opencode/themes
      OC_SKIN_THEMES_DIR: process.env.OC_SKIN_THEMES_E2E_DIR ?? path.join(os.tmpdir(), "oc-skin-e2e-themes"),
    },
  },
});
