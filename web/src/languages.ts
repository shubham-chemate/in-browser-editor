// Language catalogue. Highlighting comes from @codemirror/language-data,
// which knows ~140 languages and lazy-loads each one on first use.

import { LanguageDescription, StreamLanguage } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import type { Extension } from "@codemirror/state";

export const PLAIN_TEXT = "Plain text";

/** The languages the user uses most; pinned at the top of the picker. */
export const FEATURED = ["Python", "JSON", "Go", "YAML", "Java", "C++"];

/**
 * The rest of the hand-picked list shown in the picker (alphabetical).
 * Any name from @codemirror/language-data works here. To add one, add its
 * name, and the unit test checks that it exists.
 */
export const MORE = [
  "C", "C#", "CSS", "Dockerfile", "HTML", "JavaScript", "Kotlin", "Markdown",
  "PHP", "Ruby", "Rust", "Shell", "SQL", "Swift", "TOML", "TypeScript", "XML",
];

/** Everything the picker offers, in display order (Plain text last). */
export const PICKER_LANGUAGES = [...FEATURED, ...MORE, PLAIN_TEXT];

/**
 * Languages with a full Lezer parser, which means syntax errors can be
 * detected. Everything else is highlight-only. A unit test keeps this list
 * in sync with what language-data actually ships.
 */
export const SYNTAX_CHECKED = new Set([
  "Angular Template", "C", "C++", "CQL", "CSS", "Go", "HTML", "Java", "JavaScript",
  "Jinja", "JSON", "JSX", "LESS", "Liquid", "MariaDB SQL", "Markdown", "MS SQL",
  "MySQL", "PHP", "PLSQL", "PostgreSQL", "Python", "Rust", "Sass", "SCSS", "SQL",
  "SQLite", "TSX", "TypeScript", "Vue", "WebAssembly", "XML", "YAML",
]);

export const ALL_LANGUAGES: readonly LanguageDescription[] = languages;

export function findLanguage(name: string): LanguageDescription | undefined {
  return languages.find((l) => l.name === name);
}

export function isSyntaxChecked(name: string): boolean {
  return SYNTAX_CHECKED.has(name);
}

export interface LoadedLanguage {
  name: string;
  support: Extension;
  /** True when the parser builds a real tree that can contain error nodes. */
  checked: boolean;
}

/** Load (lazily) the highlighting support for a language by name. */
export async function loadLanguage(name: string): Promise<LoadedLanguage> {
  const desc = findLanguage(name);
  if (!desc) return { name: PLAIN_TEXT, support: [], checked: false };
  const support = await desc.load();
  return { name: desc.name, support, checked: !(support.language instanceof StreamLanguage) };
}

const pickerDescriptions = languages.filter((l) => PICKER_LANGUAGES.includes(l.name));

/**
 * Guess a language from a filename-like title such as "server.go" or
 * "Dockerfile". Only languages in the picker are considered.
 */
export function languageFromTitle(title: string): string | undefined {
  return LanguageDescription.matchFilename(pickerDescriptions, title.trim())?.name;
}
