// Shared helpers for UI-lab screenshot scripts (run via ./e2e/lab.sh shoot <name>).
import { chromium } from "playwright";

export const BASE = process.env.BASE_URL ?? "http://web:5173";
export const API = process.env.API_URL ?? "http://editor:8080";
export const SHOTS = process.env.SHOTS_DIR ?? "/e2e/screenshots/lab";

const SAMPLES = [
  { title: "server.go", language: "Go", code: 'package main\n\nimport (\n\t"fmt"\n\t"net/http"\n)\n\nfunc main() {\n\thttp.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {\n\t\tfmt.Fprintln(w, "hello")\n\t})\n\thttp.ListenAndServe(":8080", nil)\n}\n' },
  { title: "binary_search.py", language: "Python", code: "def binary_search(xs: list[int], target: int) -> int:\n    lo, hi = 0, len(xs) - 1\n    while lo <= hi:\n        mid = (lo + hi) // 2\n        if xs[mid] == target:\n            return mid\n        if xs[mid] < target:\n            lo = mid + 1\n        else:\n            hi = mid - 1\n    return -1\n\n\nfor n in [1, 3, 5]\n    print(binary_search([1, 3, 5, 7], n))\n" },
  { title: "docker-compose.yml", language: "YAML", code: "services:\n  web:\n    image: nginx:alpine\n    ports:\n      - \"8080:80\"\n" },
  { title: "package.json", language: "JSON", code: '{\n  "name": "demo",\n  "version": "1.0.0",\n  "scripts": { "dev": "vite" }\n}\n' },
  { title: "LRUCache.java", language: "Java", code: "import java.util.*;\n\nclass LRUCache<K, V> extends LinkedHashMap<K, V> {\n    private final int capacity;\n\n    LRUCache(int capacity) {\n        super(capacity, 0.75f, true);\n        this.capacity = capacity;\n    }\n\n    @Override\n    protected boolean removeEldestEntry(Map.Entry<K, V> eldest) {\n        return size() > capacity;\n    }\n}\n" },
  { title: "two pointers in C++ with a deliberately long title", language: "C++", code: "#include <vector>\n\nint main() {\n  std::vector<int> v{1, 2, 3};\n  return 0;\n}\n" },
  { title: "notes", language: "Plain text", code: "Talking points:\n- why binary search is O(log n)\n" },
];

/** Make sure the lab server has a realistic set of snippets (idempotent). */
export async function seed() {
  const list = await (await fetch(`${API}/api/snippets`)).json();
  const have = new Set(list.map((s) => s.title));
  for (const s of SAMPLES) {
    if (!have.has(s.title)) {
      await fetch(`${API}/api/snippets`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(s) });
    }
  }
}

/**
 * Open the app. opts: { theme: "dark"|"light", width, height, hash }
 * Returns { browser, page, errors } – errors collects console errors/page errors.
 */
export async function openApp(opts = {}) {
  const { theme = "dark", width = 1280, height = 760 } = opts;
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width, height }, colorScheme: theme, deviceScaleFactor: 1 });
  await context.addInitScript((t) => {
    try { localStorage.setItem("snippet-editor:theme", t); } catch {}
  }, theme);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error") errors.push(`console: ${m.text()}`); });
  await page.goto(BASE + (opts.hash ? `#${opts.hash}` : ""));
  await page.locator(".cm-editor").waitFor();
  await page.waitForTimeout(600); // fonts, lint debounce
  return { browser, page, errors };
}

/** Open a snippet by title via the API id. */
export async function snippetId(title) {
  const list = await (await fetch(`${API}/api/snippets`)).json();
  return list.find((s) => s.title === title)?.id;
}

export async function shot(page, name) {
  const path = `${SHOTS}/${name}.png`;
  await page.screenshot({ path });
  console.log(`saved ${path.replace("/e2e/", "e2e/")}`);
}
