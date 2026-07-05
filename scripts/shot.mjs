// 開発用スクリーンショット: node scripts/shot.mjs <path> <out.png> [--dark] [--mobile] [--email=x]
// 保護ページは --email 指定でマジックリンク経由ログインしてから撮る（要 dev サーバ起動）。
import { chromium } from "@playwright/test";
import { existsSync, readFileSync, rmSync } from "node:fs";

const [path = "/", out = "shot.png"] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const flags = process.argv.slice(2).filter((a) => a.startsWith("--"));
const dark = flags.includes("--dark");
const mobile = flags.includes("--mobile");
const email = flags.find((f) => f.startsWith("--email="))?.split("=")[1];
const BASE = "http://localhost:3000";

const browser = await chromium.launch();
const ctx = await browser.newContext({
  colorScheme: dark ? "dark" : "light",
  viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 900 },
  deviceScaleFactor: 2,
});
const page = await ctx.newPage();

if (email) {
  if (existsSync(".magic-link.dev")) rmSync(".magic-link.dev");
  await page.goto(BASE + "/signin");
  await page.getByPlaceholder("you@example.com").fill(email);
  await page.getByRole("button", { name: "ログインリンクを送る" }).click();
  let link = "";
  for (let i = 0; i < 60 && !link; i++) {
    if (existsSync(".magic-link.dev")) link = readFileSync(".magic-link.dev", "utf8").trim();
    if (!link) await new Promise((r) => setTimeout(r, 100));
  }
  await page.goto(link);
  await page.waitForURL((u) => !u.pathname.startsWith("/signin"));
}

await page.goto(BASE + path, { waitUntil: "networkidle" });
await page.screenshot({ path: out, fullPage: true });
console.log("saved", out);
await browser.close();
