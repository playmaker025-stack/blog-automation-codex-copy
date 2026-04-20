import { expect, test } from "@playwright/test";

const BASE_URL =
  process.env.PLAYWRIGHT_BASE_URL ??
  "https://blog-automation-codex-copy-production.up.railway.app";

const appPaths = ["/", "/dashboard", "/topics", "/posts", "/pipeline", "/eval"];

test.describe("Railway deployment smoke test", () => {
  for (const path of appPaths) {
    test(`loads ${path}`, async ({ page }) => {
      const consoleErrors: string[] = [];
      page.on("console", (message) => {
        if (message.type() === "error") consoleErrors.push(message.text());
      });

      const response = await page.goto(`${BASE_URL}${path}`, {
        waitUntil: "networkidle",
      });

      expect(response?.status(), `${path} should load`).toBeLessThan(400);
      await expect(page).toHaveTitle(/Blog Automation/);
      await expect(page.locator("body")).toBeVisible();
      expect(consoleErrors, `${path} console errors`).toEqual([]);
    });
  }

  test("GitHub-backed read APIs respond", async ({ request }) => {
    const checks = [
      "/api/github/profile?userId=a",
      "/api/github/topics",
      "/api/github/posts",
    ];

    for (const path of checks) {
      const response = await request.get(`${BASE_URL}${path}`);
      expect(response.status(), `${path} status`).toBeLessThan(400);
      await expect(response).toBeOK();
    }
  });
});
