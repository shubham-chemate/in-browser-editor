// Light/dark theme. Follows the OS setting until the user picks one; the
// choice is remembered per browser (a convenience, so localStorage is fine).
//
// The editor look is built from the design tokens in tokens.css: chrome
// (gutters, selection, panels, tooltips) and syntax colors (--syn-*) are all
// CSS variables, so flipping data-theme on <html> restyles the editor
// instantly and both themes share one definition. The dark/light
// EditorView themes differ only in the `dark` flag CodeMirror uses for its
// own base styles.

import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/600.css";
import { EditorView } from "@codemirror/view";
import type { Extension } from "@codemirror/state";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";
import { icon } from "./ui/icons";

export type Theme = "light" | "dark";
const KEY = "snippet-editor:theme";

export function initialTheme(): Theme {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === "light" || saved === "dark") return saved;
  } catch {
    /* storage blocked: fall through to OS preference */
  }
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function rememberTheme(theme: Theme) {
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    /* ignore */
  }
}

export function applyPageTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
}

// ---- editor chrome ----------------------------------------------------------
const field = {
  height: "26px",
  padding: "0 8px",
  border: "1px solid var(--input-border)",
  borderRadius: "var(--radius)",
  backgroundColor: "var(--input-bg)",
  color: "var(--text)",
  font: "var(--fs-13) var(--font-ui)",
  outline: "none",
  "&:focus": { borderColor: "var(--focus-color)", boxShadow: "0 0 0 1px var(--focus-color)" },
};

const button = {
  height: "26px",
  padding: "0 10px",
  border: "1px solid var(--btn-border)",
  borderRadius: "var(--radius)",
  backgroundColor: "var(--btn-bg)",
  backgroundImage: "none",
  color: "var(--text)",
  font: "500 var(--fs-13) var(--font-ui)",
  cursor: "pointer",
  "&:hover": { backgroundColor: "var(--btn-bg-hover)" },
  "&:active": { backgroundImage: "none", backgroundColor: "var(--active)" },
  "&:focus-visible": { outline: "none", boxShadow: "var(--focus-ring)" },
};

const closeButton = {
  display: "grid",
  placeItems: "center",
  width: "24px",
  height: "24px",
  padding: "0",
  border: "0",
  borderRadius: "var(--radius)",
  backgroundColor: "transparent",
  color: "var(--text-muted)",
  font: "18px/1 var(--font-ui)",
  cursor: "pointer",
  "&:hover": { backgroundColor: "var(--hover)", color: "var(--text)" },
  "&:focus-visible": { outline: "none", boxShadow: "var(--focus-ring)" },
};

// One period of a smooth wave, used as a mask (only its alpha matters).
const WAVE =
  `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='6' height='4' viewBox='0 0 6 4'%3E` +
  `%3Cpath d='M0 3C1.5 3 1.5 1 3 1S4.5 3 6 3' fill='none' stroke='%23000' stroke-width='1.4'/%3E%3C/svg%3E")`;

const chrome = {
  "&": {
    height: "100%",
    fontSize: "var(--fs-code)",
    color: "var(--editor-fg)",
    backgroundColor: "var(--editor-bg)",
  },
  ".cm-scroller": {
    fontFamily: "var(--font-mono)",
    lineHeight: "var(--lh-code)",
    fontVariantLigatures: "none",
    fontFeatureSettings: '"liga" 0, "calt" 0',
  },
  ".cm-content": { padding: "12px 0 40vh", caretColor: "var(--editor-cursor)" },
  ".cm-line": { padding: "0 24px 0 6px" },

  // cursor & selection
  ".cm-cursor, .cm-dropCursor": { borderLeft: "2px solid var(--editor-cursor)", marginLeft: "-1px" },
  ".cm-selectionBackground": { backgroundColor: "var(--editor-selection-inactive)" },
  "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground": {
    backgroundColor: "var(--editor-selection)",
  },
  ".cm-selectionMatch": { backgroundColor: "var(--editor-selection-match)", borderRadius: "2px" },
  ".cm-activeLine": { backgroundColor: "var(--editor-line-active)" },

  // brackets
  // Only while focused, so idle code on a recording isn't boxed in.
  "&.cm-focused .cm-matchingBracket": {
    backgroundColor: "var(--editor-bracket-bg)",
    outline: "1px solid var(--editor-bracket-border)",
    outlineOffset: "-1px",
    borderRadius: "2px",
    color: "inherit",
  },
  "&.cm-focused .cm-nonmatchingBracket": {
    backgroundColor: "transparent",
    color: "var(--danger)",
  },

  // search matches
  ".cm-searchMatch": {
    backgroundColor: "var(--editor-find-match)",
    outline: "none",
    borderRadius: "2px",
  },
  ".cm-searchMatch.cm-searchMatch-selected": {
    backgroundColor: "var(--editor-find-current)",
    outline: "1px solid var(--warn)",
    outlineOffset: "-1px",
  },
  ".cm-searchMatch .cm-selectionMatch": { backgroundColor: "transparent" },

  // gutters: faint numbers, the active line's number at full contrast
  ".cm-gutters": {
    backgroundColor: "var(--editor-bg)",
    color: "var(--editor-gutter-fg)",
    border: "none",
    paddingLeft: "4px",
  },
  ".cm-lineNumbers .cm-gutterElement": {
    minWidth: "3ch",
    padding: "0 6px 0 4px",
    fontVariantNumeric: "tabular-nums",
  },
  ".cm-activeLineGutter": { backgroundColor: "transparent", color: "var(--editor-gutter-active-fg)" },
  ".cm-foldGutter .cm-gutterElement": {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: "18px",
    color: "var(--text-faint)",
    cursor: "pointer",
  },
  ".cm-fold-marker": {
    display: "grid",
    placeItems: "center",
    width: "16px",
    height: "16px",
    borderRadius: "var(--radius-sm)",
    opacity: "0",
    transition: "opacity var(--dur) var(--ease)",
  },
  ".cm-gutters:hover .cm-fold-marker, .cm-fold-marker.cm-fold-closed": { opacity: "1" },
  ".cm-fold-marker:hover": { backgroundColor: "var(--hover)", color: "var(--text)" },
  ".cm-foldPlaceholder": {
    margin: "0 4px",
    padding: "0 6px",
    border: "1px solid var(--border-strong)",
    borderRadius: "var(--radius-sm)",
    backgroundColor: "var(--badge-bg)",
    color: "var(--text-muted)",
    fontFamily: "var(--font-ui)",
    fontSize: "var(--fs-12)",
  },

  // lint: wavy underline plus a soft tint, a crisp dot in the gutter
  // The squiggle is a token-colored box masked by a wave, so it is crisp,
  // follows the theme, and still reads on a one-character range.
  ".cm-lintRange.cm-lintRange-error": {
    position: "relative",
    backgroundImage: "none",
    backgroundColor: "var(--editor-error-bg)",
    paddingBottom: "0",
    borderRadius: "2px",
  },
  ".cm-lintRange.cm-lintRange-error::after": {
    content: '""',
    position: "absolute",
    left: "-1px",
    right: "-1px",
    bottom: "-2px",
    minWidth: "9px",
    height: "4px",
    backgroundColor: "var(--danger)",
    pointerEvents: "none",
    WebkitMask: `${WAVE} repeat-x left center / 6px 4px`,
    mask: `${WAVE} repeat-x left center / 6px 4px`,
  },
  ".cm-lintRange-active": { backgroundColor: "var(--editor-error-bg)" },
  ".cm-line.cm-errorLine": { backgroundColor: "var(--editor-error-line)" },
  ".cm-lintPoint-error:after": { borderBottomColor: "var(--danger)" },
  ".cm-gutter-lint": { width: "16px" },
  ".cm-gutter-lint .cm-gutterElement": {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "0",
  },
  ".cm-lint-marker": { display: "grid", placeItems: "center", width: "16px", height: "16px" },
  ".cm-lint-marker-error": { content: "normal" },
  ".cm-lint-marker-error::after": {
    content: '""',
    width: "8px",
    height: "8px",
    borderRadius: "50%",
    backgroundColor: "var(--danger)",
    boxShadow: "0 0 0 3px var(--danger-soft)",
  },

  // floating layers: tooltips, lint hover card, autocomplete
  ".cm-tooltip": {
    border: "none",
    borderRadius: "var(--radius-lg)",
    backgroundColor: "var(--surface-2)",
    color: "var(--text)",
    boxShadow: "var(--shadow-pop)",
    fontFamily: "var(--font-ui)",
    fontSize: "var(--fs-13)",
  },
  ".cm-tooltip .cm-tooltip-arrow:before, .cm-tooltip .cm-tooltip-arrow:after": { display: "none" },
  ".cm-tooltip.cm-tooltip-lint": {
    padding: "0",
    maxWidth: "min(480px, calc(100vw - 32px))",
    overflow: "hidden",
  },
  ".cm-tooltip-lint .cm-diagnostic": {
    margin: "0",
    padding: "0",
    border: "none",
    whiteSpace: "normal",
  },
  ".cm-tooltip-lint .cm-diagnostic + .cm-diagnostic": { borderTop: "1px solid var(--border)" },
  ".cm-tooltip-lint .cm-diagnostic:not(:last-child) .cm-lint-card-foot": { display: "none" },
  ".cm-lint-card": { lineHeight: "var(--lh-ui)" },
  ".cm-lint-card-head": {
    display: "flex",
    alignItems: "center",
    gap: "6px",
    padding: "10px 14px 0 12px",
    fontWeight: "600",
    color: "var(--text)",
  },
  ".cm-lint-card-head .icon": { flex: "none", color: "var(--danger)" },
  ".cm-lint-card-body": {
    padding: "4px 14px 10px 34px",
    color: "var(--text)",
    overflowWrap: "anywhere",
  },
  ".cm-lint-card-body code": {
    padding: "1px 5px",
    borderRadius: "var(--radius-sm)",
    backgroundColor: "var(--badge-bg)",
    fontFamily: "var(--font-mono)",
    fontSize: "0.92em",
    fontWeight: "600",
  },
  ".cm-lint-card-foot": {
    display: "flex",
    alignItems: "center",
    gap: "6px",
    padding: "6px 14px 7px 34px",
    borderTop: "1px solid var(--border)",
    backgroundColor: "var(--surface-1)",
    color: "var(--text-faint)",
    fontSize: "var(--fs-12)",
  },
  ".cm-panel-lint .cm-lint-card-head, .cm-panel-lint .cm-lint-card-foot": { display: "none" },
  ".cm-panel-lint .cm-lint-card-body": { padding: "2px 8px" },

  ".cm-tooltip-autocomplete": { padding: "4px" },
  ".cm-tooltip-autocomplete > ul": { fontFamily: "var(--font-mono)", fontSize: "var(--fs-13)" },
  ".cm-tooltip-autocomplete > ul > li": {
    padding: "2px 8px 2px 4px",
    borderRadius: "var(--radius-sm)",
    lineHeight: "20px",
  },
  ".cm-tooltip-autocomplete > ul > li[aria-selected]": {
    backgroundColor: "var(--accent-soft)",
    color: "var(--text)",
  },
  ".cm-completionMatchedText": { textDecoration: "none", color: "var(--accent-fg)", fontWeight: "600" },
  ".cm-completionDetail": { color: "var(--text-faint)", fontStyle: "normal" },
  ".cm-completionIcon": { opacity: "0.7", width: "1.4em", paddingRight: "0.4em" },
  ".cm-tooltip.cm-completionInfo": { padding: "6px 10px" },

  // panels: go to line, search, lint list
  ".cm-panels": {
    backgroundColor: "var(--surface-1)",
    color: "var(--text)",
    fontFamily: "var(--font-ui)",
    fontSize: "var(--fs-13)",
  },
  ".cm-panels.cm-panels-bottom": { borderTop: "1px solid var(--border)" },
  ".cm-panels.cm-panels-top": { borderBottom: "1px solid var(--border)" },
  ".cm-textfield": field,
  ".cm-button": button,
  ".cm-panel.cm-dialog": { display: "flex", alignItems: "center", padding: "6px 40px 6px 12px" },
  ".cm-dialog form": { display: "flex", alignItems: "center", gap: "8px" },
  ".cm-dialog label": {
    display: "inline-flex",
    alignItems: "center",
    gap: "8px",
    fontSize: "var(--fs-13)",
    color: "var(--text-muted)",
  },
  ".cm-goto-line .cm-textfield": { width: "96px", fontFamily: "var(--font-mono)" },
  ".cm-dialog .cm-dialog-close": { ...closeButton, position: "absolute", top: "50%", right: "8px", marginTop: "-12px" },
  ".cm-panel.cm-search": { padding: "4px 40px 4px 12px" },
  ".cm-panel.cm-search input, .cm-panel.cm-search button, .cm-panel.cm-search label": {
    margin: "3px 6px 3px 0",
    verticalAlign: "middle",
  },
  ".cm-panel.cm-search .cm-textfield": { width: "220px", fontFamily: "var(--font-mono)" },
  ".cm-panel.cm-search label": {
    display: "inline-flex",
    alignItems: "center",
    gap: "4px",
    marginLeft: "6px",
    fontSize: "var(--fs-12)",
    color: "var(--text-muted)",
    cursor: "pointer",
  },
  ".cm-panel.cm-search input[type=checkbox]": { accentColor: "var(--accent)", margin: "0" },
  ".cm-panel.cm-search [name=close]": { ...closeButton, position: "absolute", top: "6px", right: "8px" },
  ".cm-panel.cm-panel-lint ul [aria-selected]": { backgroundColor: "var(--active)" },
  ".cm-panel.cm-panel-lint ul:focus [aria-selected]": {
    backgroundColor: "var(--accent-soft)",
    color: "var(--text)",
  },
  ".cm-panel.cm-panel-lint [name=close]": { ...closeButton, top: "4px", right: "8px" },

  ".cm-specialChar": { color: "var(--danger)" },
};

const darkChrome = EditorView.theme(chrome, { dark: true });
const lightChrome = EditorView.theme(chrome, { dark: false });

// ---- syntax colors ------------------------------------------------------------
// Mapping follows VS Code's Dark/Light Modern scopes: storage keywords blue,
// control flow and imports purple, functions yellow/brown, types teal.
const syn = (name: string) => `var(--syn-${name})`;

export const codeHighlight = HighlightStyle.define([
  { tag: [t.keyword, t.definitionKeyword, t.modifier, t.operatorKeyword, t.bool, t.null, t.self, t.atom], color: syn("keyword") },
  { tag: [t.controlKeyword, t.moduleKeyword, t.processingInstruction], color: syn("control") },
  { tag: [t.string, t.special(t.string), t.character, t.docString, t.attributeValue], color: syn("string") },
  { tag: [t.number, t.integer, t.float, t.unit], color: syn("number") },
  { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], color: syn("comment") },
  {
    tag: [t.function(t.variableName), t.function(t.definition(t.variableName)), t.function(t.propertyName), t.macroName],
    color: syn("function"),
  },
  { tag: [t.typeName, t.className, t.namespace, t.definition(t.typeName), t.standard(t.typeName)], color: syn("type") },
  { tag: [t.variableName, t.definition(t.variableName), t.local(t.variableName), t.special(t.variableName)], color: syn("variable") },
  { tag: [t.propertyName, t.definition(t.propertyName)], color: syn("property") },
  { tag: [t.constant(t.variableName), t.constant(t.propertyName), t.standard(t.variableName), t.labelName], color: syn("constant") },
  { tag: t.regexp, color: syn("regexp") },
  { tag: [t.escape, t.special(t.brace)], color: syn("escape") },
  { tag: t.tagName, color: syn("tag") },
  { tag: t.attributeName, color: syn("attribute") },
  { tag: [t.operator, t.derefOperator, t.arithmeticOperator, t.logicOperator, t.bitwiseOperator, t.compareOperator, t.updateOperator, t.definitionOperator, t.typeOperator, t.controlOperator], color: syn("operator") },
  { tag: [t.punctuation, t.separator, t.paren, t.brace, t.squareBracket, t.angleBracket], color: syn("punctuation") },
  { tag: [t.annotation, t.meta, t.documentMeta], color: syn("annotation") },
  { tag: t.heading, color: syn("heading"), fontWeight: "600" },
  { tag: [t.link, t.url], color: syn("link"), textDecoration: "underline", textUnderlineOffset: "3px" },
  { tag: t.emphasis, fontStyle: "italic" },
  { tag: t.strong, fontWeight: "600" },
  { tag: t.strikethrough, textDecoration: "line-through" },
  { tag: [t.inserted], color: syn("number") },
  { tag: [t.deleted], color: syn("string") },
  { tag: t.invalid, color: syn("invalid") },
]);

const highlighting = syntaxHighlighting(codeHighlight);

export function editorTheme(theme: Theme): Extension {
  return [theme === "dark" ? darkChrome : lightChrome, highlighting];
}

// ---- lint hover card ------------------------------------------------------------
/** "Syntax error: missing `]`" -> "Missing `]`", "JSON: Unexpected token" -> "Unexpected token". */
export function lintBodyText(message: string): string {
  const body = message.replace(/^(Syntax error|JSON)\s*:\s*/i, "");
  return body.charAt(0).toUpperCase() + body.slice(1);
}

/**
 * VS Code-style hover card for a diagnostic: icon + "Syntax error" heading,
 * the message (with `code` spans), and a faint "F8 next error" footer.
 */
export function renderLintCard(message: string): HTMLElement {
  const card = document.createElement("div");
  card.className = "cm-lint-card";

  const head = document.createElement("div");
  head.className = "cm-lint-card-head";
  head.append(icon("circle-x", 16), "Syntax error");

  const body = document.createElement("div");
  body.className = "cm-lint-card-body";
  // `backticked` parts become inline code; the rest stays plain text.
  lintBodyText(message)
    .split("`")
    .forEach((part, i) => {
      if (!part) return;
      if (i % 2) {
        const code = document.createElement("code");
        code.textContent = part;
        body.append(code);
      } else body.append(part);
    });

  const foot = document.createElement("div");
  foot.className = "cm-lint-card-foot";
  const kbd = document.createElement("kbd");
  kbd.textContent = "F8";
  foot.append(kbd, "next error");

  card.append(head, body, foot);
  return card;
}
