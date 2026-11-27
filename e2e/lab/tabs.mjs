// Tabs: open several, active tab, drag to reorder, close, menu, persistence,
// per-tab editor session (cursor + undo). Run: ./e2e/lab.sh shoot tabs
import assert from "node:assert/strict";
import { openApp, seed, shot } from "./helpers.mjs";

await seed();
const { browser, page, errors } = await openApp({ theme: "dark" });
const tid = (id) => page.locator(`[data-testid="${id}"]`);
const tabTitles = () => page.locator('[data-testid="tab"] .tab-title').allTextContents();
const activeTitle = () => page.locator('[data-testid="tab"][aria-selected="true"] .tab-title').textContent();
const step = (s) => console.log(`✓ ${s}`);
const openFromSidebar = async (title) => {
  await tid("snippet-item").filter({ hasText: title }).first().click();
  await page.waitForFunction((t) => document.querySelector('[data-testid="tab"][aria-selected="true"] .tab-title')?.textContent === t, title);
};

// 1. Open several snippets -> several tabs, the latest is active.
const first = await activeTitle();
for (const t of ["binary_search.py", "LRUCache.java", "package.json"]) if (t !== first) await openFromSidebar(t);
let titles = await tabTitles();
assert.ok(titles.length >= 3, `expected 3+ tabs, got ${titles}`);
assert.equal(await activeTitle(), "package.json");
step(`tabs open: ${titles.join(" | ")}`);

// Re-clicking an open snippet activates its tab instead of opening another.
await openFromSidebar("binary_search.py");
assert.equal((await tabTitles()).length, titles.length);
step("re-opening an open snippet just activates its tab");
await shot(page, "tabs-dark-desktop");

// 2. Per-tab session: cursor + undo survive switching.
await page.locator(".cm-content").click();
await page.keyboard.press("Control+Home");
for (let i = 0; i < 4; i++) await page.keyboard.press("ArrowDown");
await page.keyboard.press("End");
await page.keyboard.insertText("  # note");
const posBefore = (await tid("cursor-pos").getAttribute("aria-label")) ?? "";
await openFromSidebar("LRUCache.java");
await page.locator('[data-testid="tab"]').filter({ hasText: "binary_search.py" }).click();
await page.waitForFunction(() => document.querySelector('[data-testid="tab"][aria-selected="true"] .tab-title')?.textContent === "binary_search.py");
assert.equal(await tid("cursor-pos").getAttribute("aria-label"), posBefore);
await page.keyboard.press("Control+z");
await page.waitForTimeout(100);
assert.ok(!(await page.locator(".cm-content").textContent()).includes("# note"), "undo history was lost");
step("switching tabs keeps cursor and undo history");

// 3. Drag the first tab to the end.
titles = await tabTitles();
const firstTab = page.locator('[data-testid="tab"]').first();
const lastTab = page.locator('[data-testid="tab"]').last();
const a = await firstTab.boundingBox();
const b = await lastTab.boundingBox();
await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
await page.mouse.down();
await page.mouse.move(a.x + a.width / 2 + 20, a.y + a.height / 2, { steps: 4 });
await page.mouse.move(b.x + b.width - 5, b.y + b.height / 2, { steps: 12 });
await shot(page, "tabs-dark-dragging");
await page.mouse.up();
await page.waitForTimeout(250);
const afterDrag = await tabTitles();
assert.deepEqual(afterDrag, [...titles.slice(1), titles[0]]);
step(`drag reorder: ${afterDrag.join(" | ")}`);

// Keyboard reorder: Alt+Shift+ArrowLeft on the focused (last) tab.
await page.locator('[data-testid="tab"]').last().focus();
await page.keyboard.press("Alt+Shift+ArrowLeft");
await page.waitForTimeout(100);
const afterKey = await tabTitles();
assert.deepEqual(afterKey, [...afterDrag.slice(0, -2), afterDrag.at(-1), afterDrag.at(-2)]);
step("keyboard reorder (Alt+Shift+←)");

// 4. Order + active tab survive a reload.
const activeBefore = await activeTitle();
await page.reload();
await page.locator(".cm-editor").waitFor();
await page.waitForTimeout(400);
assert.deepEqual(await tabTitles(), afterKey);
assert.equal(await activeTitle(), activeBefore);
step("tab order and active tab persist across reload");

// 5. Close: × on the active tab activates its right neighbour (or left).
const before = await tabTitles();
const activeIdx = before.indexOf(await activeTitle());
await page.locator('[data-testid="tab"][aria-selected="true"] [data-testid="tab-close"]').click();
await page.waitForTimeout(200);
const afterClose = await tabTitles();
assert.equal(afterClose.length, before.length - 1);
assert.equal(await activeTitle(), before[activeIdx + 1] ?? before[activeIdx - 1]);
step("× closes the tab, neighbour becomes active");

// Middle-click closes a background tab.
const bg = page.locator('[data-testid="tab"][aria-selected="false"]').first();
const bgTitle = await bg.locator(".tab-title").textContent();
await bg.click({ button: "middle" });
await page.waitForTimeout(150);
assert.ok(!(await tabTitles()).includes(bgTitle));
step("middle-click closes a background tab");

// 6. Context menu: open two more, then "Close others".
await openFromSidebar("server.go");
await openFromSidebar("notes");
await page.locator('[data-testid="tab"]').filter({ hasText: "server.go" }).click({ button: "right" });
await shot(page, "tabs-dark-menu");
await tid("menu-item").filter({ hasText: "Close others" }).click();
await page.waitForTimeout(200);
assert.deepEqual(await tabTitles(), ["server.go"]);
assert.equal(await activeTitle(), "server.go");
step("context menu: Close others");

// 7. Close the last tab -> empty state; snippets still in the sidebar.
await page.locator('[data-testid="tab-close"]').click();
await tid("empty-new").waitFor();
assert.equal(await page.locator('[data-testid="tab"]').count(), 0);
assert.ok((await tid("snippet-item").count()) > 0);
await shot(page, "tabs-dark-empty");
step("closing the last tab shows the empty state (nothing deleted)");
await openFromSidebar("binary_search.py");
step("opening from the sidebar leaves the empty state");

// 8. Light theme + many tabs (overflow scrolls).
await tid("theme-toggle").click();
for (const t of ["LRUCache.java", "package.json", "docker-compose.yml", "server.go", "notes", "two pointers in C++ with a deliberately long title"]) {
  await openFromSidebar(t);
}
await page.waitForTimeout(200);
await shot(page, "tabs-light-many");
const strip = await page.evaluate(() => {
  const s = document.querySelector(".tabs-strip");
  return { scroll: s.scrollWidth, client: s.clientWidth, overflow: document.documentElement.scrollWidth - innerWidth };
});
assert.ok(strip.overflow <= 0, "page overflows horizontally");
step(`many tabs scroll inside the strip (${strip.scroll}px in ${strip.client}px), page doesn't overflow`);

// Unsaved dot on the active tab while typing.
await page.locator(".cm-content").click();
await page.keyboard.insertText("x");
await page.locator('[data-testid="tab"].is-dirty').waitFor();
await page.locator(".tabs").screenshot({ path: "/e2e/screenshots/lab/tabs-light-dirty-strip.png" });
await page.keyboard.press("Control+z");
step("unsaved dot shows on the active tab");

// Inline rename on the tab: double-click, type, Enter keeps; Escape reverts.
const active = page.locator('[data-testid="tab"][aria-selected="true"]');
const oldName = await active.locator(".tab-title").textContent();
await active.dblclick();
await tid("title-input").waitFor();
await page.keyboard.insertText("renamed.txt");
await page.locator(".titlebar").screenshot({ path: "/e2e/screenshots/lab/tabs-light-renaming.png" });
await page.keyboard.press("Escape");
assert.equal(await active.locator(".tab-title").textContent(), oldName);
await active.dblclick();
await page.keyboard.insertText("renamed.cpp");
await page.keyboard.press("Enter");
assert.equal(await active.locator(".tab-title").textContent(), "renamed.cpp");
assert.equal(await page.title(), "renamed.cpp · Snippet Editor");
await active.dblclick();
await page.keyboard.insertText(oldName);
await page.keyboard.press("Enter");
step("inline rename on the tab (Escape reverts, Enter keeps; browser title follows)");

if (errors.length) console.log("console errors:\n  " + errors.join("\n  "));
assert.deepEqual(errors, []);
await browser.close();
console.log("\nAll tab checks passed.");
