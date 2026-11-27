// Finds syntax errors without knowing anything language-specific.
//
// How it works: every language with a Lezer parser (Python, Go, Java, C++,
// YAML, ...) builds a syntax tree for highlighting. When the parser hits code
// it can't make sense of, it recovers by inserting an *error node* into the
// tree. We just walk the tree and turn those error nodes into diagnostics.
// Legacy "stream" languages (Ruby, Kotlin, ...) only tokenize, never produce
// error nodes, so they get highlighting but no false errors.
//
// This module is DOM-free so it can be unit-tested in Node.

import { EditorState } from "@codemirror/state";
import { ensureSyntaxTree } from "@codemirror/language";
import { falsePositiveCheck } from "./falsePositives";

export interface SyntaxProblem {
  from: number;
  to: number;
  message: string;
}

export const MAX_PROBLEMS = 100;

/**
 * Find syntax errors via the parser's error-recovery nodes.
 * `language` (e.g. "Java") enables known false-positive filters for that grammar.
 */
export function findSyntaxErrors(state: EditorState, language?: string, timeoutMs = 1000): SyntaxProblem[] {
  const doc = state.doc;
  if (doc.length === 0) return [];
  const tree = ensureSyntaxTree(state, doc.length, timeoutMs);
  if (!tree) return [];
  const text = doc.toString();
  const isFalseAlarm = falsePositiveCheck(language, text);

  // 1. Collect raw error ranges.
  const ranges: { from: number; to: number }[] = [];
  tree.iterate({
    enter(node) {
      if (node.type.isError) {
        if (!isFalseAlarm(node.from, node.to)) ranges.push({ from: node.from, to: node.to });
        return false; // don't descend into an error node
      }
    },
  });
  if (ranges.length === 0) return [];
  ranges.sort((a, b) => a.from - b.from || a.to - b.to);

  // 2. Merge overlapping/touching ranges: one mistake often yields a cluster.
  const merged: { from: number; to: number }[] = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && r.from <= last.to) last.to = Math.max(last.to, r.to);
    else merged.push({ ...r });
  }

  // 3. Describe each one. Zero-width errors ("something should be inserted
  //    here") are drawn under the token just before the gap, because a
  //    zero-width marker is nearly invisible. That is also where a missing
  //    colon or semicolon belongs.
  const contentEnd = text.trimEnd().length;
  const problems: SyntaxProblem[] = [];
  const seen = new Set<string>();
  for (const { from, to } of merged.slice(0, MAX_PROBLEMS)) {
    const p =
      from === to
        ? describeMissing(text, from, contentEnd)
        : { from, to, message: describeUnexpected(text, from, to, contentEnd) };
    const key = `${p.from}:${p.to}`;
    if (!seen.has(key)) {
      seen.add(key);
      problems.push(p);
    }
  }
  return problems;
}

const EOF_MESSAGE = "Syntax error: code ends unexpectedly. Is a bracket, quote or block left open?";

function describeUnexpected(text: string, from: number, to: number, contentEnd: number): string {
  if (from >= contentEnd) return EOF_MESSAGE;
  let snippet = text.slice(from, to).replace(/\s+/g, " ").trim();
  if (snippet.length > 30) snippet = snippet.slice(0, 27) + "...";
  return snippet ? `Syntax error: unexpected \`${snippet}\`` : "Syntax error";
}

function describeMissing(text: string, pos: number, contentEnd: number): SyntaxProblem {
  // Find the token before the gap, skipping whitespace (possibly previous lines).
  let end = Math.min(pos, text.length);
  while (end > 0 && /\s/.test(text[end - 1])) end--;
  if (end === 0) {
    return { from: pos, to: pos, message: "Syntax error: something is missing here" };
  }
  let start = end - 1;
  const last = text[start];
  if (/\w/.test(last)) {
    while (start > 0 && /\w/.test(text[start - 1])) start--;
  } else if (last === '"' || last === "'" || last === "`") {
    // Underline the whole string literal, if it opens on the same line.
    const lineStart = text.lastIndexOf("\n", start - 1) + 1;
    const open = text.lastIndexOf(last, start - 1);
    if (open >= lineStart) start = open;
  }
  const token = text.slice(start, end);
  const message =
    pos >= contentEnd
      ? EOF_MESSAGE
      : `Syntax error: something is missing after \`${token}\` (a colon, bracket, comma or semicolon?)`;
  return { from: start, to: end, message };
}

/**
 * JSON gets precise messages from the browser's own JSON.parse, which is
 * stricter and clearer than tree recovery ("Expected ',' or '}' ...").
 */
export function findJsonErrors(state: EditorState): SyntaxProblem[] {
  const text = state.doc.toString();
  if (text.trim() === "") return [];
  try {
    JSON.parse(text);
    return [];
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const pos = jsonErrorPosition(message, state);
    return [{ from: pos, to: Math.min(pos + 1, text.length), message: `JSON: ${message}` }];
  }
}

function jsonErrorPosition(message: string, state: EditorState): number {
  const len = state.doc.length;
  const at = message.match(/at position (\d+)/);
  if (at) return Math.min(Number(at[1]), len);
  const lc = message.match(/line (\d+) column (\d+)/);
  if (lc) {
    const line = state.doc.line(Math.min(Number(lc[1]), state.doc.lines));
    return Math.min(line.from + Number(lc[2]) - 1, line.to);
  }
  return len; // e.g. "Unexpected end of JSON input"
}
