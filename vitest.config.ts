import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // 单元测试只收 tests/；e2e/ 由 Playwright（npm run test:e2e）负责
    include: ["tests/**/*.test.ts"],
  },
});
