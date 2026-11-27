// End-to-end smoke test, run in a real (headless) Chromium.
// Use ./e2e/run.sh, which starts a throwaway app container with an empty volume.
// Targets the stable data-testids from docs/ui-plan.md §7.
import { chromium } from "playwright";
import assert from "node:assert/strict";

const BASE = process.env.BASE_URL ?? "http://editor:8080";
const SHOTS = process.env.SHOTS_DIR ?? "/shots";

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 760 }, colorScheme: "dark" });
const page = await context.newPage();
const consoleErrors = [];
page.on("pageerror", (e) => consoleErrors.push(e.message));
page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text()));

const tid = (id) => page.locator(`[data-testid="${id}"]`);
const step = (name) => console.log(`✓ ${name}`);
const isMac = await page.evaluate(() => /Mac/.test(navigator.platform)).catch(() => false);
const MOD = isMac ? "Meta" : "Control";

const waitText = (id, re) =>
  page.waitForFunction(
    ([id, src]) => new RegExp(src).test(document.querySelector(`[data-testid="${id}"]`)?.textContent ?? ""),
    [id, re.source],
  );
const saved = () => waitText("save-state", /Saved/);
const setCode = async (code) => {
  await page.locator(".cm-content").click();
  await page.keyboard.press(`${MOD}+a`);
  await page.keyboard.insertText(code);
};
const pickLanguage = async (name) => {
  await tid("language-button").click();
  await tid("language-search").fill(name);
  await page.locator(`[data-testid="language-option"][data-value="${name}"]`).click();
  await waitText("status-language", new RegExp(`^\\W*${name.replace(/[+#]/g, "\\$&")}\\W*$`));
};
const activeTab = (title) =>
  page.waitForFunction(
    (t) => document.querySelector('[data-testid="tab"][aria-selected="true"] .tab-title')?.textContent === t,
    title,
  );
const errorCount = async () => Number((await tid("problems").textContent()).match(/\d+/)?.[0] ?? 0);

// 1. First run creates the Welcome snippet, with its deliberate mistake.
await page.goto(BASE);
await page.locator(".cm-editor").waitFor();
await activeTab("Welcome");
await page.locator(".cm-lintRange-error").first().waitFor();
assert.equal(await errorCount(), 1);
assert.equal(await page.locator(".cm-lintRange-error").first().textContent(), "]");
step("welcome snippet shows 1 syntax error on `]`");
await page.screenshot({ path: `${SHOTS}/1-dark-welcome.png` });

// 2. Hovering the squiggle explains it.
await page.locator(".cm-lintRange-error").first().hover();
const tip = page.locator(".cm-tooltip-lint");
await tip.waitFor();
assert.match(await tip.textContent(), /missing after/);
step("hover card explains the error");
await page.screenshot({ path: `${SHOTS}/2-dark-tooltip.png` });
await page.mouse.move(640, 700);

// 3. Status bar problems button jumps to the error; fixing clears it and autosaves.
await tid("problems").click();
await setCode('for person in ["Ada", "Linus"]:\n    print(person)\n');
await page.waitForFunction(async () => !document.querySelector(".cm-lintRange-error"));
await page.waitForTimeout(600);
assert.equal(await errorCount(), 0);
await saved();
step("fixing code clears errors and autosaves");

// 4. New snippet named like a file picks the language automatically.
await tid("new-snippet").click();
await page.waitForFunction(() => document.activeElement?.getAttribute("data-testid") === "title-input");
await page.keyboard.insertText("server.go");
await page.keyboard.press("Enter");
await waitText("status-language", /Go/);
step("new snippet: renamed inline on its tab to server.go, language switched to Go");
assert.equal(await tid("tab").count(), 2);
assert.equal(await page.locator('[data-testid="tab"][aria-selected="true"] .tab-title').textContent(), "server.go");
step("new snippet opened in a second, active tab");
await setCode('package main\n\nimport "fmt"\n\nfunc main() {\n\tfmt.Println("hi"\n}\n');
await page.locator(".cm-lintRange-error").first().waitFor();
assert.ok((await errorCount()) > 0);
step("broken Go flagged");
await saved();
await page.screenshot({ path: `${SHOTS}/3-dark-go-error.png` });

// 5. Language quick-pick + every featured language: valid code -> no errors.
const valid = {
  Java: "import java.util.*;\n\nclass A {\n  Map<String, List<Integer>> m = new HashMap<>();\n}\n",
  "C++": "#include <vector>\n\nint main() {\n  std::vector<int> v{1, 2, 3};\n  return 0;\n}\n",
  YAML: "services:\n  web:\n    image: nginx\n",
  JSON: '{\n  "name": "demo",\n  "list": [1, 2, 3]\n}\n',
};
for (const [lang, code] of Object.entries(valid)) {
  await pickLanguage(lang);
  await setCode(code);
  await page.waitForTimeout(700); // linter debounce
  assert.equal(await page.locator(".cm-lintRange-error").count(), 0, `${lang} valid code flagged`);
  step(`${lang}: picked via quick-pick, valid code has no errors`);
}
await setCode('{\n  "a": 1,\n}\n');
await page.locator(".cm-lintRange-error").first().waitFor();
step("JSON trailing comma flagged");

// 6. Highlight-only language: no false errors, status bar says so.
await pickLanguage("Ruby");
await setCode("def greet(name)\n  puts \"hi #{name}\"\nend\n");
await page.waitForTimeout(700);
assert.match(await tid("check-mode").textContent(), /Highlight only/i);
assert.equal(await page.locator(".cm-lintRange-error").count(), 0);
step("Ruby is highlight-only, no false errors");

// 7. Back to Go, reload: everything persisted on the server.
await pickLanguage("Go");
await setCode("package main\n\nfunc main() {}\n");
await saved();
const hashBefore = new URL(page.url()).hash;
await page.reload();
await page.locator(".cm-editor").waitFor();
await activeTab("server.go");
assert.equal(new URL(page.url()).hash, hashBefore);
await waitText("status-language", /Go/);
assert.match(await page.locator(".cm-content").textContent(), /func main\(\) \{\}/);
assert.equal(await tid("snippet-item").count(), 2);
assert.deepEqual(await page.locator('[data-testid="tab"] .tab-title').allTextContents(), ["Welcome", "server.go"]);
step("reload: same tabs, active snippet, language, code and list restored");

// 8. Theme toggle, remembered across reloads.
await tid("theme-toggle").click();
assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), "light");
await page.reload();
await page.locator(".cm-editor").waitFor();
assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), "light");
step("light theme persists after reload");
await tid("snippet-item").filter({ hasText: "Welcome" }).click();
await activeTab("Welcome");
await setCode(`from dataclasses import dataclass

@dataclass
class User:
    name: str

def greet(user: User) -> str:
    return f"Hello, {user.name}!"

for u in [User("Ada"), User("Grace")]
    print(greet(u))
`);
await page.locator(".cm-lintRange-error").first().waitFor();
await page.waitForTimeout(300);
await page.screenshot({ path: `${SHOTS}/4-light-python.png` });

// 9. Copy code shows a toast.
await tid("copy-code").click();
await tid("toast").first().waitFor();
step("copy code shows a toast");

// 10. Search filters the list; sidebar toggles with Ctrl/Cmd+B.
await tid("snippet-search").fill("serv");
await page.waitForFunction(() => document.querySelectorAll('[data-testid="snippet-item"]').length === 1);
await tid("snippet-search").fill("");
await page.locator(".cm-content").click();
await page.keyboard.press(`${MOD}+b`);
await page.waitForFunction(() => !document.querySelector('[data-testid="snippet-search"]')?.checkVisibility());
await page.keyboard.press(`${MOD}+b`);
await tid("snippet-search").waitFor({ state: "visible" });
step("search filters; Ctrl/Cmd+B toggles the sidebar");

// 11. Delete through the ⋯ menu + confirm dialog.
await tid("more-menu").click();
await tid("menu-item").filter({ hasText: "Delete" }).click();
await tid("confirm-ok").click();
await page.waitForFunction(() => document.querySelectorAll('[data-testid="snippet-item"]').length === 1);
assert.deepEqual(await page.locator('[data-testid="tab"] .tab-title').allTextContents(), ["server.go"]);
step("delete via menu + confirm dialog (its tab closes too)");

// 12. Narrow (phone-width) layout doesn't overflow horizontally.
await page.setViewportSize({ width: 390, height: 780 });
await page.waitForTimeout(300);
const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
assert.ok(overflow <= 0, `horizontal overflow of ${overflow}px`);
await page.screenshot({ path: `${SHOTS}/5-light-narrow.png` });
step("narrow layout has no horizontal scroll");

assert.deepEqual(consoleErrors, [], `console errors:\n${consoleErrors.join("\n")}`);
step("no console errors");

await browser.close();
console.log("\nAll e2e checks passed.");
