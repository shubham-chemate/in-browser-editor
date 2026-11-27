// Design-system / editor-canvas screenshots (Agent D). Run: ./e2e/lab.sh shoot design
// Covers syntax colors per language, the lint hover card, selection, panels and
// the primitives (menu, confirm dialog, toast) in both themes. "zoom" shots are
// rendered at 2x device pixels to judge font rendering.
import { chromium } from "playwright";
import { BASE, SHOTS, seed, snippetId } from "./helpers.mjs";

await seed();
const ids = {};
for (const t of ["binary_search.py", "server.go", "LRUCache.java", "package.json", "docker-compose.yml"]) ids[t] = await snippetId(t);

const browser = await chromium.launch();
const allErrors = [];

async function open(theme, { hash, scale = 1, width = 1280, height = 760 } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, colorScheme: theme, deviceScaleFactor: scale });
  await context.addInitScript((t) => {
    try { localStorage.setItem("snippet-editor:theme", t); } catch {}
  }, theme);
  const page = await context.newPage();
  page.on("pageerror", (e) => allErrors.push(`[${theme}] pageerror: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error") allErrors.push(`[${theme}] console: ${m.text()}`); });
  await page.goto(BASE + (hash ? `#${hash}` : ""));
  await page.locator(".cm-editor").waitFor();
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(700); // lint debounce
  return { context, page };
}

async function save(page, name, opts = {}) {
  const path = `${SHOTS}/design-${name}.png`;
  await page.screenshot({ path, ...opts });
  console.log(`saved ${path.replace("/e2e/", "e2e/")}`);
}

/** Clip of the editor's top-left, where the code is. */
async function editorClip(page, w = 760, h = 420) {
  const box = await page.locator(".cm-editor").boundingBox();
  return { x: box.x, y: box.y, width: Math.min(w, box.width), height: Math.min(h, box.height) };
}

async function openSnippet(page, title) {
  await page.evaluate((id) => (location.hash = id), ids[title]);
  await page.waitForFunction((t) => document.querySelector('[data-testid="title-input"]')?.value === t, title).catch(() => {});
  await page.waitForTimeout(700);
}

async function checkPrimitives(page) {
  const focused = () => page.evaluate(() => document.activeElement?.textContent?.trim() ?? "");
  const expect = (cond, msg) => console.log(`${cond ? "ok  " : "FAIL"} ${msg}`);
  await page.keyboard.press("Escape"); // close the demo menu
  const dialog = () =>
    page.evaluate(async () => {
      const m = await import("/src/ui/primitives.ts");
      window.__confirm = m.confirmDialog({ title: "Delete “x”?", message: "Gone for good.", confirmLabel: "Delete", danger: true });
    });
  await dialog();
  await page.keyboard.press("Enter");
  expect((await page.evaluate(() => window.__confirm)) === true, "dialog: Enter confirms");
  await dialog();
  await page.keyboard.press("Tab");
  expect((await focused()) === "Cancel", "dialog: Tab moves OK -> Cancel");
  await page.keyboard.press("Tab");
  expect((await focused()) === "Delete", "dialog: Tab wraps Cancel -> OK");
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Enter");
  expect((await page.evaluate(() => window.__confirm)) === false, "dialog: Enter on Cancel cancels");
  await dialog();
  await page.keyboard.press("Escape");
  expect((await page.evaluate(() => window.__confirm)) === false && !(await page.locator(".ui-backdrop").count()), "dialog: Escape cancels and closes");

  await page.locator('[data-testid="more-menu"]').click();
  await page.keyboard.press("End");
  expect((await focused()) === "Delete", "menu: End -> last item");
  await page.keyboard.press("Home");
  expect((await focused()).startsWith("Rename"), "menu: Home -> first item");
  await page.keyboard.press("d");
  expect((await focused()) === "Duplicate", "menu: typeahead 'd' -> Duplicate");
  await page.keyboard.press("d");
  expect((await focused()) === "Download", "menu: typeahead 'd' again -> Download");
  await page.keyboard.press("Escape");
  expect(!(await page.locator(".ui-menu").count()) && (await page.evaluate(() => document.activeElement?.dataset.testid)) === "more-menu", "menu: Escape closes, focus back on anchor");
}

for (const theme of ["dark", "light"]) {
  // ---- full app + lint card -------------------------------------------------
  {
    const { context, page } = await open(theme, { hash: ids["binary_search.py"] });
    await save(page, `${theme}-app`);
    await page.locator(".cm-lintRange-error").first().hover();
    await page.locator(".cm-tooltip-lint").waitFor();
    await page.waitForTimeout(200);
    const tip = await page.locator(".cm-tooltip-lint").boundingBox();
    const ed = await page.locator(".cm-editor").boundingBox();
    await save(page, `${theme}-lint-card`, { clip: { x: ed.x, y: Math.max(0, tip.y - 140), width: 760, height: tip.height + 200 } });
    await page.mouse.move(900, 600);

    // selection + matching bracket + selection matches
    await page.locator(".cm-line").nth(3).click(); // line 4: mid = (lo + hi) // 2
    await page.keyboard.press("End");
    await page.keyboard.press("Home");
    await page.keyboard.press("Home");
    await page.keyboard.press("Shift+ArrowDown");
    await page.keyboard.press("Shift+ArrowDown");
    await page.waitForTimeout(150);
    await save(page, `${theme}-selection`, { clip: await editorClip(page, 760, 360) });

    // go-to-line panel
    await page.keyboard.press("Control+Alt+g");
    await page.locator(".cm-goto-line").waitFor();
    await page.waitForTimeout(150);
    const ed2 = await page.locator(".cm-editor").boundingBox();
    await save(page, `${theme}-gotoline`, { clip: { x: ed2.x, y: ed2.y + ed2.height - 120, width: ed2.width, height: 120 } });
    await page.keyboard.press("Escape");

    // search panel with matches
    await page.locator(".cm-content").click();
    await page.keyboard.press("Control+f");
    await page.locator(".cm-search .cm-textfield").first().waitFor();
    await page.keyboard.type("mid");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(200);
    await save(page, `${theme}-search`);
    await page.keyboard.press("Escape");

    // more menu, then the delete confirm dialog
    await page.locator('[data-testid="more-menu"]').click();
    await page.locator(".ui-menu").waitFor();
    await page.waitForTimeout(200);
    await page.keyboard.press("ArrowDown");
    const mb = await page.locator(".ui-menu").boundingBox();
    await save(page, `${theme}-menu`, { clip: { x: mb.x - 260, y: 0, width: mb.width + 280, height: mb.y + mb.height + 20 } });
    await page.locator('[data-testid="menu-item"]', { hasText: "Delete" }).click();
    await page.locator('[data-testid="confirm-ok"]').waitFor();
    await page.waitForTimeout(250);
    await save(page, `${theme}-confirm`);
    await page.keyboard.press("Escape");

    // toasts (info + error), triggered through the real module
    await page.evaluate(async () => {
      const m = await import("/src/ui/primitives.ts");
      m.toast("Copied to clipboard");
      m.toast("Couldn't copy: clipboard access was blocked", "error");
    });
    await page.waitForTimeout(300);
    await save(page, `${theme}-toast`, { clip: { x: 340, y: 560, width: 600, height: 200 } });

    // menu flipping upward near the bottom edge
    await page.evaluate(async () => {
      const m = await import("/src/ui/primitives.ts");
      const a = document.querySelector('[data-testid="status-language"]') ?? document.body.lastElementChild;
      m.openMenu(a, [
        { label: "Rename", icon: "pencil", shortcut: "F2", run() {} },
        { label: "Duplicate", icon: "duplicate", run() {} },
        "separator",
        { label: "Delete", icon: "trash", shortcut: "Del", danger: true, run() {} },
      ]);
    });
    await page.waitForTimeout(200);
    await save(page, `${theme}-menu-up`, { clip: { x: 880, y: 520, width: 400, height: 240 } });

    // keyboard behavior of the primitives (light run only; behavior isn't themed)
    if (theme === "light") await checkPrimitives(page);
    await context.close();
  }

  // ---- 2x zoom: each language's code ---------------------------------------
  {
    const { context, page } = await open(theme, { hash: ids["binary_search.py"], scale: 2 });
    await page.mouse.move(1200, 700);
    await save(page, `${theme}-zoom-python`, { clip: await editorClip(page, 700, 420) });
    for (const [title, tag] of [
      ["server.go", "go"],
      ["LRUCache.java", "java"],
      ["package.json", "json"],
      ["docker-compose.yml", "yaml"],
    ]) {
      await openSnippet(page, title);
      await page.mouse.move(1200, 700);
      await save(page, `${theme}-zoom-${tag}`, { clip: await editorClip(page, 700, tag === "java" ? 400 : 330) });
    }
    // the lint card at 2x
    await openSnippet(page, "binary_search.py");
    await page.locator(".cm-lintRange-error").first().hover();
    await page.locator(".cm-tooltip-lint").waitFor();
    await page.waitForTimeout(200);
    const tip = await page.locator(".cm-tooltip-lint").boundingBox();
    const ed = await page.locator(".cm-editor").boundingBox();
    await save(page, `${theme}-zoom-lint`, { clip: { x: ed.x, y: tip.y - 60, width: Math.max(560, tip.x + tip.width - ed.x + 20), height: tip.height + 80 } });
    await context.close();
  }
}

// ---- phone width, dark + light -----------------------------------------------
for (const theme of ["dark", "light"]) {
  const { context, page } = await open(theme, { hash: ids["binary_search.py"], width: 390, height: 780 });
  await save(page, `${theme}-phone`);
  await context.close();
}

await browser.close();
if (allErrors.length) console.log("errors:\n  " + [...new Set(allErrors)].join("\n  "));
else console.log("no console errors");
