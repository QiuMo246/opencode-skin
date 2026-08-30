import os from "node:os";
import path from "node:path";
import { defineConfig } from "@playwright/test";

const PORT = Number(process.env.PORT ?? 5199);

export default defineConfig({
  // 配置文件位于 e2e/ 内，testDir 相对配置文件解析
  testDir: ".",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "retain-on-failure",
  },
  webServer: {
    // webServer 的 cwd 是配置文件所在目录（e2e/），故用 ../ 指向仓库根
    command: "npx tsx ../server/index.ts",
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
