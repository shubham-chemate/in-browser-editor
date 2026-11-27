// Status bar lab (Agent C): zoomed shots of the bar in every state, plus
// layout-shift measurements. Run: ./e2e/lab.sh shoot statusbar
// Saves are intercepted (never reach the lab server) so seeded snippets stay intact.
import { chromium } from "playwright";
import { BASE, SHOTS, openApp, seed, shot, snippetId } from "./helpers.mjs";

await seed();
const ids = {
  py: await snippetId("binary_search.py"),
  go: await snippetId("server.go"),
  notes: await snippetId("notes"),
};

/** A DPR-2 context so bar detail is readable. */
async function openZoomed({ theme = "dark", width = 1280, height = 400, hash, reducedMotion = "no-preference" }) {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width, height }, colorScheme: theme, deviceScaleFactor: 2, reducedMotion });
  await context.addInitScript((t) => { try { localStorage.setItem("snippet-editor:theme", t); } catch {} }, theme);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error") errors.push(`console: ${m.text()}`); });
  await page.goto(`${BASE}#${hash}`);
  await page.locator(".cm-editor").waitFor();
  await page.waitForTimeout(700);
  return { browser, page, errors };
}

/** Make PUTs never hit the server: delay, then echo back (or fail). */
async function fakeSaves(page, { delay = 0, fail = false } = {}) {
  await page.route("**/api/snippets/*", async (route) => {
    const req = route.request();
    if (req.method() !== "PUT") return route.continue();
    if (fail) return route.abort("connectionrefused");
    await new Promise((r) => setTimeout(r, delay));
    const res = await route.fetch({ method: "GET" });
    const orig = await res.json();
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ...orig, ...JSON.parse(req.postData() || "{}"), updatedAt: orig.updatedAt }) });
  });
}

/** Clip the bottom strip: the bar plus a little editor above for context. */
async function barShot(page, name, { left = true, right = true } = {}) {
  const box = await page.locator(".statusbar").boundingBox();
  const vw = page.viewportSize().width;
  const w = Math.min(vw, 560);
  const strip = { y: box.y - 8, height: box.height + 8 };
  if (left && right && vw <= 560) {
    await page.screenshot({ path: `${SHOTS}/${name}.png`, clip: { x: 0, width: vw, ...strip } });
  } else {
    if (left) await page.screenshot({ path: `${SHOTS}/${name}-left.png`, clip: { x: 0, width: w, ...strip } });
    if (right) await page.screenshot({ path: `${SHOTS}/${name}-right.png`, clip: { x: vw - w, width: w, ...strip } });
  }
  console.log(`saved e2e/screenshots/lab/${name}*.png`);
}

const boxes = (page) =>
  page.evaluate(() =>
    Object.fromEntries(
      ["problems", "check-mode", "save-state", "cursor-pos", "indent", "status-language"].map((id) => {
        const r = document.querySelector(`[data-testid="${id}"]`).getBoundingClientRect();
        return [id, `${Math.round(r.x * 10) / 10}+${Math.round(r.width * 10) / 10}`];
      }),
    ),
  );
const report = (label, errors) => errors.length && console.log(`[${label}] errors:\n  ` + errors.join("\n  "));

for (const theme of ["dark", "light"]) {
  // 1 error (Python) and 0 errors (Go), idle.
  {
    const { browser, page, errors } = await openZoomed({ theme, hash: ids.py });
    await barShot(page, `statusbar-${theme}-1error`);
    // hover problems + focus ring on language
    await page.locator('[data-testid="problems"]').hover();
    await page.waitForTimeout(200);
    await barShot(page, `statusbar-${theme}-hover-problems`, { right: false });
    await page.locator('[data-testid="cursor-pos"]').hover();
    await page.waitForTimeout(200);
    await barShot(page, `statusbar-${theme}-hover-cursor`, { left: false });
    await page.mouse.move(600, 100);
    await page.locator('[data-testid="cursor-pos"]').focus();
    await page.keyboard.press("Tab");
    await page.waitForTimeout(150);
    await barShot(page, `statusbar-${theme}-focus-language`, { left: false });
    report(`${theme}/py`, errors);
    await browser.close();
  }
  {
    const { browser, page, errors } = await openZoomed({ theme, hash: ids.go });
    await barShot(page, `statusbar-${theme}-0errors`);
    report(`${theme}/go`, errors);
    await browser.close();
  }
  // Highlight-only language.
  {
    const { browser, page, errors } = await openZoomed({ theme, hash: ids.notes });
    await barShot(page, `statusbar-${theme}-highlight-only`, { right: theme === "dark" });
    report(`${theme}/notes`, errors);
    await browser.close();
  }
  // Unsaved, saving, selection, offline. Saves intercepted.
  {
    const { browser, page, errors } = await openZoomed({ theme, hash: ids.go });
    await fakeSaves(page, { delay: 2500 });
    const before = await boxes(page);
    await page.locator(".cm-content").click({ position: { x: 200, y: 40 } });
    await page.keyboard.press("End");
    await page.keyboard.type(" ");
    await page.waitForTimeout(150);
    await barShot(page, `statusbar-${theme}-unsaved`, { left: false });
    const unsaved = await boxes(page);
    await page.waitForTimeout(1300); // 800ms debounce + 300ms grace -> "Saving…"
    await barShot(page, `statusbar-${theme}-saving`, { left: false });
    const saving = await boxes(page);
    await page.keyboard.press("Backspace");
    await page.waitForTimeout(3500);
    // Selection
    await page.keyboard.press("Control+Home");
    await page.keyboard.press("Shift+End");
    await page.waitForTimeout(100);
    await barShot(page, `statusbar-${theme}-selection`, { left: false });
    const selection = await boxes(page);
    if (theme === "dark") {
      console.log("layout (x+width) idle:     ", JSON.stringify(before));
      console.log("layout (x+width) unsaved:  ", JSON.stringify(unsaved));
      console.log("layout (x+width) saving:   ", JSON.stringify(saving));
      console.log("layout (x+width) selection:", JSON.stringify(selection));
      // cursor walk: neighbors must not move
      const xs = new Set();
      for (const key of ["ArrowDown", "ArrowDown", "ArrowDown", "End", "ArrowDown", "Home"]) {
        await page.keyboard.press(key);
        const b = await boxes(page);
        xs.add(`${b["save-state"]}|${b.indent}|${b["status-language"]}`);
      }
      console.log("cursor walk distinct neighbor layouts:", xs.size, [...xs]);
      const selXs = new Set();
      for (let i = 0; i < 5; i++) {
        await page.keyboard.press("Shift+ArrowDown");
        selXs.add((await boxes(page))["save-state"]);
      }
      console.log("selection growth distinct save-state layouts:", selXs.size, [...selXs]);
      const widths = await page.evaluate(() => {
        const host = document.querySelector('[data-testid="cursor-pos"] .st-long');
        const out = {};
        for (const t of ["Ln 1, Col 1", "Ln 99, Col 99", "Ln 99, Col 120", "Ln 999, Col 999", "Saved", "Unsaved", "Saving…"]) {
          const s = document.createElement("span");
          s.textContent = t;
          s.style.cssText = "position:absolute;visibility:hidden;white-space:nowrap";
          host.parentElement.appendChild(s);
          out[t] = Math.round(s.getBoundingClientRect().width * 10) / 10;
          s.remove();
        }
        return out;
      });
      console.log("text widths:", JSON.stringify(widths));
    }
    report(`${theme}/edit`, errors.filter((e) => !/Failed to load resource/.test(e)));
    await page.unrouteAll({ behavior: "ignoreErrors" });
    await browser.close();
  }
  {
    const { browser, page } = await openZoomed({ theme, hash: ids.go });
    await fakeSaves(page, { fail: true });
    await page.locator(".cm-content").click({ position: { x: 200, y: 40 } });
    await page.keyboard.type(" ");
    await page.waitForTimeout(1800);
    await barShot(page, `statusbar-${theme}-offline`, { left: false });
    await page.keyboard.press("Backspace");
    await page.unrouteAll({ behavior: "ignoreErrors" });
    await browser.close();
  }
}

// Phone width: 390px, full app + zoomed bar, plus a selection (widest case).
for (const theme of ["dark", "light"]) {
  const { browser, page, errors } = await openApp({ theme, width: 390, height: 780, hash: ids.py });
  await shot(page, `statusbar-${theme}-phone`);
  report(`${theme}/phone`, errors);
  await browser.close();
  const z = await openZoomed({ theme, width: 390, height: 300, hash: ids.py });
  await barShot(z.page, `statusbar-${theme}-390`);
  await z.page.locator(".cm-content").click({ position: { x: 150, y: 40 } });
  await z.page.keyboard.press("Home");
  await z.page.keyboard.press("Shift+End");
  await z.page.waitForTimeout(100);
  await barShot(z.page, `statusbar-${theme}-390-selection`);
  const overflow = await z.page.evaluate(() => {
    const sb = document.querySelector(".statusbar");
    return { scroll: sb.scrollWidth, client: sb.clientWidth, doc: document.documentElement.scrollWidth };
  });
  console.log(`[${theme}/390] overflow check`, JSON.stringify(overflow));
  await z.browser.close();
}

// Server unreachable at boot -> "Disconnected".
for (const theme of ["dark", "light"]) {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1280, height: 300 }, colorScheme: theme, deviceScaleFactor: 2 });
  await context.addInitScript((t) => { try { localStorage.setItem("snippet-editor:theme", t); } catch {} }, theme);
  const page = await context.newPage();
  await page.route("**/api/snippets", (r) => r.abort("connectionrefused"));
  await page.goto(BASE);
  await page.locator('[data-testid="fatal"]:not([hidden])').waitFor();
  await barShot(page, `statusbar-${theme}-disconnected`, { right: false });
  await browser.close();
}

// 720px (check label + indent hidden), dark only.
{
  const { browser, page } = await openZoomed({ theme: "dark", width: 700, height: 300, hash: ids.py });
  await barShot(page, "statusbar-dark-700");
  await browser.close();
}
