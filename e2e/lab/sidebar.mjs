// Sidebar screenshots (Agent A). Run: ./e2e/lab.sh shoot sidebar
// Uses a route that back-dates a few snippets in the list response so every
// recency group (Today / Yesterday / This week / Earlier) shows up. Nothing is
// written to the lab server: renames are cancelled, menus are dismissed.
import { chromium } from "playwright";
import { BASE, SHOTS, seed, snippetId } from "./helpers.mjs";

const DAY = 86_400_000;
const AGE = {
  "package.json": 1 * DAY + 3_600_000,
  "LRUCache.java": 3 * DAY,
  notes: 19 * DAY,
  "two pointers in C++ with a deliberately long title": 70 * DAY,
  "docker-compose.yml": 3 * 3_600_000,
};

async function open({ theme = "dark", width = 1280, height = 760, hash, scale = 1, empty = false } = {}) {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width, height }, colorScheme: theme, deviceScaleFactor: scale });
  await context.addInitScript((t) => {
    try {
      localStorage.setItem("snippet-editor:theme", t);
      localStorage.removeItem("snippet-editor:sidebar-width");
      localStorage.removeItem("snippet-editor:sidebar-open");
    } catch {}
  }, theme);
  if (empty) {
    // Stub in-page so nothing reaches the server: the list is empty and the
    // auto-create of a welcome snippet never resolves (empty state stays up).
    await context.addInitScript(() => {
      const real = window.fetch.bind(window);
      window.fetch = (input, init = {}) => {
        const url = typeof input === "string" ? input : input.url;
        if (/\/api\/snippets$/.test(url)) {
          if ((init.method ?? "GET") === "GET") return Promise.resolve(new Response("[]", { headers: { "Content-Type": "application/json" } }));
          return new Promise(() => {});
        }
        return real(input, init);
      };
    });
  }
  await context.route(/\/api\/snippets$/, async (route) => {
    const req = route.request();
    if (empty) return route.abort(); // belt and braces: never write in empty mode
    if (req.method() !== "GET") return route.continue();
    const res = await route.fetch();
    const list = await res.json();
    const now = Date.now();
    for (const s of list) if (AGE[s.title]) s.updatedAt = new Date(now - AGE[s.title]).toISOString();
    list.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return route.fulfill({ response: res, json: list });
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`console: ${m.text()}`);
  });
  await page.goto(BASE + (hash ? `#${hash}` : ""));
  await page.locator(".cm-editor").waitFor();
  if (!empty) await page.locator("[data-testid=snippet-item][aria-selected=true]").waitFor({ state: "attached" });
  await page.waitForTimeout(500);
  return { browser, page, errors };
}

const save = async (page, name, clip) => {
  const path = `${SHOTS}/sidebar-${name}.png`;
  await page.screenshot({ path, clip });
  console.log(`saved ${path.replace("/e2e/", "e2e/")}`);
};
const sidebarClip = async (page, h = 420) => {
  const b = await page.locator(".sidebar").boundingBox();
  return { x: 0, y: 0, width: Math.ceil(b.x + b.width) + 24, height: Math.min(h, b.y + b.height) };
};
const row = (page, title) => page.locator("[data-testid=snippet-item]", { hasText: title });
const report = (tag, errors) => console.log(errors.length ? `[${tag}] ERRORS:\n  ${errors.join("\n  ")}` : `[${tag}] no console errors`);

await seed();
const hash = await snippetId("binary_search.py");

for (const theme of ["dark", "light"]) {
  // full app
  {
    const { browser, page, errors } = await open({ theme, hash });
    await save(page, `${theme}-desktop`);
    // hover a non-active row
    await row(page, "server.go").hover();
    await page.waitForTimeout(200);
    await save(page, `${theme}-hover`, await sidebarClip(page));
    // row menu open
    await row(page, "docker-compose.yml").hover();
    await row(page, "docker-compose.yml").locator("[data-testid=item-menu]").click();
    await page.waitForTimeout(150);
    await save(page, `${theme}-menu`, { x: 0, y: 0, width: 520, height: 420 });
    await page.keyboard.press("Escape");
    // keyboard: Ctrl+P, ArrowDown x2 (cursor ring)
    await page.mouse.move(900, 400);
    await page.keyboard.press("Control+p");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    await page.waitForTimeout(150);
    await save(page, `${theme}-keyboard`, await sidebarClip(page));
    // inline rename (cancelled)
    await page.keyboard.press("F2");
    await page.waitForTimeout(100);
    await save(page, `${theme}-rename`, await sidebarClip(page));
    const renameFocused = await page.evaluate(() => document.activeElement?.classList.contains("sb-rename"));
    await page.keyboard.press("Escape");
    console.log(`rename input focused: ${renameFocused}; after Esc focus on listbox: ${await page.evaluate(() => document.activeElement?.id === "sb-listbox")}`);
    // search with matches, then none
    await page.keyboard.press("Control+p");
    await page.keyboard.type("py");
    await page.waitForTimeout(100);
    await save(page, `${theme}-search`, await sidebarClip(page));
    await page.keyboard.press("Control+a");
    await page.keyboard.type("kubernetes");
    await page.waitForTimeout(100);
    await save(page, `${theme}-nomatch`, await sidebarClip(page));
    await page.keyboard.press("Escape");
    console.log(`after Esc in search, focus in editor: ${await page.evaluate(() => !!document.activeElement?.closest(".cm-editor"))}`);
    report(`${theme} desktop`, errors);
    await browser.close();
  }
  // 2x detail crop
  {
    const { browser, page, errors } = await open({ theme, hash, scale: 2 });
    await row(page, "LRUCache.java").hover();
    await page.waitForTimeout(200);
    await save(page, `${theme}-detail-2x`, { x: 0, y: 0, width: 300, height: 400 });
    report(`${theme} 2x`, errors);
    await browser.close();
  }
  // narrow drawer
  {
    const { browser, page, errors } = await open({ theme, hash, width: 390, height: 780 });
    await save(page, `${theme}-phone-closed`);
    await page.locator("#titlebar-root [data-action=sidebar]").click();
    await page.waitForTimeout(250);
    await save(page, `${theme}-phone-drawer`);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(100);
    console.log(`drawer hidden after Esc: ${await page.locator(".sidebar").isHidden()}`);
    report(`${theme} phone`, errors);
    await browser.close();
  }
}

// empty state + resize (dark only)
{
  const { browser, page, errors } = await open({ theme: "dark", empty: true });
  await page.waitForTimeout(300);
  await save(page, "dark-empty", { x: 0, y: 0, width: 520, height: 320 });
  report("empty", errors.filter((e) => !e.includes("Failed to load")));
  await browser.close();
}
{
  const { browser, page, errors } = await open({ theme: "light", hash });
  const h = await page.locator(".sb-resize").boundingBox();
  await page.mouse.move(h.x + 3, 300);
  await page.mouse.down();
  await page.mouse.move(h.x + 120, 300, { steps: 5 });
  await page.waitForTimeout(100);
  await save(page, "light-resizing", { x: 0, y: 0, width: 700, height: 420 });
  await page.mouse.up();
  const w1 = await page.locator(".sidebar").evaluate((el) => el.getBoundingClientRect().width);
  await page.mouse.move(h.x + 120, 300);
  await page.mouse.move(h.x + 3, 300);
  await page.locator(".sb-resize").dblclick();
  const w2 = await page.locator(".sidebar").evaluate((el) => el.getBoundingClientRect().width);
  const stored = await page.evaluate(() => localStorage.getItem("snippet-editor:sidebar-width"));
  console.log(`resize: dragged=${w1}px, after dblclick=${w2}px, stored=${stored}`);
  report("resize", errors);
  await browser.close();
}

// behavior checks (no writes: renames are cancelled with Escape)
{
  const { browser, page, errors } = await open({ theme: "dark", hash });
  const active = () => page.evaluate(() => document.activeElement?.className || document.activeElement?.tagName);
  // dblclick a non-current row: it opens, then the inline rename must survive the editor focus
  const serverId = await snippetId("server.go");
  await row(page, "server.go").dblclick();
  await page.waitForTimeout(800);
  const sel = await page.locator(`#sb-opt-${serverId}`).getAttribute("aria-selected");
  console.log(`dblclick non-current -> rename input focused: ${(await active()) === "sb-rename"}, selected: ${sel}`);
  await page.keyboard.press("Escape");
  // F2 inside the list must not start the title bar rename
  await page.keyboard.press("F2");
  console.log(`F2 in list -> active: ${await active()}`);
  await page.keyboard.press("Escape");
  // keyboard nav + Home/End
  await page.keyboard.press("End");
  const endId = await page.locator("#sb-listbox").getAttribute("aria-activedescendant");
  await page.keyboard.press("Home");
  const homeId = await page.locator("#sb-listbox").getAttribute("aria-activedescendant");
  console.log(`End/Home move cursor: ${endId !== homeId}`);
  // Ctrl+B collapse and reopen
  await page.keyboard.press("Control+b");
  const hidden1 = await page.locator(".sidebar").isHidden();
  await page.keyboard.press("Control+b");
  const hidden2 = await page.locator(".sidebar").isHidden();
  await page.locator("[data-action=collapse]").click();
  const hidden3 = await page.locator(".sidebar").isHidden();
  await page.keyboard.press("Control+p");
  console.log(`Ctrl+B hides: ${hidden1}, reopens: ${!hidden2}; header collapse hides: ${hidden3}; Ctrl+P reopens+focuses search: ${(await page.evaluate(() => document.activeElement?.dataset.testid)) === "snippet-search"}`);
  // the list is a single tab stop: Tab from search lands on the listbox, next Tab leaves it
  await page.keyboard.press("Tab");
  const t1 = await page.evaluate(() => document.activeElement?.id);
  await page.keyboard.press("Tab");
  const t2 = await page.evaluate(() => document.activeElement?.className);
  console.log(`Tab: search -> ${t1} -> ${t2}`);
  // restore: reopen binary_search.py
  await row(page, "binary_search.py").click();
  report("behavior", errors);
  await browser.close();
}
