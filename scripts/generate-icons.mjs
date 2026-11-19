// Genera los iconos PNG de la PWA a partir de public/icons/icon.svg usando Chromium.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
// Playwright se resuelve desde la instalación global (NODE_PATH) o local.
const { chromium } = createRequire(import.meta.url)("playwright");

const svg = readFileSync(new URL("../public/icons/icon.svg", import.meta.url), "utf8");
const out = (n) => new URL(`../public/icons/${n}`, import.meta.url).pathname;
const browser = await chromium.launch();
const page = await browser.newPage();
async function render(name, size, { maskable = false } = {}) {
  await page.setViewportSize({ width: size, height: size });
  const inner = maskable ? Math.round(size * 0.72) : size;
  await page.setContent(
    `<html><body style="margin:0;display:grid;place-items:center;width:${size}px;height:${size}px;background:${maskable ? "#121218" : "transparent"}">
     <div style="width:${inner}px;height:${inner}px">${svg.replace("<svg", `<svg width="${inner}" height="${inner}"`)}</div></body></html>`,
  );
  await page.screenshot({ path: out(name), omitBackground: !maskable });
}
await render("icon-192.png", 192);
await render("icon-512.png", 512);
await render("apple-touch-icon.png", 180, { maskable: true });
await render("icon-maskable-512.png", 512, { maskable: true });
await browser.close();
console.log("iconos generados");
