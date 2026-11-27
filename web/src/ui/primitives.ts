// Shared UI primitives: confirm dialog, toast, popover menu.
// Owned by the design-system agent. Styles in primitives.css.
import "./primitives.css";
import { icon, type IconName } from "./icons";

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

let uid = 0;

// ---- confirm dialog ---------------------------------------------------------
export interface ConfirmOptions {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

/**
 * Accessible modal confirm. Resolves true on confirm, false on cancel.
 * Enter confirms (unless Cancel has focus), Escape or a backdrop click
 * cancels, Tab is trapped inside, and focus returns where it was.
 */
export function confirmDialog(opts: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const id = `ui-dialog-${++uid}`;

    const backdrop = document.createElement("div");
    backdrop.className = "ui-backdrop";
    const dialog = document.createElement("div");
    dialog.className = "ui-dialog" + (opts.danger ? " ui-dialog-danger" : "");
    dialog.setAttribute("role", "alertdialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("aria-labelledby", `${id}-title`);

    const h = document.createElement("h2");
    h.id = `${id}-title`;
    h.className = "ui-dialog-title";
    h.textContent = opts.title;
    dialog.append(h);
    if (opts.message) {
      const p = document.createElement("p");
      p.id = `${id}-message`;
      p.className = "ui-dialog-message";
      p.textContent = opts.message;
      dialog.append(p);
      dialog.setAttribute("aria-describedby", p.id);
    }

    const actions = document.createElement("div");
    actions.className = "ui-dialog-actions";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "btn";
    cancel.textContent = opts.cancelLabel ?? "Cancel";
    cancel.dataset.testid = "confirm-cancel";
    const ok = document.createElement("button");
    ok.type = "button";
    ok.className = opts.danger ? "btn btn-danger" : "btn btn-primary";
    ok.textContent = opts.confirmLabel ?? "OK";
    ok.dataset.testid = "confirm-ok";
    actions.append(cancel, ok);
    dialog.append(actions);
    backdrop.append(dialog);

    // Make the rest of the page inert while the dialog is open.
    const inerted: HTMLElement[] = [];
    for (const el of Array.from(document.body.children) as HTMLElement[]) {
      if (el.inert || el.classList.contains("ui-toasts") || el.tagName === "SCRIPT") continue;
      el.inert = true;
      inerted.push(el);
    }
    document.body.append(backdrop);

    let done = false;
    const close = (result: boolean) => {
      if (done) return;
      done = true;
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("focusin", onFocusIn, true);
      for (const el of inerted) el.inert = false;
      backdrop.remove();
      previouslyFocused?.focus?.({ preventScroll: true });
      resolve(result);
    };
    const focusables = () => Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE));
    const onKey = (e: KeyboardEvent) => {
      // The dialog is modal: no app shortcuts while it is open.
      e.stopPropagation();
      if (e.key === "Escape") {
        e.preventDefault();
        close(false);
      } else if (e.key === "Enter" && !e.isComposing) {
        e.preventDefault();
        close(document.activeElement !== cancel);
      } else if (e.key === "Tab") {
        const items = focusables();
        if (!items.length) return;
        const i = items.indexOf(document.activeElement as HTMLElement);
        const next = e.shiftKey ? (i <= 0 ? items.length - 1 : i - 1) : i === items.length - 1 ? 0 : i + 1;
        e.preventDefault();
        items[next].focus();
      }
    };
    const onFocusIn = (e: FocusEvent) => {
      if (!dialog.contains(e.target as Node)) ok.focus();
    };
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("focusin", onFocusIn, true);
    cancel.addEventListener("click", () => close(false));
    ok.addEventListener("click", () => close(true));
    backdrop.addEventListener("mousedown", (e) => {
      if (e.target === backdrop) {
        e.preventDefault();
        close(false);
      }
    });
    ok.focus();
  });
}

// ---- toast ------------------------------------------------------------------
let toastHost: HTMLElement | null = null;
const MAX_TOASTS = 3;

/**
 * A small, self-dismissing notice at the bottom center, above the status bar.
 * "info" toasts confirm an action (check icon); "error" ones stay longer.
 */
export function toast(message: string, kind: "info" | "error" = "info") {
  if (!toastHost) {
    toastHost = document.createElement("div");
    toastHost.className = "ui-toasts";
    toastHost.setAttribute("role", "status");
    toastHost.setAttribute("aria-live", "polite");
    document.body.append(toastHost);
  }

  // Same message already showing (e.g. Copy clicked twice): refresh it.
  const existing = Array.from(toastHost.children).find(
    (el) => (el as HTMLElement).dataset.message === message && !el.classList.contains("leaving"),
  ) as (HTMLElement & { _restart?: () => void }) | undefined;
  if (existing?._restart) {
    existing._restart();
    return;
  }

  const el = document.createElement("div") as HTMLElement & { _restart?: () => void };
  el.className = `ui-toast ui-toast-${kind}`;
  el.dataset.testid = "toast";
  el.dataset.message = message;
  if (kind === "error") el.setAttribute("role", "alert");
  const text = document.createElement("span");
  text.className = "ui-toast-text";
  text.textContent = message;
  el.append(icon(kind === "error" ? "circle-alert" : "circle-check", 16), text);
  toastHost.append(el);

  while (toastHost.children.length > MAX_TOASTS) toastHost.firstElementChild?.remove();

  let timer = 0;
  const life = kind === "error" ? 4000 : 2000;
  const leave = () => {
    el.classList.add("leaving");
    window.setTimeout(() => el.remove(), 160);
  };
  el._restart = () => {
    window.clearTimeout(timer);
    el.classList.remove("bump");
    void el.offsetWidth; // restart the bump animation
    el.classList.add("bump");
    timer = window.setTimeout(leave, life);
  };
  timer = window.setTimeout(leave, life);
}

// ---- popover menu -----------------------------------------------------------
export interface MenuItem {
  label: string;
  icon?: IconName;
  shortcut?: string;
  danger?: boolean;
  disabled?: boolean;
  run: () => void;
}

let closeActiveMenu: (() => void) | null = null;

/**
 * Open a keyboard-navigable menu anchored below `anchor` (flips above it
 * when there's no room). ↑/↓, Home/End and type-to-jump move, Enter runs,
 * Escape closes and refocuses the anchor. Returns a function that closes it.
 */
export function openMenu(anchor: HTMLElement, items: (MenuItem | "separator")[]): () => void {
  closeActiveMenu?.();

  const menu = document.createElement("div");
  menu.className = "ui-menu";
  menu.setAttribute("role", "menu");
  menu.id = `ui-menu-${++uid}`;
  const buttons: HTMLButtonElement[] = [];
  const labels: string[] = [];
  for (const item of items) {
    if (item === "separator") {
      const sep = document.createElement("div");
      sep.className = "ui-menu-sep";
      sep.setAttribute("role", "separator");
      menu.append(sep);
      continue;
    }
    const b = document.createElement("button");
    b.type = "button";
    b.className = "ui-menu-item" + (item.danger ? " danger" : "");
    b.setAttribute("role", "menuitem");
    b.dataset.testid = "menu-item";
    b.tabIndex = -1;
    if (item.disabled) {
      b.disabled = true;
      b.setAttribute("aria-disabled", "true");
    }
    const ic = document.createElement("span");
    ic.className = "ui-menu-icon";
    if (item.icon) ic.append(icon(item.icon, 16));
    const label = document.createElement("span");
    label.className = "ui-menu-label";
    label.textContent = item.label;
    b.append(ic, label);
    if (item.shortcut) {
      const k = document.createElement("kbd");
      k.textContent = item.shortcut;
      b.append(k);
      b.setAttribute("aria-keyshortcuts", item.shortcut);
    }
    b.addEventListener("click", () => {
      close();
      anchor.focus({ preventScroll: true });
      item.run();
    });
    b.addEventListener("pointermove", () => {
      if (document.activeElement !== b && !b.disabled) focusAt(buttons.indexOf(b));
    });
    if (!item.disabled) {
      buttons.push(b);
      labels.push(item.label.toLowerCase());
    }
    menu.append(b);
  }
  document.body.append(menu);

  // Position: below the anchor, right edges aligned; flip up if it won't fit.
  const r = anchor.getBoundingClientRect();
  const mw = menu.offsetWidth;
  const mh = menu.offsetHeight;
  const gap = 4;
  const margin = 8;
  const below = window.innerHeight - r.bottom - gap - margin;
  const above = r.top - gap - margin;
  const up = mh > below && above > below;
  const top = up ? Math.max(margin, r.top - gap - mh) : r.bottom + gap;
  menu.style.top = `${Math.round(top)}px`;
  menu.style.left = `${Math.round(Math.max(margin, Math.min(r.right - mw, window.innerWidth - mw - margin)))}px`;
  menu.style.maxHeight = `${Math.max(120, up ? above : below)}px`;
  if (up) menu.classList.add("up");
  anchor.setAttribute("aria-expanded", "true");
  if (!anchor.hasAttribute("aria-haspopup")) anchor.setAttribute("aria-haspopup", "menu");
  anchor.setAttribute("aria-controls", menu.id);

  let index = -1;
  function focusAt(i: number) {
    if (!buttons.length) return;
    index = (i + buttons.length) % buttons.length;
    buttons[index].focus({ preventScroll: true });
    buttons[index].scrollIntoView({ block: "nearest" });
  }
  focusAt(0);

  let typed = "";
  let typedTimer = 0;
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close();
      anchor.focus({ preventScroll: true });
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      e.stopPropagation();
      focusAt(index + (e.key === "ArrowDown" ? 1 : -1));
    } else if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      e.stopPropagation();
      focusAt(e.key === "Home" ? 0 : buttons.length - 1);
    } else if (e.key === "Tab") {
      e.preventDefault();
      close();
      anchor.focus({ preventScroll: true });
    } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey && e.key !== " ") {
      // Type-to-jump: first item whose label starts with what was typed.
      e.preventDefault();
      e.stopPropagation();
      window.clearTimeout(typedTimer);
      typed += e.key.toLowerCase();
      typedTimer = window.setTimeout(() => (typed = ""), 600);
      // "d", "d", "d" cycles through items starting with d; "du" narrows.
      const repeat = [...typed].every((c) => c === typed[0]);
      const query = repeat ? typed[0] : typed;
      const start = repeat ? index + 1 : index;
      for (let k = 0; k < labels.length; k++) {
        const j = (start + k) % labels.length;
        if (labels[j].startsWith(query)) {
          focusAt(j);
          break;
        }
      }
    }
  };
  const onDown = (e: MouseEvent) => {
    const target = e.target as Node;
    if (!menu.contains(target) && target !== anchor && !anchor.contains(target)) close();
  };
  const onScroll = (e: Event) => {
    if (!menu.contains(e.target as Node)) close();
  };
  const onResize = () => close();
  document.addEventListener("keydown", onKey, true);
  document.addEventListener("mousedown", onDown, true);
  window.addEventListener("scroll", onScroll, true);
  window.addEventListener("resize", onResize);
  window.addEventListener("blur", onResize);

  let closed = false;
  function close() {
    if (closed) return;
    closed = true;
    if (closeActiveMenu === close) closeActiveMenu = null;
    window.clearTimeout(typedTimer);
    menu.remove();
    anchor.setAttribute("aria-expanded", "false");
    anchor.removeAttribute("aria-controls");
    document.removeEventListener("keydown", onKey, true);
    document.removeEventListener("mousedown", onDown, true);
    window.removeEventListener("scroll", onScroll, true);
    window.removeEventListener("resize", onResize);
    window.removeEventListener("blur", onResize);
  }
  closeActiveMenu = close;
  return close;
}
