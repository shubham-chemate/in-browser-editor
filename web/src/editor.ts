// CodeMirror setup. Language, theme and the error checker live in
// compartments so they can be swapped without recreating the editor.

import {
  Decoration, EditorView, ViewPlugin, crosshairCursor, drawSelection, dropCursor, highlightActiveLine,
  highlightActiveLineGutter, highlightSpecialChars, keymap, lineNumbers, rectangularSelection,
  type DecorationSet, type ViewUpdate,
} from "@codemirror/view";
import { Compartment, EditorState, RangeSetBuilder, type Extension } from "@codemirror/state";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { bracketMatching, foldGutter, foldKeymap, indentOnInput, indentUnit } from "@codemirror/language";
import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap } from "@codemirror/autocomplete";
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search";
import {
  diagnosticCount, forEachDiagnostic, linter, lintGutter, lintKeymap, nextDiagnostic, type Diagnostic,
} from "@codemirror/lint";
import { gotoLine } from "@codemirror/search";
import { findJsonErrors, findSyntaxErrors } from "./syntaxErrors";
import { editorTheme, renderLintCard, type Theme } from "./theme";
import { icon } from "./ui/icons";
import type { LoadedLanguage } from "./languages";

function syntaxLinter(lang: LoadedLanguage): Extension {
  if (lang.name === "JSON") {
    return linter((view) => findJsonErrors(view.state).map(toDiagnostic), { delay: 400 });
  }
  if (!lang.checked) return [];
  return linter((view) => findSyntaxErrors(view.state, lang.name).map(toDiagnostic), { delay: 400 });
}

function toDiagnostic(p: { from: number; to: number; message: string }): Diagnostic {
  return {
    from: p.from,
    to: p.to,
    severity: "error",
    message: p.message,
    renderMessage: () => renderLintCard(p.message),
  };
}

const TWO_SPACE = new Set(["JSON", "YAML", "HTML", "CSS", "SCSS", "JavaScript", "TypeScript", "JSX", "TSX", "XML", "Vue"]);

// Go uses tabs, the data/web formats 2 spaces, everything else 4.
function indentFor(name: string): Extension {
  if (name === "Go") return indentUnit.of("\t");
  return indentUnit.of(TWO_SPACE.has(name) ? "  " : "    ");
}

/** Chevron fold markers, shown on gutter hover (always when folded), like VS Code. */
function foldMarker(open: boolean): HTMLElement {
  const el = document.createElement("span");
  el.className = open ? "cm-fold-marker" : "cm-fold-marker cm-fold-closed";
  el.title = open ? "Fold" : "Unfold";
  el.append(icon(open ? "chevron-down" : "chevron-right", 14));
  return el;
}

/** Faintly tint every line that has an error, so it reads at a glance (and on video). */
const errorLineDeco = Decoration.line({ class: "cm-errorLine" });

function errorLines(state: EditorState): DecorationSet {
  const lines = new Set<number>();
  forEachDiagnostic(state, (d, from) => {
    if (d.severity === "error") lines.add(state.doc.lineAt(Math.min(from, state.doc.length)).from);
  });
  const builder = new RangeSetBuilder<Decoration>();
  for (const pos of [...lines].sort((a, b) => a - b)) builder.add(pos, pos, errorLineDeco);
  return builder.finish();
}

const errorLineHighlight = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    private count: number;
    constructor(view: EditorView) {
      this.decorations = errorLines(view.state);
      this.count = diagnosticCount(view.state);
    }
    update(u: ViewUpdate) {
      // Diagnostics arrive in their own transactions; rebuild only when they
      // may have changed (a few errors at most, so this is cheap).
      const count = diagnosticCount(u.state);
      if (u.docChanged || count !== this.count || u.transactions.some((tr) => tr.effects.length)) {
        this.decorations = errorLines(u.state);
        this.count = count;
      }
    }
  },
  { decorations: (v) => v.decorations },
);

// Friendlier labels for CodeMirror's built-in search and go-to-line panels.
const phrases = EditorState.phrases.of({
  go: "Go",
  next: "Next",
  previous: "Previous",
  all: "Select all",
  "match case": "Match case",
  regexp: "Regex",
  "by word": "Whole word",
  replace: "Replace",
  "replace all": "Replace all",
});

/**
 * codemirror's basicSetup, spelled out so the gutters can be arranged like
 * VS Code (error dot | line numbers | fold chevrons) with custom fold markers.
 */
const setup: Extension = [
  lintGutter(),
  lineNumbers(),
  foldGutter({ markerDOM: foldMarker }),
  highlightActiveLineGutter(),
  highlightSpecialChars(),
  history(),
  drawSelection(),
  dropCursor(),
  EditorState.allowMultipleSelections.of(true),
  indentOnInput(),
  bracketMatching(),
  closeBrackets(),
  autocompletion(),
  rectangularSelection(),
  crosshairCursor(),
  highlightActiveLine(),
  highlightSelectionMatches(),
  errorLineHighlight,
  phrases,
  keymap.of([
    ...closeBracketsKeymap,
    ...defaultKeymap,
    ...searchKeymap,
    ...historyKeymap,
    ...foldKeymap,
    ...completionKeymap,
    ...lintKeymap,
  ]),
];

/** A tab's editor session, kept while the tab is in the background. */
export interface EditorSnapshot {
  state: EditorState;
  theme: Theme;
  scrollTop: number;
  scrollLeft: number;
}

export interface EditorCallbacks {
  /** User edited the text. */
  onChange: (code: string) => void;
  /** Anything changed (text, cursor, diagnostics); refresh the status bar. */
  onUpdate: (view: EditorView) => void;
  /** Ctrl/Cmd+S. */
  onSave: () => void;
}

export class Editor {
  readonly view: EditorView;
  private languageSlot = new Compartment();
  private lintSlot = new Compartment();
  private indentSlot = new Compartment();
  private themeSlot = new Compartment();
  private theme: Theme;

  constructor(parent: HTMLElement, theme: Theme, private cb: EditorCallbacks) {
    this.theme = theme;
    this.view = new EditorView({ parent, state: this.makeState("", null) });
  }

  private makeState(doc: string, lang: LoadedLanguage | null): EditorState {
    return EditorState.create({
      doc,
      extensions: [
        setup,
        keymap.of([
          indentWithTab,
          { key: "Mod-s", preventDefault: true, run: () => (this.cb.onSave(), true) },
        ]),
        this.languageSlot.of(lang ? lang.support : []),
        this.lintSlot.of(lang ? syntaxLinter(lang) : []),
        this.indentSlot.of(indentFor(lang?.name ?? "")),
        this.themeSlot.of(editorTheme(this.theme)),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) this.cb.onChange(u.state.doc.toString());
          this.cb.onUpdate(u.view);
        }),
      ],
    });
  }

  /** Show a different snippet: fresh state, so undo history doesn't leak between snippets. */
  load(code: string, lang: LoadedLanguage) {
    this.view.setState(this.makeState(code, lang));
    this.cb.onUpdate(this.view);
  }

  /**
   * Capture the current editor session (text, undo history, selection,
   * folds, diagnostics) plus scroll position, so a tab can come back exactly
   * where it was left.
   */
  snapshot(): EditorSnapshot {
    return {
      state: this.view.state,
      theme: this.theme,
      scrollTop: this.view.scrollDOM.scrollTop,
      scrollLeft: this.view.scrollDOM.scrollLeft,
    };
  }

  /** Bring back a session captured with snapshot(). */
  restore(snap: EditorSnapshot) {
    this.view.setState(snap.state);
    // The theme may have changed while this tab was in the background.
    if (snap.theme !== this.theme) {
      this.view.dispatch({ effects: this.themeSlot.reconfigure(editorTheme(this.theme)) });
    }
    this.cb.onUpdate(this.view);
    const { scrollTop, scrollLeft } = snap;
    // Scroll after layout so the restored document has its height.
    requestAnimationFrame(() => this.view.scrollDOM.scrollTo({ top: scrollTop, left: scrollLeft }));
  }

  setLanguage(lang: LoadedLanguage) {
    this.view.dispatch({
      effects: [
        this.languageSlot.reconfigure(lang.support),
        this.lintSlot.reconfigure(syntaxLinter(lang)),
        this.indentSlot.reconfigure(indentFor(lang.name)),
      ],
    });
  }

  setTheme(theme: Theme) {
    this.theme = theme;
    this.view.dispatch({ effects: this.themeSlot.reconfigure(editorTheme(theme)) });
  }

  get code(): string {
    return this.view.state.doc.toString();
  }

  /** Jump to the next syntax error (wraps around), like F8. */
  nextError() {
    this.view.focus();
    nextDiagnostic(this.view);
  }

  /** Open CodeMirror's go-to-line prompt. */
  gotoLine() {
    this.view.focus();
    gotoLine(this.view);
  }

  /** "Tab", "Spaces: 2" or "Spaces: 4" for the status bar. */
  get indentLabel(): string {
    const unit = this.view.state.facet(indentUnit);
    return unit === "\t" ? "Tab" : `Spaces: ${unit.length}`;
  }

  focus() {
    this.view.focus();
  }
}
