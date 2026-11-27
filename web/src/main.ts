// App controller: owns state, saving, and the editor. UI regions (src/ui/*)
// render from the store and call actions. See docs/ui-plan.md §7.
import "./tokens.css";
import "./app.css";
import "./ui/editor.css";
import { diagnosticCount } from "@codemirror/lint";
import type { EditorView } from "@codemirror/view";
import { api, type Snippet, type SnippetChanges } from "./api";
import { Editor, type EditorSnapshot } from "./editor";
import { closeTabs, moveTab, openTab, restoreTabs } from "./tabsModel";
import { mountTabs } from "./ui/tabs";
import { languageFromTitle, loadLanguage, type LoadedLanguage } from "./languages";
import { Store, uiEvents, type AppActions, type AppState, type SaveState } from "./state";
import { applyPageTheme, initialTheme, rememberTheme } from "./theme";
import { downloadName } from "./ui/languageMeta";
import { confirmDialog, toast } from "./ui/primitives";
import { mountSidebar } from "./ui/sidebar";
import { mountStatusbar } from "./ui/statusbar";
import { mountTitlebar } from "./ui/titlebar";
import { WELCOME } from "./welcome";

const LAST_LANG_KEY = "snippet-editor:last-language";
const SIDEBAR_KEY = "snippet-editor:sidebar-open";
const TABS_KEY = "snippet-editor:tabs";
const SAVE_DELAY_MS = 800;
const RETRY_DELAY_MS = 3000;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const isNarrow = () => window.matchMedia("(max-width: 720px)").matches;

// ---- state ----------------------------------------------------------------
const store = new Store<AppState>({
  snippets: [],
  tabs: [],
  currentId: null,
  title: "",
  language: "Python",
  syntaxChecked: true,
  theme: initialTheme(),
  sidebarOpen: !isNarrow() && readBool(SIDEBAR_KEY, true),
  saveState: "saved",
  errors: 0,
  cursor: { line: 1, col: 1, selected: 0 },
  indent: "Spaces: 4",
  fatalError: null,
});

let current: Snippet | null = null;
let pending: { id: string; data: SnippetChanges } | null = null;
let saveTimer: number | undefined;
let saveChain: Promise<unknown> = Promise.resolve();
let openToken = 0; // guards against out-of-order opens when clicking quickly

applyPageTheme(store.state.theme);

const editor = new Editor($("editor"), store.state.theme, {
  onChange: (code) => {
    if (!current) return;
    current.code = code;
    queueSave({ code });
  },
  onUpdate: syncEditorState,
  onSave: () => void flushSave(),
});

function syncEditorState(view: EditorView) {
  const sel = view.state.selection.main;
  const line = view.state.doc.lineAt(sel.head);
  const cursor = store.state.cursor;
  const next = { line: line.number, col: sel.head - line.from + 1, selected: Math.abs(sel.to - sel.from) };
  store.set({
    errors: diagnosticCount(view.state),
    cursor: next.line === cursor.line && next.col === cursor.col && next.selected === cursor.selected ? cursor : next,
    indent: editor?.indentLabel ?? store.state.indent,
  });
}

// ---- saving ---------------------------------------------------------------
function setSave(saveState: SaveState) {
  store.set({ saveState });
}

function queueSave(changes: SnippetChanges) {
  if (!current) return;
  if (pending && pending.id !== current.id) void flushSave();
  pending = { id: current.id, data: { ...(pending?.data ?? {}), ...changes } };
  setSave("unsaved");
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => void flushSave(), SAVE_DELAY_MS);
}

/** Send any pending changes. Saves run one after another, never out of order. */
function flushSave(): Promise<unknown> {
  window.clearTimeout(saveTimer);
  if (!pending) return saveChain;
  const { id, data } = pending;
  pending = null;
  setSave("saving");
  saveChain = saveChain.then(async () => {
    try {
      const saved = await api.update(id, data);
      patchMeta(id, { title: saved.title, language: saved.language, updatedAt: saved.updatedAt });
      if (!pending) setSave("saved");
    } catch (err) {
      console.error(err);
      // Put the changes back (newer edits win) and try again shortly.
      if (!pending || pending.id === id) {
        pending = { id, data: { ...data, ...(pending?.data ?? {}) } };
        window.clearTimeout(saveTimer);
        saveTimer = window.setTimeout(() => void flushSave(), RETRY_DELAY_MS);
      }
      setSave("error");
    }
  });
  return saveChain;
}

/** Update one snippet's list metadata; keeps the list sorted by recency. */
function patchMeta(id: string, patch: Partial<AppState["snippets"][number]>) {
  const snippets = store.state.snippets
    .map((s) => (s.id === id ? { ...s, ...patch } : s))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  store.set({ snippets });
}

window.addEventListener("beforeunload", () => {
  if (pending) api.updateOnUnload(pending.id, pending.data);
});

// ---- tabs & snippet operations ---------------------------------------------
/**
 * Every open tab keeps its snippet and (once it has been shown) its editor
 * session: text, undo history, selection, folds and scroll position.
 */
const sessions = new Map<string, { snippet: Snippet; snap?: EditorSnapshot }>();

/** Park the active tab's editor session so it can come back exactly as it was. */
function parkCurrent() {
  if (current && store.state.tabs.includes(current.id)) {
    sessions.set(current.id, { snippet: current, snap: editor.snapshot() });
  }
}

/** Activate a snippet's tab (opening a tab for it if needed). */
async function openSnippet(id: string) {
  const token = ++openToken;
  await flushSave();
  const session = sessions.get(id);
  const snippet = session?.snippet ?? (await api.get(id));
  const lang = await loadLanguage(snippet.language);
  if (token !== openToken) return; // a newer open won the race

  parkCurrent();
  const tabs = openTab(store.state.tabs, id, current?.id ?? null);
  current = snippet;
  if (session?.snap) editor.restore(session.snap);
  else editor.load(snippet.code, lang);
  sessions.set(id, { snippet });
  showEditor(true);
  if (location.hash.slice(1) !== id) history.replaceState(null, "", `#${id}`);
  store.set({
    tabs,
    currentId: id,
    title: snippet.title,
    ...languageState(lang),
    saveState: "saved",
    indent: editor.indentLabel,
  });
  syncEditorState(editor.view);
  if (isNarrow()) store.set({ sidebarOpen: false });
  editor.focus();
}

/** Close tabs; if the active one closes, its neighbour takes over (or the empty state shows). */
async function closeTabsById(ids: string[]) {
  if (!ids.length) return;
  const activeId = current?.id ?? null;
  const closingActive = activeId !== null && ids.includes(activeId);
  if (closingActive) await flushSave();
  const { tabs, active } = closeTabs(store.state.tabs, ids, activeId);
  for (const id of ids) sessions.delete(id);
  store.set({ tabs });
  if (!closingActive) return;
  current = null; // don't park the closed tab
  if (active) await openSnippet(active);
  else showEmptyState();
}

/** No tab open: hide the editor and show the "open something" panel. */
function showEmptyState() {
  openToken++;
  current = null;
  showEditor(false);
  history.replaceState(null, "", location.pathname + location.search);
  store.set({ currentId: null, title: "", errors: 0, saveState: "saved" });
}

function showEditor(show: boolean) {
  $("editor").hidden = !show;
  $("empty-editor").hidden = show;
  document.querySelector(".app")!.toggleAttribute("data-no-snippet", !show);
}

async function createSnippet(data: SnippetChanges = {}) {
  await flushSave();
  const snippet = await api.create({ title: "Untitled", language: lastLanguage(), code: "", ...data });
  store.set({ snippets: [snippet, ...store.state.snippets] });
  await openSnippet(snippet.id);
  if (!data.title) uiEvents.emit("start-rename");
}

async function removeSnippet(id: string) {
  if (pending?.id === id) pending = null;
  await saveChain;
  await api.remove(id);
  store.set({ snippets: store.state.snippets.filter((s) => s.id !== id) });
  if (store.state.tabs.includes(id)) await closeTabsById([id]);
}

async function changeLanguage(name: string) {
  if (!current) return;
  const lang = await loadLanguage(name);
  current.language = lang.name;
  editor.setLanguage(lang);
  rememberLastLanguage(lang.name);
  queueSave({ language: lang.name });
  patchMeta(current.id, { language: lang.name });
  store.set({ ...languageState(lang), indent: editor.indentLabel });
  syncEditorState(editor.view);
}

function languageState(lang: LoadedLanguage) {
  return { language: lang.name, syntaxChecked: lang.name === "JSON" || lang.checked };
}

function renameSnippet(id: string, title: string) {
  if (!current || current.id !== id) {
    // Renamed from the sidebar while open in a background tab: keep its session in sync.
    const parked = sessions.get(id);
    if (parked) parked.snippet.title = title;
    void api.update(id, { title }).then((s) => patchMeta(id, { title: s.title, updatedAt: s.updatedAt }), showError);
    return;
  }
  current.title = title;
  store.set({ title });
  queueSave({ title });
  // "server.go" -> switch to Go automatically.
  const guess = languageFromTitle(title);
  if (guess && guess !== current.language) void changeLanguage(guess).catch(showError);
}

// ---- actions exposed to the UI ------------------------------------------------
const actions: AppActions = {
  open: (id) => {
    if (id !== current?.id) void openSnippet(id).catch(showError);
    else editor.focus();
  },
  closeTabs: (ids) => void closeTabsById(ids).catch(showError),
  moveTab: (id, index) => store.set({ tabs: moveTab(store.state.tabs, id, index) }),
  create: () => void createSnippet().catch(showError),
  async requestDelete(id) {
    const sn = store.state.snippets.find((s) => s.id === id);
    const ok = await confirmDialog({
      title: `Delete “${sn?.title || "Untitled"}”?`,
      message: "This snippet will be permanently deleted. This can't be undone.",
      confirmLabel: "Delete",
      danger: true,
    });
    if (ok) await removeSnippet(id).catch(showError);
  },
  remove: (id) => removeSnippet(id).catch(showError),
  rename: renameSnippet,
  duplicate(id) {
    void (async () => {
      await flushSave();
      const src = await api.get(id);
      await createSnippet({ title: `${src.title} copy`, language: src.language, code: src.code });
      toast("Snippet duplicated");
    })().catch(showError);
  },
  download(id) {
    void (async () => {
      await flushSave();
      const sn = id === current?.id ? current : await api.get(id);
      const blob = new Blob([sn.code], { type: "text/plain;charset=utf-8" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = downloadName(sn.title, sn.language);
      a.click();
      URL.revokeObjectURL(a.href);
    })().catch(showError);
  },
  setLanguage: (name) => void changeLanguage(name).catch(showError),
  openLanguagePicker: () => uiEvents.emit("open-language-picker"),
  startRename: () => uiEvents.emit("start-rename"),
  toggleTheme() {
    const theme = store.state.theme === "dark" ? "light" : "dark";
    applyPageTheme(theme);
    rememberTheme(theme);
    editor.setTheme(theme);
    store.set({ theme });
  },
  setSidebarOpen(open) {
    store.set({ sidebarOpen: open });
    // On phones the sidebar is a temporary drawer; don't let closing it
    // collapse the sidebar on desktop next time.
    if (!isNarrow()) writeBool(SIDEBAR_KEY, open);
  },
  async copyCode() {
    if (await copyText(editor.code)) toast("Copied to clipboard");
    else toast("Couldn't copy: clipboard access was blocked", "error");
  },
  focusEditor: () => editor.focus(),
  saveNow: () => void flushSave(),
  nextError: () => editor.nextError(),
  gotoLine: () => editor.gotoLine(),
};

// ---- helpers ------------------------------------------------------------------
/** Clipboard API where available (secure contexts), else the legacy execCommand path. */
async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through */
  }
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  ta.style.cssText = "position:fixed;top:-1000px;opacity:0";
  document.body.append(ta);
  ta.select();
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  ta.remove();
  editor.focus();
  return ok;
}

function lastLanguage(): string {
  try {
    return localStorage.getItem(LAST_LANG_KEY) || "Python";
  } catch {
    return "Python";
  }
}

function rememberLastLanguage(name: string) {
  try {
    localStorage.setItem(LAST_LANG_KEY, name);
  } catch {
    /* ignore */
  }
}

function readBool(key: string, fallback: boolean): boolean {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : v === "1";
  } catch {
    return fallback;
  }
}

function writeBool(key: string, value: boolean) {
  try {
    localStorage.setItem(key, value ? "1" : "0");
  } catch {
    /* ignore */
  }
}

function showError(err: unknown) {
  console.error(err);
  const banner = $("banner");
  banner.textContent = `Something went wrong: ${err instanceof Error ? err.message : String(err)}`;
  banner.hidden = false;
}

// ---- mount UI regions ---------------------------------------------------------
const { tabsSlot } = mountTitlebar($("titlebar-root"), store, actions);
mountTabs(tabsSlot, store, actions);
mountSidebar($("sidebar-root"), store, actions);
mountStatusbar($("statusbar-root"), store, actions);

$("empty-new").addEventListener("click", () => actions.create());
$("empty-search").addEventListener("click", () => {
  actions.setSidebarOpen(true);
  uiEvents.emit("focus-search");
});

window.addEventListener("hashchange", () => {
  const id = location.hash.slice(1);
  if (id && id !== current?.id && store.state.snippets.some((s) => s.id === id)) actions.open(id);
});

// Browser tab title follows the active snippet.
store.subscribe((s, prev) => {
  if (s.title !== prev.title || s.currentId !== prev.currentId || s === prev) {
    document.title = s.currentId ? `${s.title || "Untitled"} · Snippet Editor` : "Snippet Editor";
  }
});

// ---- tab persistence (per browser) ------------------------------------------
function readSavedTabs(): { tabs?: unknown; active?: unknown } {
  try {
    return JSON.parse(localStorage.getItem(TABS_KEY) ?? "{}") ?? {};
  } catch {
    return {};
  }
}

let booted = false;
store.subscribe((s, prev) => {
  if (!booted || (s.tabs === prev.tabs && s.currentId === prev.currentId)) return;
  try {
    localStorage.setItem(TABS_KEY, JSON.stringify({ tabs: s.tabs, active: s.currentId }));
  } catch {
    /* ignore */
  }
});

// ---- boot -------------------------------------------------------------------
async function boot() {
  const snippets = await api.list();
  store.set({ snippets });
  if (!snippets.length) {
    booted = true;
    await createSnippet(WELCOME);
    return;
  }
  // Reopen last session's tabs; a #id link wins for which one is active.
  const ids = new Set(snippets.map((s) => s.id));
  const saved = readSavedTabs();
  const tabs = restoreTabs(saved.tabs, ids);
  const fromHash = location.hash.slice(1);
  const active =
    (ids.has(fromHash) && fromHash) ||
    (typeof saved.active === "string" && tabs.includes(saved.active) && saved.active) ||
    tabs[0] ||
    (saved.tabs === undefined ? snippets[0].id : null); // first visit: open the newest
  store.set({ tabs });
  booted = true;
  if (active) await openSnippet(active);
  else showEmptyState();
}

boot().catch((err) => {
  showError(err);
  const msg = "Can't reach the snippet server. Is the container running? (docker compose up -d)";
  $("banner").textContent = msg;
  store.set({ fatalError: msg });
});
