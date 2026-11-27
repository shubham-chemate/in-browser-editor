// Top row: sidebar toggle, tabs, language pill, copy / theme / more actions.
// See docs/ui-plan.md §4.2.
import "./titlebar.css";
import type { AppActions, AppState, Store } from "../state";
import { uiEvents } from "../state";
import { iconSvg } from "./icons";
import { isLanguagePickerOpen, closeLanguagePicker, languageBadge, openLanguagePicker } from "./languagePicker";
import { openMenu } from "./primitives";

const IS_MAC = /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent);
const MOD = IS_MAC ? "⌘" : "Ctrl+";
const KEYS = {
  sidebar: `${MOD}B`,
  language: IS_MAC ? "⌘K M" : "Ctrl+K M",
};
const CHORD_MS = 1500;

/**
 * The top row of the editor area: sidebar toggle, the tab strip (mounted into
 * the returned `tabsSlot` by ui/tabs.ts), then language pill + actions.
 * (There is no separate title bar: tabs carry the title, like Zed/Cursor.)
 */
export function mountTitlebar(root: HTMLElement, store: Store<AppState>, actions: AppActions): { tabsSlot: HTMLElement } {
  root.classList.add("titlebar");
  root.innerHTML = `
    <div class="tb-left">
      <button class="icon-btn tb-sidebar" type="button" data-action="sidebar">${iconSvg("sidebar")}</button>
    </div>
    <div class="tb-tabs"></div>
    <div class="tb-right">
      <button class="tb-lang" type="button" data-testid="language-button" aria-haspopup="listbox" aria-expanded="false">
        <span class="tb-lang-badge"></span>
        <span class="tb-lang-name"></span>
        <span class="tb-lang-chev" aria-hidden="true">${iconSvg("chevron-down", 14)}</span>
      </button>
      <span class="tb-divider" aria-hidden="true"></span>
      <button class="icon-btn tb-copy" type="button" data-testid="copy-code" title="Copy code" aria-label="Copy code">${iconSvg("copy")}</button>
      <button class="icon-btn" type="button" data-testid="theme-toggle"></button>
      <button class="icon-btn" type="button" data-testid="more-menu" title="More actions" aria-label="More actions" aria-haspopup="menu" aria-expanded="false">${iconSvg("more")}</button>
    </div>
  `;
  const $ = <T extends HTMLElement>(sel: string) => root.querySelector<T>(sel)!;
  const sidebarBtn = $<HTMLButtonElement>(".tb-sidebar");
  const tabsSlot = $<HTMLDivElement>(".tb-tabs");
  const lang = $<HTMLButtonElement>(".tb-lang");
  const langBadge = $<HTMLSpanElement>(".tb-lang-badge");
  const langName = $<HTMLSpanElement>(".tb-lang-name");
  const theme = $<HTMLButtonElement>("[data-testid=theme-toggle]");
  const more = $<HTMLButtonElement>("[data-testid=more-menu]");

  sidebarBtn.addEventListener("click", () => actions.setSidebarOpen(!store.state.sidebarOpen));

  // ---- language pill + quick-pick --------------------------------------------
  const showPicker = (from: "pill" | "status" = "pill") => {
    if (isLanguagePickerOpen()) closeLanguagePicker();
    const status = from === "status" ? statusAnchor() : null;
    openLanguagePicker({
      anchor: status ?? lang,
      placement: status ? "above" : "below",
      current: store.state.language,
      shortcut: KEYS.language,
      onPick: (name) => actions.setLanguage(name),
      onClose: (picked) => {
        lang.setAttribute("aria-expanded", "false");
        if (picked) actions.focusEditor();
      },
    });
    if (status) lang.setAttribute("aria-expanded", "true");
  };
  let pillJustClosed = false;
  lang.addEventListener("mousedown", (e) => {
    // Toggle: a click on the pill while open closes it (the picker ignores
    // mousedowns on its own anchor, so handle it here).
    if (isLanguagePickerOpen()) {
      e.preventDefault();
      closeLanguagePicker();
      pillJustClosed = true;
    }
  });
  lang.addEventListener("click", () => {
    if (pillJustClosed) {
      pillJustClosed = false;
      return;
    }
    showPicker("pill");
  });
  uiEvents.on("open-language-picker", () => showPicker("status"));

  // ---- actions ---------------------------------------------------------------
  $("[data-testid=copy-code]").addEventListener("click", () => void actions.copyCode());
  theme.addEventListener("click", () => actions.toggleTheme());
  let closeMore: (() => void) | null = null;
  more.addEventListener("click", () => {
    if (closeMore && more.getAttribute("aria-expanded") === "true") {
      closeMore();
      closeMore = null;
      return;
    }
    const id = store.state.currentId;
    if (!id) return;
    closeMore = openMenu(more, [
      { label: "Rename", icon: "pencil", shortcut: "F2", run: () => actions.startRename() },
      { label: "Duplicate", icon: "duplicate", run: () => actions.duplicate(id) },
      { label: "Download", icon: "download", run: () => actions.download(id) },
      "separator",
      { label: "Delete", icon: "trash", danger: true, run: () => void actions.requestDelete(id) },
    ]);
  });

  // ---- render from state -------------------------------------------------------
  store.subscribe((s, prev) => {
    const first = s === prev;
    if (s.language !== prev.language || first) {
      langBadge.replaceChildren(languageBadge(s.language));
      langName.textContent = s.language;
      lang.title = `Change language (${KEYS.language})`;
      lang.setAttribute("aria-label", `Language: ${s.language}. Change language`);
    }
    if (s.theme !== prev.theme || first) {
      const toLight = s.theme === "dark";
      theme.innerHTML = iconSvg(toLight ? "sun" : "moon");
      theme.title = toLight ? "Switch to light theme" : "Switch to dark theme";
      theme.setAttribute("aria-label", theme.title);
    }
    if (s.sidebarOpen !== prev.sidebarOpen || first) {
      const label = s.sidebarOpen ? "Hide sidebar" : "Show sidebar";
      sidebarBtn.title = `${label} (${KEYS.sidebar})`;
      sidebarBtn.setAttribute("aria-label", label);
      sidebarBtn.setAttribute("aria-expanded", String(s.sidebarOpen));
      sidebarBtn.classList.toggle("is-on", s.sidebarOpen);
    }
  });

  // ---- global shortcuts: F2, Ctrl/Cmd+K M -----------------------------------------
  let chordUntil = 0;
  window.addEventListener(
    "keydown",
    (e) => {
      if (e.isComposing) return;
      const mod = IS_MAC ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
      if (chordUntil) {
        if (["Meta", "Control", "Shift", "Alt"].includes(e.key)) return;
        const live = performance.now() < chordUntil;
        chordUntil = 0;
        if (live && e.key.toLowerCase() === "m" && !e.altKey && !e.shiftKey) {
          e.preventDefault();
          e.stopPropagation();
          showPicker("pill");
          return;
        }
      }
      if (mod && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        e.stopPropagation();
        chordUntil = performance.now() + CHORD_MS;
      }
    },
    true,
  );
  window.addEventListener("keydown", (e) => {
    // Bubble phase: the sidebar list handles its own F2 (and prevents default).
    if (e.key !== "F2" || e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    e.preventDefault();
    actions.startRename();
  });

  return { tabsSlot };
}

/** The status bar's language segment, if it's on screen. */
function statusAnchor(): HTMLElement | null {
  const el = document.querySelector<HTMLElement>("[data-testid=status-language]");
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 ? el : null;
}
