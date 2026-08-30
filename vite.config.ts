import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    proxy: {
      "/api": "http://127.0.0.1:5175",
    },
  },
  test: {
    // 单元测试只收 tests/；e2e/ 由 Playwright（npm run test:e2e）负责
    include: ["tests/**/*.test.ts"],
  },
});
