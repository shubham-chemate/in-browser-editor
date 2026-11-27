// Title bar + language quick-pick screenshots and behavior checks.
// Run: ./e2e/lab.sh shoot titlebar   -> e2e/screenshots/lab/titlebar-*.png
import { openApp, seed, shot, SHOTS, snippetId } from "./helpers.mjs";

await seed();
const hash = await snippetId("binary_search.py");
const problems = [];
const check = (cond, msg) => {
  if (!cond) problems.push(msg);
};

async function clip(page, name, { height = 40, extra = 0 } = {}) {
  const width = page.viewportSize().width;
  const path = `${SHOTS}/${name}.png`;
  await page.screenshot({ path, clip: { x: 0, y: 0, width, height: height + extra } });
  console.log(`saved ${path.replace("/e2e/", "e2e/")}`);
}

const titleSel = "[data-testid=title-input]";
const pickerSel = "[data-testid=language-search]";

for (const theme of ["dark", "light"]) {
  const { browser, page, errors } = await openApp({ theme, width: 1280, height: 760, hash });
  try {
  await page.waitForFunction((s) => document.querySelector(s)?.value, titleSel, { timeout: 5000 }).catch(() => problems.push(`${theme}: app did not load a snippet (boot failed?)`));
  const t = `titlebar-${theme}`;
  await shot(page, `${t}-desktop`);
  await clip(page, `${t}-bar`);

  // title hover
  await page.hover(titleSel);
  await page.waitForTimeout(200);
  await clip(page, `${t}-title-hover`);

  // title editing (F2 focuses + selects)
  await page.mouse.move(640, 400);
  await page.locator(".cm-content").click();
  await page.keyboard.press("F2");
  await page.waitForTimeout(150);
  check(await page.evaluate((s) => document.activeElement === document.querySelector(s), titleSel), `${theme}: F2 did not focus title`);
  await clip(page, `${t}-title-editing`);
  // Escape reverts
  await page.keyboard.insertText("renamed_by_test.py");
  await page.keyboard.press("Escape");
  check((await page.inputValue(titleSel)) === "binary_search.py", `${theme}: Escape did not revert title`);
  // Empty -> placeholder
  await page.keyboard.press("F2");
  await page.keyboard.press("Backspace");
  await page.mouse.move(640, 400);
  await page.waitForTimeout(150);
  await clip(page, `${t}-title-empty`);
  await page.keyboard.press("Escape");
  check((await page.inputValue(titleSel)) === "binary_search.py", `${theme}: Escape after clearing did not revert`);

  // picker from pill
  await page.click("[data-testid=language-button]");
  await page.waitForSelector(pickerSel);
  await page.waitForTimeout(200);
  check(await page.evaluate((s) => document.activeElement === document.querySelector(s), pickerSel), `${theme}: picker search not focused`);
  check((await page.getAttribute("[data-testid=language-option][aria-selected=true]", "data-value")) === "Python", `${theme}: active row is not current`);
  await shot(page, `${t}-picker`);
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await page.waitForTimeout(100);
  await clip(page, `${t}-picker-clip`, { height: 560 });
  await page.fill(pickerSel, "ja");
  await page.waitForTimeout(120);
  await clip(page, `${t}-picker-filtered`, { height: 300 });
  const filtered = await page.locator("[data-testid=language-option]").evaluateAll((os) => os.map((o) => o.dataset.value));
  check(filtered.join() === "Java,JavaScript", `${theme}: "ja" matched ${filtered.join()}`);
  await page.keyboard.press("ArrowUp");
  check((await page.getAttribute("[data-testid=language-option][aria-selected=true]", "data-value")) === "JavaScript", `${theme}: ArrowUp did not wrap`);
  await page.fill(pickerSel, ".rs");
  const byExt = await page.locator("[data-testid=language-option]").evaluateAll((os) => os.map((o) => o.dataset.value));
  check(byExt.includes("Rust"), `${theme}: ".rs" did not match Rust (${byExt})`);
  await page.fill(pickerSel, "zzz");
  await page.waitForTimeout(100);
  await clip(page, `${t}-picker-empty`, { height: 260 });
  await page.keyboard.press("Escape");
  check((await page.locator(pickerSel).count()) === 0, `${theme}: Escape did not close picker`);
  check(await page.evaluate(() => document.activeElement?.dataset.testid === "language-button"), `${theme}: focus not returned to pill`);

  // chord Ctrl/Cmd+K M from the editor, pick with Enter
  await page.locator(".cm-content").click();
  await page.keyboard.press("ControlOrMeta+k");
  await page.keyboard.press("m");
  await page.waitForSelector(pickerSel);
  await page.keyboard.type("go");
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => document.querySelector("[data-testid=language-button]")?.textContent?.includes("Go"), null, { timeout: 5000 });
  check(await page.evaluate(() => !!document.activeElement?.closest(".cm-editor")), `${theme}: focus not in editor after pick`);
  await clip(page, `${t}-bar-go`);
  // switch back
  await page.click("[data-testid=language-button]");
  await page.fill(pickerSel, "python");
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => document.querySelector("[data-testid=language-button]")?.textContent?.includes("Python"), null, { timeout: 5000 });

  // from the status bar
  const status = page.locator("[data-testid=status-language]");
  if (await status.count()) {
    await status.click();
    await page.waitForSelector(pickerSel);
    await page.waitForTimeout(200);
    await shot(page, `${t}-picker-status`);
    await page.mouse.click(400, 300); // click outside closes
    check((await page.locator(pickerSel).count()) === 0, `${theme}: click outside did not close picker`);
  }

  // more menu
  await page.click("[data-testid=more-menu]");
  await page.waitForTimeout(150);
  await clip(page, `${t}-more`, { height: 220 });
  await page.keyboard.press("Escape");

  // hover tooltips present
  const titles = await page.locator(".titlebar button").evaluateAll((bs) => bs.filter((b) => b.offsetParent).map((b) => b.title || "(none)"));
  check(!titles.includes("(none)"), `${theme}: button without tooltip: ${titles}`);

  } catch (err) {
    problems.push(`${theme}: ${err.message.split("\n")[0]}`);
  }
  if (errors.length) problems.push(`[${theme}] console errors:\n  ` + errors.join("\n  "));
  await browser.close();
}

// narrow
for (const theme of ["dark", "light"]) {
  const { browser, page, errors } = await openApp({ theme, width: 390, height: 780, hash: await snippetId("two pointers in C++ with a deliberately long title") });
  await shot(page, `titlebar-${theme}-phone`);
  await clip(page, `titlebar-${theme}-phone-bar`);
  const overflow = await page.evaluate(() => {
    const tb = document.querySelector(".titlebar");
    return { doc: document.documentElement.scrollWidth, tb: tb.scrollWidth, w: window.innerWidth };
  });
  check(overflow.doc <= overflow.w && overflow.tb <= overflow.w, `${theme} phone: horizontal overflow ${JSON.stringify(overflow)}`);
  await page.click("[data-testid=language-button]");
  await page.waitForSelector(pickerSel);
  await page.waitForTimeout(200);
  await shot(page, `titlebar-${theme}-phone-picker`);
  const box = await page.locator(".lp-pop").boundingBox();
  check(box.x >= 0 && box.x + box.width <= 390, `${theme} phone: picker outside viewport ${JSON.stringify(box)}`);
  if (errors.length) problems.push(`[${theme} phone] console errors:\n  ` + errors.join("\n  "));
  await browser.close();
}

console.log(problems.length ? `\nPROBLEMS:\n- ${problems.filter(Boolean).join("\n- ")}` : "\nall title bar checks passed");
