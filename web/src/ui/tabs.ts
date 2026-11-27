// Tab strip (VS Code style): open snippets, active tab, drag to reorder.
// - click: activate · middle-click / ×: close · right-click: menu
// - drag (mouse, pen or touch): reorder, neighbours slide out of the way
// - keyboard: ←/→/Home/End move focus, Enter/Space activate, Delete closes,
//   Alt+Shift+←/→ moves the focused tab
// - double-click a tab (or F2): rename inline · double-click empty space: new snippet
import "./tabs.css";
import type { AppActions, AppState, Store } from "../state";
import { uiEvents } from "../state";
import { dropIndex, tabsRightOf } from "../tabsModel";
import { iconSvg } from "./icons";
import { languageMeta } from "./languageMeta";
import { openMenu } from "./primitives";

const DRAG_THRESHOLD_PX = 5;
const EDGE_SCROLL_PX = 32;

interface TabEl {
  el: HTMLElement;
  badge: HTMLElement;
  title: HTMLElement;
}

interface DragState {
  id: string;
  el: HTMLElement;
  pointerId: number;
  startX: number;
  startScroll: number;
  /** Dragged tab's left edge (strip content coordinates) when the drag started. */
  origin: number;
  width: number;
  /** The other tabs, in order, with their layout at drag start. */
  others: { id: string; el: HTMLElement; left: number; width: number }[];
  /** Where the tab would land if dropped now. */
  index: number;
  raf: number;
  lastX: number;
}

export function mountTabs(root: HTMLElement, store: Store<AppState>, actions: AppActions) {
  root.classList.add("tabs");
  const strip = document.createElement("div");
  strip.className = "tabs-strip";
  strip.setAttribute("role", "tablist");
  strip.setAttribute("aria-label", "Open snippets");
  root.append(strip);

  const els = new Map<string, TabEl>();
  let focusId: string | null = null; // roving tabindex target
  let suppressClick = false; // swallow the click that ends a drag
  let dragging: DragState | null = null;
  let pending: { id: string; el: HTMLElement; pointerId: number; startX: number } | null = null;

  // ---- rendering ------------------------------------------------------------
  function create(id: string): TabEl {
    const el = document.createElement("div");
    el.className = "tab";
    el.dataset.id = id;
    el.dataset.testid = "tab";
    el.setAttribute("role", "tab");
    const badge = document.createElement("span");
    badge.className = "tab-badge";
    badge.setAttribute("aria-hidden", "true");
    const title = document.createElement("span");
    title.className = "tab-title";
    const close = document.createElement("button");
    close.type = "button";
    close.className = "tab-close";
    close.tabIndex = -1;
    close.dataset.testid = "tab-close";
    close.setAttribute("aria-label", "Close tab");
    close.title = "Close";
    close.innerHTML = `<span class="tab-dot" aria-hidden="true"></span>${iconSvg("x", 14)}`;
    close.addEventListener("click", (e) => {
      e.stopPropagation();
      actions.closeTabs([id]);
    });
    close.addEventListener("pointerdown", (e) => e.stopPropagation()); // no drag from ×
    el.append(badge, title, close);

    el.addEventListener("click", () => {
      if (suppressClick) return;
      actions.open(id);
    });
    el.addEventListener("auxclick", (e) => {
      if (e.button === 1) {
        e.preventDefault();
        actions.closeTabs([id]);
      }
    });
    el.addEventListener("mousedown", (e) => {
      if (e.button === 1) e.preventDefault(); // no autoscroll cursor on middle-click
    });
    el.addEventListener("dblclick", (e) => {
      if ((e.target as HTMLElement).closest(".tab-close")) return;
      startRename(id);
    });
    el.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      showMenu(id, el);
    });
    el.addEventListener("pointerdown", (e) => startDrag(e, id));
    el.addEventListener("focus", () => (focusId = id));
    return { el, badge, title };
  }

  function render(s: AppState) {
    const metas = new Map(s.snippets.map((x) => [x.id, x]));
    const ids = s.tabs.filter((id) => metas.has(id));
    // drop closed tabs
    for (const [id, t] of els) {
      if (!ids.includes(id)) {
        t.el.remove();
        els.delete(id);
      }
    }
    // create / update / order
    let prev: Element | null = null;
    for (const id of ids) {
      let t = els.get(id);
      if (!t) {
        t = create(id);
        els.set(id, t);
      }
      const meta = metas.get(id)!;
      const isActive = id === s.currentId;
      const title = (isActive ? s.title : meta.title) || "Untitled";
      const lang = isActive ? s.language : meta.language;
      const lm = languageMeta(lang);
      if (t.title.textContent !== title) t.title.textContent = title;
      t.title.classList.toggle("is-untitled", !(isActive ? s.title : meta.title));
      if (t.badge.textContent !== lm.badge) t.badge.textContent = lm.badge;
      t.badge.style.setProperty("--badge", lm.color);
      t.el.title = `${title} · ${lang}`;
      t.el.setAttribute("aria-selected", String(isActive));
      t.el.classList.toggle("is-dirty", isActive && (s.saveState === "unsaved" || s.saveState === "saving"));
      t.el.tabIndex = id === (focusId && ids.includes(focusId) ? focusId : (s.currentId ?? ids[0])) ? 0 : -1;
      const want: Element | null = prev ? prev.nextElementSibling : strip.firstElementChild;
      if (want !== t.el) strip.insertBefore(t.el, want);
      prev = t.el;
    }
  }

  // ---- inline rename --------------------------------------------------------------
  // The tab label turns into an input. Renames apply live (like the old title
  // field); Enter/blur keeps it, Escape restores the original.
  let renaming: { id: string; input: HTMLInputElement; original: string; done: (keep: boolean) => void } | null = null;

  function startRename(id: string) {
    renaming?.done(true);
    const t = els.get(id);
    if (!t) return;
    const s = store.state;
    const original = id === s.currentId ? s.title : (s.snippets.find((x) => x.id === id)?.title ?? "");
    const input = document.createElement("input");
    input.className = "tab-rename";
    input.type = "text";
    input.value = original;
    input.placeholder = "Untitled";
    input.spellcheck = false;
    input.autocomplete = "off";
    input.dataset.testid = "title-input";
    input.setAttribute("aria-label", "Snippet title");
    const fit = () => (input.style.width = `${Math.max(input.value.length, input.placeholder.length) + 2}ch`);
    fit();
    t.title.hidden = true;
    t.title.after(input);

    let finished = false;
    const done = (keep: boolean) => {
      if (finished) return;
      finished = true;
      if (!keep && input.value !== original) actions.rename(id, original);
      input.remove();
      t.title.hidden = false;
      if (renaming?.input === input) renaming = null;
    };
    renaming = { id, input, original, done };

    input.addEventListener("input", () => {
      fit();
      actions.rename(id, input.value);
    });
    input.addEventListener("keydown", (e) => {
      e.stopPropagation(); // keep arrows/Delete/Space away from the tab strip
      if (e.isComposing) return;
      if (e.key === "Enter" || e.key === "Escape") {
        e.preventDefault();
        done(e.key === "Enter");
        actions.focusEditor();
      }
    });
    input.addEventListener("blur", () => done(true));
    for (const ev of ["pointerdown", "click", "dblclick", "auxclick", "contextmenu"]) {
      input.addEventListener(ev, (e) => e.stopPropagation());
    }
    t.el.scrollIntoView({ block: "nearest", inline: "nearest" });
    input.focus();
    input.select();
  }

  uiEvents.on("start-rename", () => {
    const id = store.state.currentId;
    if (id) startRename(id);
  });

  function revealActive(s: AppState) {
    const t = s.currentId ? els.get(s.currentId) : null;
    if (!t) return;
    requestAnimationFrame(() => t.el.scrollIntoView({ block: "nearest", inline: "nearest" }));
  }

  store.subscribe((s, prev) => {
    const first = s === prev;
    if (
      first || s.tabs !== prev.tabs || s.snippets !== prev.snippets || s.currentId !== prev.currentId ||
      s.title !== prev.title || s.language !== prev.language || s.saveState !== prev.saveState
    ) {
      if (!dragging) render(s);
    }
    if (first || s.currentId !== prev.currentId || s.tabs !== prev.tabs) revealActive(s);
  });

  // ---- context menu -----------------------------------------------------------
  function showMenu(id: string, anchor: HTMLElement) {
    const tabs = store.state.tabs;
    const right = tabsRightOf(tabs, id);
    openMenu(anchor, [
      { label: "Close", icon: "x", run: () => actions.closeTabs([id]) },
      { label: "Close others", disabled: tabs.length < 2, run: () => actions.closeTabs(tabs.filter((t) => t !== id)) },
      { label: "Close to the right", disabled: !right.length, run: () => actions.closeTabs(right) },
      { label: "Close all", run: () => actions.closeTabs([...tabs]) },
      "separator",
      { label: "Rename", icon: "pencil", shortcut: "F2", run: () => startRename(id) },
      { label: "Duplicate", icon: "duplicate", run: () => actions.duplicate(id) },
      { label: "Download", icon: "download", run: () => actions.download(id) },
    ]);
  }

  // ---- drag to reorder ---------------------------------------------------------
  function startDrag(e: PointerEvent, id: string) {
    if (e.button !== 0 || !e.isPrimary) return;
    const t = els.get(id);
    if (!t) return;
    pending = { id, el: t.el, pointerId: e.pointerId, startX: e.clientX };
  }

  window.addEventListener("pointermove", (e) => {
    if (pending && e.pointerId === pending.pointerId && Math.abs(e.clientX - pending.startX) > DRAG_THRESHOLD_PX) {
      beginDrag(pending, e);
      pending = null;
    }
    if (dragging && e.pointerId === dragging.pointerId) {
      dragging.lastX = e.clientX;
      layoutDrag();
    }
  });
  window.addEventListener("pointerup", (e) => endDrag(e, false));
  window.addEventListener("pointercancel", (e) => endDrag(e, true));

  function beginDrag(p: { id: string; el: HTMLElement; pointerId: number; startX: number }, e: PointerEvent) {
    const order = store.state.tabs.filter((id) => els.has(id));
    const others = order
      .filter((id) => id !== p.id)
      .map((id) => {
        const el = els.get(id)!.el;
        return { id, el, left: el.offsetLeft, width: el.offsetWidth };
      });
    dragging = {
      id: p.id,
      el: p.el,
      pointerId: p.pointerId,
      startX: p.startX,
      startScroll: strip.scrollLeft,
      origin: p.el.offsetLeft,
      width: p.el.offsetWidth,
      others,
      index: order.indexOf(p.id),
      raf: 0,
      lastX: e.clientX,
    };
    try {
      p.el.setPointerCapture(p.pointerId);
    } catch {
      /* ignore */
    }
    root.classList.add("is-dragging");
    p.el.classList.add("is-dragged");
    autoScroll();
  }

  /** Position the dragged tab under the pointer and slide the others aside. */
  function layoutDrag() {
    const d = dragging;
    if (!d) return;
    const scrollDelta = strip.scrollLeft - d.startScroll;
    const maxLeft = strip.scrollWidth - d.width;
    const left = Math.max(0, Math.min(d.origin + (d.lastX - d.startX) + scrollDelta, maxLeft));
    d.el.style.transform = `translateX(${left - d.origin}px)`;

    // "Others" laid out without the dragged tab, then find the gap.
    let x = 0;
    const packed = d.others.map((o) => {
      const r = { left: x, width: o.width };
      x += o.width;
      return r;
    });
    d.index = dropIndex(packed, left + d.width / 2);
    // Each other tab: where it sits now vs. where it goes with a gap at d.index.
    d.others.forEach((o, i) => {
      const target = packed[i].left + (i >= d.index ? d.width : 0);
      o.el.style.transform = `translateX(${target - o.left}px)`;
    });
  }

  /** Keep scrolling while the pointer is near the strip's edges. */
  function autoScroll() {
    const d = dragging;
    if (!d) return;
    const r = strip.getBoundingClientRect();
    let dx = 0;
    if (d.lastX < r.left + EDGE_SCROLL_PX) dx = -8;
    else if (d.lastX > r.right - EDGE_SCROLL_PX) dx = 8;
    if (dx) {
      strip.scrollLeft += dx;
      layoutDrag();
    }
    d.raf = requestAnimationFrame(autoScroll);
  }

  function endDrag(e: PointerEvent, cancelled: boolean) {
    if (pending && e.pointerId === pending.pointerId) pending = null;
    const d = dragging;
    if (!d || e.pointerId !== d.pointerId) return;
    cancelAnimationFrame(d.raf);
    dragging = null;
    root.classList.remove("is-dragging");
    d.el.classList.remove("is-dragged");
    for (const t of els.values()) t.el.style.transform = "";
    // The click event fires right after pointerup; don't treat the drop as a click.
    suppressClick = true;
    setTimeout(() => (suppressClick = false), 0);
    if (!cancelled) actions.moveTab(d.id, d.index);
    render(store.state);
  }

  // ---- keyboard -----------------------------------------------------------------
  strip.addEventListener("keydown", (e) => {
    const tabEl = (e.target as HTMLElement).closest<HTMLElement>(".tab");
    if (!tabEl) return;
    const id = tabEl.dataset.id!;
    const order = store.state.tabs.filter((t) => els.has(t));
    const i = order.indexOf(id);
    const focusAt = (j: number) => {
      const target = order[(j + order.length) % order.length];
      focusId = target;
      render(store.state);
      els.get(target)?.el.focus();
    };
    if (e.altKey && e.shiftKey && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
      e.preventDefault();
      actions.moveTab(id, i + (e.key === "ArrowLeft" ? -1 : 1));
      requestAnimationFrame(() => els.get(id)?.el.focus());
      return;
    }
    switch (e.key) {
      case "ArrowLeft":
        e.preventDefault();
        focusAt(i - 1);
        break;
      case "ArrowRight":
        e.preventDefault();
        focusAt(i + 1);
        break;
      case "Home":
        e.preventDefault();
        focusAt(0);
        break;
      case "End":
        e.preventDefault();
        focusAt(order.length - 1);
        break;
      case "Enter":
      case " ":
        e.preventDefault();
        actions.open(id);
        break;
      case "Delete":
        e.preventDefault();
        actions.closeTabs([id]);
        break;
      case "ContextMenu":
        e.preventDefault();
        showMenu(id, tabEl);
        break;
      case "F10":
        if (e.shiftKey) {
          e.preventDefault();
          showMenu(id, tabEl);
        }
        break;
    }
  });

  // ---- strip: wheel scrolls sideways, double-click empty space = new snippet ----
  strip.addEventListener(
    "wheel",
    (e) => {
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX) && strip.scrollWidth > strip.clientWidth) {
        e.preventDefault();
        strip.scrollLeft += e.deltaY;
      }
    },
    { passive: false },
  );
  strip.addEventListener("dblclick", (e) => {
    if (e.target === strip) actions.create();
  });
}
