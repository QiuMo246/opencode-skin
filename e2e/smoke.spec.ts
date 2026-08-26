import { expect, test } from "@playwright/test";

/** 1×1 红色像素 PNG —— 足够触发压缩→取色→建主题的完整链路。 */
const RED_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

test.describe("主链路冒烟：上传图片 → 取色 → 保存 TUI 主题", () => {
  const THEME_NAME = `e2e-smoke-${Date.now()}`;

  test("应用可加载且核心页面渲染", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".brand-name")).toHaveText("Skin Studio");
    await expect(page.locator(".nav-item")).toHaveCount(6);
    // 默认页为主题编辑器
    await expect(page.locator("h2", { hasText: "主题编辑器" })).toBeVisible();
  });

  test("图库上传图片后能提取调色板并保存主题", async ({ page, request }) => {
    await page.goto("/");
    // 第一组「终端皮肤」下的「壁纸工作台」
    await page.locator(".nav-group").first().locator("button", { hasText: "壁纸工作台" }).click();
    await expect(page.locator("legend", { hasText: "TUI 主题" })).toBeVisible();

    // 上传图片（走真实 canvas 压缩 + 服务端 k-means 取色）
    await page.locator(".dropzone input[type=file]").setInputFiles({
      name: "red.png",
      mimeType: "image/png",
      buffer: RED_PNG,
    });
    await expect(page.locator(".palette-row .swatch").first()).toBeVisible({ timeout: 15_000 });

    // 填名称并保存
    await page.getByPlaceholder("主题名称").fill(THEME_NAME);
    await page.getByRole("button", { name: "保存", exact: true }).click();
    await expect(page.locator(".alert-ok")).toContainText(`「${THEME_NAME}」已保存`);

    // 服务端确实落盘
    const res = await request.get("/api/themes");
    expect(res.ok()).toBeTruthy();
    const body = (await res.json()) as { themes: Array<{ name: string }> };
    expect(body.themes.map((t) => t.name)).toContain(THEME_NAME);
  });

  test("编辑器载入刚保存的主题", async ({ page }) => {
    await page.goto("/");
    const select = page.locator("select");
    await select.selectOption({ index: 1 }); // 第一个非空 option = 已安装主题
    await expect(page.locator(".alert-ok")).toContainText("已载入");
  });
});
