// Sidebar: snippet explorer (docs/ui-plan.md §4.1).
//
// Rendering is keyed: rows are created once per snippet id and patched in place,
// so typing in the editor or title never rebuilds the list. Keyboard focus lives
// on the listbox itself (aria-activedescendant), which is never re-created, so
// focus is stable across re-renders.
import "./sidebar.css";
import type { SnippetMeta } from "../api";
import type { AppActions, AppState, Store } from "../state";
import { uiEvents } from "../state";
import { icon, iconSvg } from "./icons";
import { languageMeta } from "./languageMeta";
import { openMenu } from "./primitives";

const WIDTH_KEY = "snippet-editor:sidebar-width";
const DEFAULT_W = 264;
const MIN_W = 200;
const MAX_W = 420;
const NARROW_MQ = "(max-width: 720px)";

const IS_MAC = /Mac|iPhone|iPad|iPod/i.test(
  (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ||
    navigator.platform ||
    navigator.userAgent,
);
const MOD = IS_MAC ? "⌘" : "Ctrl+";
const ALT = IS_MAC ? "⌥" : "Alt+";

type GroupKey = "today" | "yesterday" | "week" | "earlier";
const GROUPS: { key: GroupKey; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "week", label: "This week" },
  { key: "earlier", label: "Earlier" },
];

interface Row {
  id: string;
  el: HTMLDivElement;
  badge: HTMLSpanElement;
  title: HTMLSpanElement;
  time: HTMLSpanElement;
  more: HTMLButtonElement;
  // last rendered values, to skip no-op DOM writes
  v: { title: string; lang: string; updated: string; rel: string; selected: boolean };
}

export function mountSidebar(root: HTMLElement, store: Store<AppState>, actions: AppActions) {
  root.classList.add("sidebar");
  root.innerHTML = `
    <div class="sb-head">
      <h2 class="sb-label" id="sb-label">Snippets <span class="sb-count" aria-hidden="true"></span></h2>
      <div class="sb-head-actions">
        <button class="icon-btn sb-icon-btn" type="button" data-testid="new-snippet"
          title="New snippet (${ALT}N)" aria-label="New snippet" aria-keyshortcuts="Alt+N">${iconSvg("plus")}</button>
        <button class="icon-btn sb-icon-btn" type="button" data-action="collapse"
          title="Hide sidebar (${MOD}B)" aria-label="Hide sidebar" aria-keyshortcuts="${IS_MAC ? "Meta" : "Control"}+B">${iconSvg("panel-left-close")}</button>
      </div>
    </div>
    <div class="sb-search">
      <span class="sb-search-icon">${iconSvg("search", 14)}</span>
      <input type="text" data-testid="snippet-search" placeholder="Search snippets" aria-label="Search snippets"
        autocomplete="off" spellcheck="false" aria-controls="sb-listbox" aria-keyshortcuts="${IS_MAC ? "Meta" : "Control"}+P" />
      <kbd class="sb-kbd" aria-hidden="true">${IS_MAC ? "⌘P" : "Ctrl P"}</kbd>
      <button class="sb-clear" type="button" title="Clear search (Esc)" aria-label="Clear search" hidden>${iconSvg("x", 12)}</button>
    </div>
    <div class="sb-list" id="sb-listbox" role="listbox" tabindex="0" aria-labelledby="sb-label"></div>
    <div class="sb-state" hidden></div>
    <div class="sb-resize" role="separator" aria-orientation="vertical" aria-label="Resize sidebar"
      aria-valuemin="${MIN_W}" aria-valuemax="${MAX_W}" tabindex="0" title="Drag to resize · double-click to reset"></div>
  `;

  const $ = <T extends Element>(sel: string) => root.querySelector<T>(sel)!;
  const count = $<HTMLSpanElement>(".sb-count");
  const search = $<HTMLInputElement>("[data-testid=snippet-search]");
  const clearBtn = $<HTMLButtonElement>(".sb-clear");
  const list = $<HTMLDivElement>(".sb-list");
  const stateBox = $<HTMLDivElement>(".sb-state");
  const handle = $<HTMLDivElement>(".sb-resize");
  const narrowMq = window.matchMedia(NARROW_MQ);
  const isNarrow = () => narrowMq.matches;

  const rows = new Map<string, Row>();
  const groupEls = new Map<GroupKey, { el: HTMLDivElement; label: HTMLDivElement }>();
  let visible: SnippetMeta[] = []; // rows in display order
  let activeId: string | null = null; // keyboard cursor (aria-activedescendant)
  let renaming: { id: string; input: HTMLInputElement; done: (commit: boolean) => void } | null = null;
  let pendingRenameId: string | null = null;

  // ---- header & search ------------------------------------------------------
  $("[data-testid=new-snippet]").addEventListener("click", () => actions.create());
  $("[data-action=collapse]").addEventListener("click", () => actions.setSidebarOpen(false));

  const query = () => search.value.trim().toLowerCase();
  search.addEventListener("input", () => {
    syncSearchChrome();
    render(store.state);
    list.scrollTop = 0;
  });
  search.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "Enter") {
      if (!visible.length) return;
      e.preventDefault();
      setActive(visible[0].id);
      list.focus();
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      clearSearch();
      leaveToEditor();
    }
  });
  clearBtn.addEventListener("click", () => {
    clearSearch();
    search.focus();
  });

  function syncSearchChrome() {
    const has = search.value.length > 0;
    root.classList.toggle("is-searching", has);
    clearBtn.hidden = !has;
  }
  function clearSearch() {
    if (!search.value) return;
    search.value = "";
    syncSearchChrome();
    render(store.state);
  }
  function focusSearch() {
    if (!store.state.sidebarOpen) actions.setSidebarOpen(true);
    search.focus();
    search.select();
  }
  function leaveToEditor() {
    if (isNarrow() && store.state.sidebarOpen) actions.setSidebarOpen(false);
    actions.focusEditor();
  }

  // ---- rows -------------------------------------------------------------------
  function makeRow(id: string): Row {
    const el = document.createElement("div");
    el.className = "sb-row";
    el.id = `sb-opt-${id}`;
    el.setAttribute("role", "option");
    el.dataset.testid = "snippet-item";
    el.dataset.id = id;
    const badge = document.createElement("span");
    badge.className = "sb-badge";
    badge.setAttribute("aria-hidden", "true");
    const title = document.createElement("span");
    title.className = "sb-title";
    const trail = document.createElement("span");
    trail.className = "sb-trail";
    const time = document.createElement("span");
    time.className = "sb-time";
    const more = document.createElement("button");
    more.type = "button";
    more.className = "sb-more";
    more.tabIndex = -1;
    more.dataset.testid = "item-menu";
    more.setAttribute("aria-haspopup", "menu");
    more.setAttribute("aria-expanded", "false");
    more.append(icon("more", 16));
    trail.append(time, more);
    el.append(badge, title, trail);
    return { id, el, badge, title, time, more, v: { title: "\0", lang: "\0", updated: "\0", rel: "\0", selected: false } };
  }

  function patchRow(row: Row, sn: SnippetMeta, s: AppState, now: Date) {
    const isCurrent = sn.id === s.currentId;
    const title = (isCurrent ? s.title : sn.title) || "";
    const v = row.v;
    if (v.lang !== sn.language) {
      const meta = languageMeta(sn.language);
      row.badge.textContent = meta.badge;
      row.badge.style.setProperty("--badge", meta.color);
      row.badge.classList.toggle("is-long", meta.badge.length > 3);
      v.lang = sn.language;
    }
    if (v.title !== title && renaming?.id !== row.id) {
      row.title.textContent = title || "Untitled";
      row.title.classList.toggle("is-untitled", !title);
      row.more.setAttribute("aria-label", `Actions for ${title || "Untitled"}`);
      v.title = title;
    }
    const rel = relTime(sn.updatedAt, now);
    if (v.updated !== sn.updatedAt || v.rel !== rel) {
      row.time.textContent = rel;
      const full = fullDate(sn.updatedAt);
      row.time.title = `Edited ${full}`;
      row.time.setAttribute("aria-label", `edited ${full}`);
      v.updated = sn.updatedAt;
      v.rel = rel;
    }
    // tooltip: full title (useful when truncated) + language + date
    row.el.title = `${title || "Untitled"} · ${sn.language} · Edited ${fullDate(sn.updatedAt)}`;
    if (v.selected !== isCurrent) {
      row.el.setAttribute("aria-selected", String(isCurrent));
      v.selected = isCurrent;
    }
  }

  function groupEl(key: GroupKey, label: string) {
    let g = groupEls.get(key);
    if (!g) {
      const el = document.createElement("div");
      el.className = "sb-group";
      el.setAttribute("role", "group");
      el.setAttribute("aria-labelledby", `sb-g-${key}`);
      const lab = document.createElement("div");
      lab.className = "sb-group-label";
      lab.id = `sb-g-${key}`;
      lab.setAttribute("role", "presentation");
      lab.textContent = label;
      el.append(lab);
      g = { el, label: lab };
      groupEls.set(key, g);
    }
    return g;
  }

  /** Make `parent`'s children exactly `kids`, in order, moving as few nodes as possible. */
  function reconcile(parent: Element, kids: Element[]) {
    let cur = parent.firstElementChild;
    for (const k of kids) {
      if (cur === k) {
        cur = cur.nextElementSibling;
      } else {
        parent.insertBefore(k, cur);
      }
    }
    while (cur) {
      const next = cur.nextElementSibling;
      cur.remove();
      cur = next;
    }
  }

  // ---- render -------------------------------------------------------------------
  let loaded = false;
  const initialSnippets = store.state.snippets;

  function render(s: AppState) {
    if (renaming) {
      // Don't move nodes under an active inline rename; done() re-renders.
      return;
    }
    if (s.snippets !== initialSnippets) loaded = true;
    const q = query();
    const now = new Date();
    visible = s.snippets.filter((x) => {
      if (!q) return true;
      const t = (x.id === s.currentId ? s.title : x.title).toLowerCase();
      return t.includes(q) || x.language.toLowerCase().includes(q) || languageMeta(x.language).ext.toLowerCase() === q;
    });

    const buckets = new Map<GroupKey, SnippetMeta[]>();
    for (const sn of visible) {
      const k = groupOf(sn.updatedAt, now);
      if (!buckets.has(k)) buckets.set(k, []);
      buckets.get(k)!.push(sn);
    }
    // Keep display order = group order (the list arrives sorted by recency anyway).
    visible = GROUPS.flatMap((g) => buckets.get(g.key) ?? []);

    const seen = new Set<string>();
    const groupNodes: Element[] = [];
    for (const g of GROUPS) {
      const items = buckets.get(g.key);
      if (!items?.length) continue;
      const ge = groupEl(g.key, g.label);
      const kids: Element[] = [ge.label];
      for (const sn of items) {
        let row = rows.get(sn.id);
        if (!row) {
          row = makeRow(sn.id);
          rows.set(sn.id, row);
        }
        patchRow(row, sn, s, now);
        kids.push(row.el);
        seen.add(sn.id);
      }
      reconcile(ge.el, kids);
      groupNodes.push(ge.el);
    }
    reconcile(list, groupNodes);
    for (const [id] of rows) {
      if (!s.snippets.some((x) => x.id === id)) rows.delete(id);
    }

    // header count
    const total = s.snippets.length;
    count.textContent = q ? `${visible.length}/${total}` : total ? String(total) : "";

    // empty / no-match states
    if (!visible.length && (loaded || s.fatalError)) {
      showState(s, q);
    } else {
      stateBox.hidden = true;
      stateBox.replaceChildren();
    }
    list.hidden = !visible.length;
    list.tabIndex = visible.length ? 0 : -1;

    // keep the keyboard cursor on a visible row
    if (activeId && !seen.has(activeId)) activeId = null;
    if (!activeId) activeId = s.currentId && seen.has(s.currentId) ? s.currentId : (visible[0]?.id ?? null);
    paintActive();
  }

  function showState(s: AppState, q: string) {
    stateBox.hidden = false;
    const title = document.createElement("p");
    title.className = "sb-state-title";
    const sub = document.createElement("p");
    sub.className = "sb-state-sub";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn sb-state-btn";
    if (q) {
      title.textContent = `No results for “${search.value.trim()}”`;
      sub.textContent = "Search looks at snippet titles and languages.";
      btn.textContent = "Clear search";
      btn.addEventListener("click", () => {
        clearSearch();
        search.focus();
      });
    } else if (s.fatalError) {
      title.textContent = "Snippets unavailable";
      sub.textContent = "The snippet server can't be reached right now.";
      stateBox.replaceChildren(title, sub);
      return;
    } else {
      title.textContent = "No snippets yet";
      sub.textContent = "Create one, then paste the code you want to explain.";
      btn.append(icon("plus", 14), document.createTextNode("New snippet"));
      btn.addEventListener("click", () => actions.create());
    }
    stateBox.replaceChildren(title, sub, btn);
  }

  function paintActive() {
    for (const row of rows.values()) row.el.classList.toggle("is-active", row.id === activeId);
    if (activeId) list.setAttribute("aria-activedescendant", `sb-opt-${activeId}`);
    else list.removeAttribute("aria-activedescendant");
  }

  function setActive(id: string | null, scroll = true) {
    activeId = id;
    paintActive();
    if (scroll && id) rows.get(id)?.el.scrollIntoView({ block: "nearest" });
  }

  // ---- list interaction -------------------------------------------------------
  const rowFromEvent = (e: Event) => {
    const el = (e.target as Element).closest<HTMLElement>(".sb-row");
    return el ? (rows.get(el.dataset.id!) ?? null) : null;
  };

  list.addEventListener("mousedown", (e) => {
    // Keep focus where it is for clicks on rows (open() focuses the editor anyway),
    // but let the rename input take clicks normally.
    if ((e.target as Element).closest("input")) return;
    if (rowFromEvent(e)) e.preventDefault();
  });
  list.addEventListener("click", (e) => {
    const row = rowFromEvent(e);
    if (!row || (e.target as Element).closest("input")) return;
    if ((e.target as Element).closest(".sb-more")) {
      e.stopPropagation();
      setActive(row.id, false);
      showRowMenu(row);
      return;
    }
    if (e.detail > 1) return; // second click of a double-click
    setActive(row.id, false);
    actions.open(row.id);
  });
  list.addEventListener("dblclick", (e) => {
    const row = rowFromEvent(e);
    if (!row || (e.target as Element).closest(".sb-more, input")) return;
    if (store.state.currentId === row.id) startRename(row.id);
    else pendingRenameId = row.id; // starts once the open completes
  });
  list.addEventListener("contextmenu", (e) => {
    const row = rowFromEvent(e);
    if (!row || (e.target as Element).closest("input")) return;
    e.preventDefault();
    setActive(row.id, false);
    showRowMenu(row);
  });
  list.addEventListener("focus", () => {
    if (!activeId || !rows.has(activeId)) setActive(visible[0]?.id ?? null);
    else rows.get(activeId)?.el.scrollIntoView({ block: "nearest" });
  });

  list.addEventListener("keydown", (e) => {
    if (e.target !== list) return; // rename input handles its own keys
    const i = visible.findIndex((x) => x.id === activeId);
    const move = (to: number) => {
      e.preventDefault();
      const n = visible.length;
      if (!n) return;
      setActive(visible[Math.max(0, Math.min(n - 1, to))].id);
    };
    const mod = e.metaKey || e.ctrlKey;
    switch (e.key) {
      case "ArrowDown":
        return move(i + 1);
      case "ArrowUp":
        if (i <= 0) {
          e.preventDefault();
          search.focus();
          return;
        }
        return move(i - 1);
      case "Home":
        return move(0);
      case "End":
        return move(visible.length - 1);
      case "PageDown":
        return move(i + pageSize());
      case "PageUp":
        return move(i - pageSize());
      case "Enter":
      case " ":
        e.preventDefault();
        if (activeId) actions.open(activeId);
        return;
      case "F2":
        e.preventDefault();
        e.stopPropagation(); // the title bar has a global F2 for the current snippet
        if (activeId) startRename(activeId);
        return;
      case "Delete":
        e.preventDefault();
        if (activeId) void actions.requestDelete(activeId);
        return;
      case "Backspace":
        if (mod && activeId) {
          e.preventDefault();
          void actions.requestDelete(activeId);
        }
        return;
      case "ContextMenu":
        e.preventDefault();
        if (activeId && rows.get(activeId)) showRowMenu(rows.get(activeId)!);
        return;
      case "F10":
        if (e.shiftKey && activeId && rows.get(activeId)) {
          e.preventDefault();
          showRowMenu(rows.get(activeId)!);
        }
        return;
      case "Escape":
        e.preventDefault();
        e.stopPropagation();
        leaveToEditor();
        return;
    }
    // type-to-search: printable keys jump to the search field
    if (e.key.length === 1 && !mod && !e.altKey && e.key !== " ") {
      e.preventDefault();
      search.focus();
      search.value += e.key;
      search.dispatchEvent(new Event("input"));
    }
  });

  function pageSize() {
    const first = visible.length ? rows.get(visible[0].id)?.el : null;
    const h = first?.offsetHeight || 30;
    return Math.max(1, Math.floor(list.clientHeight / h) - 2);
  }

  // The ⋯ button never keeps focus itself; the listbox does (one tab stop).
  list.addEventListener("focusin", (e) => {
    if ((e.target as Element).classList?.contains("sb-more")) list.focus({ preventScroll: true });
  });

  function showRowMenu(row: Row) {
    const id = row.id;
    row.el.classList.add("has-menu");
    const back = (fn: () => void) => () => {
      list.focus({ preventScroll: true });
      fn();
    };
    const close = openMenu(row.more, [
      { label: "Rename", icon: "pencil", shortcut: "F2", run: () => startRename(id) },
      { label: "Duplicate", icon: "duplicate", run: back(() => actions.duplicate(id)) },
      { label: "Download", icon: "download", run: back(() => actions.download(id)) },
      "separator",
      { label: "Delete", icon: "trash", shortcut: IS_MAC ? "⌘⌫" : "Del", danger: true, run: back(() => void actions.requestDelete(id)) },
    ]);
    // Clear the "menu open" look when aria-expanded flips back.
    const mo = new MutationObserver(() => {
      if (row.more.getAttribute("aria-expanded") !== "true") {
        row.el.classList.remove("has-menu");
        mo.disconnect();
      }
    });
    mo.observe(row.more, { attributes: true, attributeFilter: ["aria-expanded"] });
    return close;
  }

  // ---- inline rename ----------------------------------------------------------
  function startRename(id: string) {
    const row = rows.get(id);
    if (!row) return;
    if (renaming) renaming.done(true);
    setActive(id);
    const sn = store.state.snippets.find((x) => x.id === id);
    const original = (id === store.state.currentId ? store.state.title : sn?.title) ?? "";
    const input = document.createElement("input");
    input.className = "sb-rename";
    input.value = original;
    input.spellcheck = false;
    input.autocomplete = "off";
    input.setAttribute("aria-label", "Rename snippet");
    row.title.replaceChildren(input);
    row.el.classList.add("is-renaming");
    input.focus();
    // select the name without its extension, like VS Code
    const dot = original.lastIndexOf(".");
    input.setSelectionRange(0, dot > 0 ? dot : original.length);

    let finished = false;
    const done = (commit: boolean) => {
      if (finished) return;
      finished = true;
      const next = input.value.trim();
      renaming = null;
      row.el.classList.remove("is-renaming");
      row.v.title = "\0"; // force repaint of the title
      const restoreFocus = document.activeElement === input;
      if (commit && next && next !== original) actions.rename(id, next);
      render(store.state);
      if (restoreFocus) list.focus({ preventScroll: true });
    };
    renaming = { id, input, done };
    input.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter") {
        e.preventDefault();
        done(true);
      } else if (e.key === "Escape") {
        e.preventDefault();
        done(false);
      }
    });
    input.addEventListener("blur", () => done(true));
    input.addEventListener("click", (e) => e.stopPropagation());
    input.addEventListener("dblclick", (e) => e.stopPropagation());
  }

  // ---- open / collapse / narrow drawer -------------------------------------------
  const scrim = document.createElement("div");
  scrim.className = "sb-scrim";
  scrim.hidden = true;
  scrim.addEventListener("mousedown", (e) => {
    e.preventDefault();
    actions.setSidebarOpen(false);
  });
  document.body.append(scrim);

  function applyOpen(open: boolean) {
    const hadFocus = root.contains(document.activeElement);
    root.hidden = !open;
    scrim.hidden = !(open && isNarrow());
    root.classList.toggle("is-drawer", isNarrow());
    if (!open && hadFocus) actions.focusEditor();
  }
  narrowMq.addEventListener("change", () => applyOpen(store.state.sidebarOpen));

  // ---- resize -------------------------------------------------------------------
  let width = readWidth();
  applyWidth(width);

  function applyWidth(w: number) {
    width = Math.round(Math.max(MIN_W, Math.min(MAX_W, w)));
    root.style.setProperty("--sb-w", `${width}px`);
    handle.setAttribute("aria-valuenow", String(width));
  }
  function saveWidth() {
    try {
      localStorage.setItem(WIDTH_KEY, String(width));
    } catch {
      /* storage unavailable */
    }
  }
  function readWidth(): number {
    try {
      const v = Number(localStorage.getItem(WIDTH_KEY));
      return Number.isFinite(v) && v >= MIN_W && v <= MAX_W ? v : DEFAULT_W;
    } catch {
      return DEFAULT_W;
    }
  }

  handle.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const startX = e.clientX;
    const startW = width;
    handle.setPointerCapture(e.pointerId);
    root.classList.add("is-resizing");
    // a full-page layer keeps the col-resize cursor and stops text selection
    const shield = document.createElement("div");
    shield.className = "sb-drag-shield";
    document.body.append(shield);
    const onMove = (ev: PointerEvent) => applyWidth(startW + ev.clientX - startX);
    const onUp = () => {
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onUp);
      handle.removeEventListener("pointercancel", onUp);
      root.classList.remove("is-resizing");
      shield.remove();
      saveWidth();
    };
    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp);
    handle.addEventListener("pointercancel", onUp);
  });
  handle.addEventListener("dblclick", () => {
    applyWidth(DEFAULT_W);
    saveWidth();
  });
  handle.addEventListener("keydown", (e) => {
    const step = e.shiftKey ? 32 : 8;
    if (e.key === "ArrowLeft") applyWidth(width - step);
    else if (e.key === "ArrowRight") applyWidth(width + step);
    else if (e.key === "Home") applyWidth(MIN_W);
    else if (e.key === "End") applyWidth(MAX_W);
    else if (e.key === "Enter") applyWidth(DEFAULT_W);
    else return;
    e.preventDefault();
    saveWidth();
  });

  // ---- global shortcuts owned by the sidebar ------------------------------------------
  window.addEventListener("keydown", (e) => {
    const mod = e.metaKey || e.ctrlKey;
    const k = e.key.toLowerCase();
    if (mod && !e.shiftKey && !e.altKey && k === "b") {
      e.preventDefault();
      actions.setSidebarOpen(!store.state.sidebarOpen);
    } else if (mod && !e.shiftKey && !e.altKey && k === "p") {
      e.preventDefault();
      focusSearch();
    } else if (e.altKey && !mod && e.code === "KeyN") {
      e.preventDefault();
      actions.create();
    } else if (e.key === "Escape" && !e.defaultPrevented && isNarrow() && store.state.sidebarOpen) {
      actions.setSidebarOpen(false);
      actions.focusEditor();
    }
  });
  uiEvents.on("focus-search", focusSearch);

  // ---- subscribe last: everything above must exist before the first render ----
  store.subscribe((s, prev) => {
    const first = s === prev;
    if (first || s.snippets !== prev.snippets || s.currentId !== prev.currentId || s.title !== prev.title || s.fatalError !== prev.fatalError) {
      render(s);
    }
    if (!first && s.currentId !== prev.currentId && s.currentId) {
      // follow the open snippet with the keyboard cursor, and keep it in view
      if (rows.has(s.currentId) && document.activeElement !== list) setActive(s.currentId, false);
      requestAnimationFrame(() => s.currentId && rows.get(s.currentId)?.el.scrollIntoView({ block: "nearest" }));
      if (pendingRenameId === s.currentId) {
        // main.ts focuses the editor right after this update; start renaming after it.
        const id = pendingRenameId;
        pendingRenameId = null;
        setTimeout(() => startRename(id), 0);
      }
    }
    if (first || s.sidebarOpen !== prev.sidebarOpen) applyOpen(s.sidebarOpen);
  });

  // relative times drift; refresh every minute (also re-buckets at midnight)
  window.setInterval(() => render(store.state), 60_000);
}

// ---- time helpers ---------------------------------------------------------------
function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function groupOf(iso: string, now: Date): GroupKey {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "earlier";
  const today = startOfDay(now);
  if (t >= today) return "today";
  if (t >= today - 86_400_000) return "yesterday";
  if (t >= today - 6 * 86_400_000) return "week";
  return "earlier";
}

function relTime(iso: string, now: Date): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const s = Math.max(0, (now.getTime() - t) / 1000);
  if (s < 60) return "now";
  const m = s / 60;
  if (m < 60) return `${Math.floor(m)}m`;
  const h = m / 60;
  if (h < 24) return `${Math.floor(h)}h`;
  const d = h / 24;
  if (d < 7) return `${Math.floor(d)}d`;
  if (d < 35) return `${Math.floor(d / 7)}w`;
  if (d < 365) return `${Math.floor(d / 30)}mo`;
  return `${Math.floor(d / 365)}y`;
}

const DATE_FMT = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
function fullDate(iso: string): string {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? "" : DATE_FMT.format(t);
}
