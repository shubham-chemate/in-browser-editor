// Shared app state + the actions UI components may call.
// The app controller (main.ts) owns both; components only read state and
// call actions. See docs/ui-plan.md §7.

import type { SnippetMeta } from "./api";
import type { Theme } from "./theme";

export type SaveState = "saved" | "saving" | "unsaved" | "error";

export interface AppState {
  /** All snippets, most recently updated first. */
  snippets: SnippetMeta[];
  /** Open tabs (snippet ids) in display order. */
  tabs: string[];
  /** The active tab's snippet, or null when no tab is open. */
  currentId: string | null;
  /** Title of the current snippet (live while typing). */
  title: string;
  /** Language name of the current snippet, e.g. "Go" or "Plain text". */
  language: string;
  /** True if the current language gets syntax-error checking. */
  syntaxChecked: boolean;
  theme: Theme;
  sidebarOpen: boolean;
  saveState: SaveState;
  /** Number of syntax errors in the current snippet. */
  errors: number;
  cursor: { line: number; col: number; selected: number };
  /** Indentation unit: "Spaces: 4", "Spaces: 2" or "Tab". */
  indent: string;
  /** Set when the server can't be reached at boot, etc. */
  fatalError: string | null;
}

export interface AppActions {
  /** Activate a snippet's tab, opening a new tab (after the active one) if needed. */
  open(id: string): void;
  /** Close one or more tabs (doesn't delete anything). */
  closeTabs(ids: string[]): void;
  /** Move a tab to a new position in the tab strip. */
  moveTab(id: string, index: number): void;
  /** Create a new empty snippet and focus its title for naming. */
  create(): void;
  /** Ask for confirmation (confirmDialog), then delete. Use this from UI. */
  requestDelete(id: string): Promise<void>;
  /** Delete immediately, no confirmation. */
  remove(id: string): Promise<void>;
  rename(id: string, title: string): void;
  duplicate(id: string): void;
  /** Download a snippet as a file (e.g. "server.go"). */
  download(id: string): void;
  setLanguage(name: string): void;
  /** Ask the title bar to open the language quick-pick (e.g. from the status bar). */
  openLanguagePicker(): void;
  /** Start editing the current title (F2 / menu "Rename"). */
  startRename(): void;
  toggleTheme(): void;
  setSidebarOpen(open: boolean): void;
  copyCode(): Promise<void>;
  focusEditor(): void;
  saveNow(): void;
  nextError(): void;
  gotoLine(): void;
}

type Listener<T> = (state: T, prev: T) => void;

export class Store<T extends object> {
  private listeners = new Set<Listener<T>>();
  constructor(private current: T) {}

  get state(): T {
    return this.current;
  }

  set(patch: Partial<T>) {
    const prev = this.current;
    let changed = false;
    for (const k in patch) {
      if (!Object.is(patch[k], prev[k])) {
        changed = true;
        break;
      }
    }
    if (!changed) return;
    this.current = { ...prev, ...patch };
    for (const l of this.listeners) l(this.current, prev);
  }

  /** Calls `fn` now and on every change. Returns an unsubscribe function. */
  subscribe(fn: Listener<T>): () => void {
    this.listeners.add(fn);
    fn(this.current, this.current);
    return () => this.listeners.delete(fn);
  }
}

/**
 * A tiny event hub for one-off UI requests that aren't state
 * (e.g. "open the language picker", "start renaming").
 */
export type UiEvent = "open-language-picker" | "start-rename" | "focus-search";
const uiListeners = new Map<UiEvent, Set<() => void>>();
export const uiEvents = {
  on(ev: UiEvent, fn: () => void) {
    if (!uiListeners.has(ev)) uiListeners.set(ev, new Set());
    uiListeners.get(ev)!.add(fn);
    return () => uiListeners.get(ev)!.delete(fn);
  },
  emit(ev: UiEvent) {
    uiListeners.get(ev)?.forEach((fn) => fn());
  },
};
