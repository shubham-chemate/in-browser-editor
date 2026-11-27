// Status bar: problems, check mode, save state, cursor, indent, language.
// See docs/ui-plan.md §4.3. Each segment re-renders only when its own slice of
// state changes (the store fires on every cursor move).
import "./statusbar.css";
import type { AppActions, AppState, SaveState, Store } from "../state";
import { iconSvg } from "./icons";
import { languageMeta } from "./languageMeta";

/** Don't show "Saving…" for saves faster than this (keep the previous label). */
const SAVING_DELAY_MS = 300;
/** Once "Saving…" is visible, keep it at least this long so it never flashes. */
const SAVING_MIN_MS = 500;

const SAVE_VIEW: Record<SaveState, { icon: string; label: string; tip: string }> = {
  saved: { icon: iconSvg("check", 14), label: "Saved", tip: "All changes saved" },
  unsaved: { icon: '<span class="st-dot-warn"></span>', label: "Unsaved", tip: "Unsaved changes, saving automatically · Ctrl/Cmd+S to save now" },
  saving: { icon: iconSvg("refresh", 14), label: "Saving…", tip: "Saving changes…" },
  error: { icon: iconSvg("alert-triangle", 14), label: "Offline – retrying", tip: "Can't reach the server. Your changes are kept and retried automatically · Click to retry now" },
};

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export function mountStatusbar(root: HTMLElement, store: Store<AppState>, actions: AppActions) {
  root.classList.add("statusbar");
  root.setAttribute("aria-label", "Status bar");
  root.innerHTML = `
    <div class="st-group st-left">
      <button type="button" class="st-item st-fatal" data-testid="fatal" hidden>
        ${iconSvg("cloud-off", 14)}<span class="st-label">Disconnected</span>
      </button>
      <button type="button" class="st-item st-problems" data-testid="problems">
        ${iconSvg("circle-x", 14)}<span class="st-count"></span>
      </button>
      <span class="st-item st-check" data-testid="check-mode">
        <span class="st-ico"></span><span class="st-label"></span>
      </span>
    </div>
    <div class="st-group st-right">
      <button type="button" class="st-item st-save" data-testid="save-state">
        <span class="st-ico"></span><span class="st-label"></span>
      </button>
      <button type="button" class="st-item st-cursor" data-testid="cursor-pos" title="Go to line (Ctrl/Cmd+Alt+G)">
        <span class="st-cursor-text"><span class="st-long"><span></span><span class="st-sel"></span></span><span class="st-short"><span></span><span class="st-sel"></span></span></span>
      </button>
      <span class="st-item st-indent" data-testid="indent" title="Indentation"></span>
      <button type="button" class="st-item st-lang" data-testid="status-language">
        <span class="st-lang-dot"></span><span class="st-label"></span>
      </button>
    </div>
  `;
  const $ = (id: string) => root.querySelector<HTMLElement>(`[data-testid=${id}]`)!;
  const fatal = $("fatal");
  const problems = $("problems");
  const problemsCount = problems.querySelector<HTMLElement>(".st-count")!;
  const check = $("check-mode");
  const save = $("save-state");
  const cursor = $("cursor-pos");
  const [posLong, selLong] = cursor.querySelectorAll<HTMLElement>(".st-long > span");
  const [posShort, selShort] = cursor.querySelectorAll<HTMLElement>(".st-short > span");
  const indent = $("indent");
  const lang = $("status-language");

  fatal.addEventListener("click", () => location.reload());
  problems.addEventListener("click", () => actions.nextError());
  save.addEventListener("click", () => actions.saveNow());
  cursor.addEventListener("click", () => actions.gotoLine());
  lang.addEventListener("click", () => actions.openLanguagePicker());

  // ---- save state, with flicker control -------------------------------------
  let shownSave: SaveState | null = null;
  let shownSince = 0;
  let saveTimer: number | undefined;

  const showSave = (s: SaveState) => {
    if (s === shownSave) return;
    shownSave = s;
    shownSince = performance.now();
    const v = SAVE_VIEW[s];
    save.dataset.state = s;
    save.title = v.tip;
    save.querySelector(".st-ico")!.innerHTML = v.icon;
    save.querySelector(".st-label")!.textContent = v.label;
  };

  const onSaveState = (s: SaveState) => {
    window.clearTimeout(saveTimer);
    if (shownSave === null) return showSave(s);
    if (s === "saving") {
      if (shownSave === "saving") return;
      // A save started without a visible "Unsaved" (e.g. Ctrl+S): say so now.
      if (shownSave === "saved") showSave("unsaved");
      saveTimer = window.setTimeout(() => showSave("saving"), SAVING_DELAY_MS);
      return;
    }
    if (shownSave === "saving") {
      const left = SAVING_MIN_MS - (performance.now() - shownSince);
      if (left > 0) {
        saveTimer = window.setTimeout(() => showSave(s), left);
        return;
      }
    }
    showSave(s);
  };

  // ---- per-segment renderers ------------------------------------------------
  const renderFatal = (s: AppState) => {
    fatal.hidden = !s.fatalError;
    fatal.title = s.fatalError ? `${s.fatalError} · Click to reload` : "";
    fatal.setAttribute("aria-label", s.fatalError ? `Disconnected: ${s.fatalError}. Reload` : "Disconnected");
    // No snippet is loaded, so problems / check mode / save state would be noise.
    check.hidden = save.hidden = !!s.fatalError;
  };

  const renderProblems = (s: AppState) => {
    problems.hidden = !s.syntaxChecked || !!s.fatalError;
    problems.dataset.state = s.errors ? "error" : "ok";
    problemsCount.textContent = String(s.errors);
    const label = s.errors ? plural(s.errors, "syntax error") : "No syntax errors";
    problems.setAttribute("aria-label", label);
    problems.title = s.errors ? `${label} · F8 next, Shift+F8 previous` : label;
  };

  const renderCheck = (s: AppState) => {
    check.dataset.state = s.syntaxChecked ? "checked" : "highlight";
    check.querySelector(".st-ico")!.innerHTML = iconSvg(s.syntaxChecked ? "shield-check" : "shield-off", 14);
    check.querySelector(".st-label")!.textContent = s.syntaxChecked ? "Syntax check" : "Highlight only";
    check.title = s.syntaxChecked
      ? `Syntax check is on: ${s.language} errors are underlined as you type`
      : `Highlight only: ${s.language} gets colors, but no syntax error checking`;
  };

  const renderCursor = (s: AppState) => {
    const { line, col, selected } = s.cursor;
    posLong.textContent = `Ln ${line}, Col ${col}`;
    selLong.textContent = selected ? ` (${selected} selected)` : "";
    posShort.textContent = `${line}:${col}`;
    selShort.textContent = selected ? ` (${selected})` : "";
    cursor.classList.toggle("has-sel", selected > 0);
    cursor.setAttribute(
      "aria-label",
      `Line ${line}, column ${col}${selected ? `, ${plural(selected, "character")} selected` : ""}. Go to line`,
    );
  };

  const renderIndent = (s: AppState) => {
    indent.textContent = s.indent;
    indent.title = s.indent === "Tab" ? "Indentation: tabs" : `Indentation: ${s.indent.replace(/\D+/g, "")} spaces`;
  };

  const renderLanguage = (s: AppState) => {
    lang.querySelector<HTMLElement>(".st-lang-dot")!.style.setProperty("--lang-color", languageMeta(s.language).color);
    lang.querySelector(".st-label")!.textContent = s.language;
    lang.title = "Change language (Ctrl/Cmd+K M)";
    lang.setAttribute("aria-label", `Language: ${s.language}. Change language`);
  };

  let first = true;
  store.subscribe((s, prev) => {
    const all = first;
    first = false;
    if (all || s.fatalError !== prev.fatalError) renderFatal(s);
    if (all || s.errors !== prev.errors || s.syntaxChecked !== prev.syntaxChecked || s.fatalError !== prev.fatalError) renderProblems(s);
    if (all || s.syntaxChecked !== prev.syntaxChecked || s.language !== prev.language) renderCheck(s);
    if (all || s.saveState !== prev.saveState) onSaveState(s.saveState);
    if (all || s.cursor !== prev.cursor) renderCursor(s);
    if (all || s.indent !== prev.indent) renderIndent(s);
    if (all || s.language !== prev.language) renderLanguage(s);
  });
}
