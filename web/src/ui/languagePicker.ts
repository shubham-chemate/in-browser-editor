// Language quick-pick (VS Code "Select Language Mode" style).
// A combobox (search input) driving a grouped listbox, in a popover on
// document.body. See docs/ui-plan.md §4.2. Popover classes are prefixed `lp-`.
import "./languagePicker.css";
import { FEATURED, MORE, PLAIN_TEXT, isSyntaxChecked } from "../languages";
import { iconSvg } from "./icons";
import { languageMeta } from "./languageMeta";

export interface LanguagePickerOptions {
  /** Element the popover is positioned against. */
  anchor: HTMLElement;
  /** "below": under the anchor, right-aligned (title bar pill).
   *  "above": over the anchor, right-aligned (status bar). */
  placement?: "below" | "above";
  current: string;
  onPick: (name: string) => void;
  /** Called after the popover closes (any reason). `picked` is true on selection. */
  onClose?: (picked: boolean) => void;
  /** Shortcut hint shown in the footer, e.g. "⌘K M". */
  shortcut?: string;
}

interface Entry {
  name: string;
  ext: string;
  badge: string;
  color: string;
  checked: boolean;
}

const GROUPS: { label: string; names: string[] }[] = [
  { label: "Your languages", names: FEATURED },
  { label: "More", names: [...MORE, PLAIN_TEXT] },
];

const MARGIN = 8; // min distance from the viewport edge
const GAP = 4; // distance from the anchor

let active: { close: (picked?: boolean) => void; anchor: HTMLElement } | null = null;
let uid = 0;

export function isLanguagePickerOpen(): boolean {
  return active !== null;
}

export function closeLanguagePicker() {
  active?.close();
}

/** Language badge element (shared with the title bar pill). */
export function languageBadge(name: string): HTMLSpanElement {
  const meta = languageMeta(name);
  const b = document.createElement("span");
  b.className = "lp-badge";
  b.textContent = meta.badge;
  b.style.setProperty("--lang", meta.color);
  b.setAttribute("aria-hidden", "true");
  return b;
}

function entry(name: string): Entry {
  const meta = languageMeta(name);
  return { name, ext: meta.ext, badge: meta.badge, color: meta.color, checked: name === "JSON" || isSyntaxChecked(name) };
}

/** Open the picker. Returns a close function. Opening again while open closes the old one. */
export function openLanguagePicker(opts: LanguagePickerOptions): () => void {
  active?.close();
  const { anchor, current } = opts;
  const id = `lp-${++uid}`;
  const restoreFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;

  const pop = document.createElement("div");
  pop.className = "lp-pop";
  pop.setAttribute("role", "dialog");
  pop.setAttribute("aria-label", "Select language");

  const field = document.createElement("div");
  field.className = "lp-field";
  field.innerHTML = iconSvg("search", 14);
  const input = document.createElement("input");
  input.className = "lp-input";
  input.type = "text";
  input.dataset.testid = "language-search";
  input.placeholder = "Select language…";
  input.spellcheck = false;
  input.autocomplete = "off";
  input.setAttribute("role", "combobox");
  input.setAttribute("aria-label", "Search languages");
  input.setAttribute("aria-autocomplete", "list");
  input.setAttribute("aria-expanded", "true");
  input.setAttribute("aria-controls", `${id}-list`);
  field.append(input);

  const list = document.createElement("div");
  list.className = "lp-list";
  list.id = `${id}-list`;
  list.setAttribute("role", "listbox");
  list.setAttribute("aria-label", "Languages");

  const footer = document.createElement("div");
  footer.className = "lp-footer";
  footer.setAttribute("aria-hidden", "true");
  footer.innerHTML =
    `<span><kbd>↑</kbd><kbd>↓</kbd> navigate</span><span><kbd>↵</kbd> select</span><span><kbd>esc</kbd> close</span>` +
    (opts.shortcut ? `<span class="lp-footer-hint">${opts.shortcut}</span>` : "");

  pop.append(field, list, footer);
  document.body.append(pop);

  // ---- rendering ----------------------------------------------------------
  let options: HTMLElement[] = [];
  let index = 0;

  function render(query: string) {
    const q = query.trim().toLowerCase();
    list.textContent = "";
    options = [];
    for (const [gi, group] of GROUPS.entries()) {
      const matches = group.names.map(entry).filter((e) => !q || matchesQuery(e, q));
      if (!matches.length) continue;
      const g = document.createElement("div");
      g.className = "lp-group";
      g.setAttribute("role", "group");
      const label = document.createElement("div");
      label.className = "lp-group-label";
      label.id = `${id}-g${gi}`;
      label.textContent = group.label;
      g.setAttribute("aria-labelledby", label.id);
      g.append(label);
      for (const e of matches) g.append(row(e, q));
      list.append(g);
    }
    if (!options.length) {
      const empty = document.createElement("div");
      empty.className = "lp-empty";
      empty.setAttribute("role", "status");
      const strong = document.createElement("span");
      strong.className = "lp-empty-title";
      strong.textContent = `No languages match “${query.trim()}”`;
      const hint = document.createElement("span");
      hint.className = "lp-empty-hint";
      hint.textContent = "Try a language name or a file extension";
      empty.append(strong, hint);
      list.append(empty);
    }
    const cur = options.findIndex((o) => o.dataset.value === current);
    setActive(q ? 0 : Math.max(0, cur), "center");
  }

  function row(e: Entry, q: string): HTMLElement {
    const o = document.createElement("div");
    o.className = "lp-option";
    o.id = `${id}-o${options.length}`;
    o.setAttribute("role", "option");
    o.setAttribute("aria-selected", "false");
    o.dataset.testid = "language-option";
    o.dataset.value = e.name;
    if (e.name === current) {
      o.classList.add("is-current");
      o.setAttribute("aria-current", "true");
    }

    const badge = languageBadge(e.name);
    const name = document.createElement("span");
    name.className = "lp-name";
    highlight(name, e.name, q);
    const tag = document.createElement("span");
    tag.className = "lp-tag";
    tag.textContent = e.checked ? "syntax check" : "highlight only";
    const check = document.createElement("span");
    check.className = "lp-check";
    if (e.name === current) check.innerHTML = iconSvg("check", 14);
    o.append(badge, name, tag, check);
    o.setAttribute("aria-label", `${e.name}, ${tag.textContent}${e.name === current ? ", current" : ""}`);

    const i = options.length;
    o.addEventListener("mousemove", () => {
      if (index !== i) setActive(i, null);
    });
    o.addEventListener("mousedown", (ev) => ev.preventDefault()); // keep focus in the input
    o.addEventListener("click", () => pick(i));
    options.push(o);
    return o;
  }

  function setActive(i: number, scroll: ScrollLogicalPosition | null = "nearest") {
    options[index]?.setAttribute("aria-selected", "false");
    index = i;
    const o = options[i];
    if (!o) {
      input.removeAttribute("aria-activedescendant");
      return;
    }
    o.setAttribute("aria-selected", "true");
    input.setAttribute("aria-activedescendant", o.id);
    if (scroll) scrollIntoView(o, scroll);
  }

  function scrollIntoView(o: HTMLElement, mode: ScrollLogicalPosition) {
    // Keep the row clear of the sticky group label.
    const label = o.parentElement?.querySelector<HTMLElement>(".lp-group-label");
    const top = o.offsetTop - list.offsetTop - (label?.offsetHeight ?? 0);
    const bottom = o.offsetTop - list.offsetTop + o.offsetHeight;
    if (mode === "center") {
      list.scrollTop = Math.max(0, top - (list.clientHeight - o.offsetHeight) / 2 + (label?.offsetHeight ?? 0) / 2);
    } else if (top < list.scrollTop) {
      list.scrollTop = o === options[0] ? 0 : top;
    } else if (bottom > list.scrollTop + list.clientHeight) {
      list.scrollTop = bottom - list.clientHeight + 4;
    }
  }

  function pick(i: number) {
    const o = options[i];
    if (!o) return;
    const name = o.dataset.value!;
    close(true);
    if (name !== current) opts.onPick(name);
  }

  // ---- positioning --------------------------------------------------------
  function position() {
    const r = anchor.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    const vh = window.innerHeight;
    const width = vw <= 480 ? vw - MARGIN * 2 : 320; // full-width sheet on phones
    pop.style.width = `${width}px`;
    const left = Math.round(Math.max(MARGIN, Math.min(r.right - width, vw - width - MARGIN)));
    pop.style.left = `${left}px`;
    const chrome = field.offsetHeight + footer.offsetHeight + 2;
    if (opts.placement === "above") {
      const avail = r.top - GAP - MARGIN;
      list.style.maxHeight = `${Math.max(120, Math.min(360, avail - chrome))}px`;
      pop.style.top = "";
      pop.style.bottom = `${Math.round(vh - r.top + GAP)}px`;
      pop.dataset.placement = "above";
    } else {
      const top = r.bottom + GAP;
      const avail = vh - top - MARGIN;
      list.style.maxHeight = `${Math.max(120, Math.min(360, avail - chrome))}px`;
      pop.style.bottom = "";
      pop.style.top = `${Math.round(top)}px`;
      pop.dataset.placement = "below";
    }
  }

  // ---- events -------------------------------------------------------------
  const onKey = (e: KeyboardEvent) => {
    if (e.isComposing) return;
    const n = options.length;
    switch (e.key) {
      case "ArrowDown":
      case "ArrowUp":
        e.preventDefault();
        if (n) setActive((index + (e.key === "ArrowDown" ? 1 : -1) + n) % n);
        break;
      case "PageDown":
      case "PageUp":
        e.preventDefault();
        if (n) setActive(Math.max(0, Math.min(n - 1, index + (e.key === "PageDown" ? 8 : -8))));
        break;
      case "Enter":
        e.preventDefault();
        pick(index);
        break;
      case "Escape":
        e.preventDefault();
        e.stopPropagation();
        close();
        break;
      case "Tab":
        e.preventDefault();
        if (n) setActive((index + (e.shiftKey ? -1 : 1) + n) % n);
        break;
    }
  };
  const onDown = (e: MouseEvent) => {
    const t = e.target as Node;
    if (pop.contains(t) || anchor.contains(t)) return;
    close(false, false);
  };
  const onResize = () => close(false, false);

  input.addEventListener("keydown", onKey);
  input.addEventListener("input", () => render(input.value));
  document.addEventListener("mousedown", onDown, true);
  window.addEventListener("resize", onResize);

  render("");
  position();
  setActive(index, "center"); // list height is known now
  anchor.setAttribute("aria-expanded", "true");
  requestAnimationFrame(() => pop.classList.add("is-open"));
  input.focus();

  let closed = false;
  function close(picked = false, refocus = true) {
    if (closed) return;
    closed = true;
    active = null;
    pop.remove();
    anchor.setAttribute("aria-expanded", "false");
    document.removeEventListener("mousedown", onDown, true);
    window.removeEventListener("resize", onResize);
    if (refocus && !picked && restoreFocus?.isConnected) restoreFocus.focus();
    opts.onClose?.(picked);
  }
  active = { close: (picked?: boolean) => close(picked), anchor };
  return () => close();
}

function matchesQuery(e: Entry, q: string): boolean {
  const ext = e.ext.toLowerCase();
  const qq = q.replace(/^\./, "");
  return e.name.toLowerCase().includes(q) || ext.includes(qq) || e.badge.toLowerCase() === qq;
}

/** Render `text` into `el`, wrapping the first match of `q` in a highlight. */
function highlight(el: HTMLElement, text: string, q: string) {
  const i = q ? text.toLowerCase().indexOf(q) : -1;
  if (i < 0) {
    el.textContent = text;
    return;
  }
  const m = document.createElement("span");
  m.className = "lp-match";
  m.textContent = text.slice(i, i + q.length);
  el.append(text.slice(0, i), m, text.slice(i + q.length));
}
