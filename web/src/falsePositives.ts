// Known gaps in specific Lezer grammars, found by testing real-world code.
// Each filter recognises one narrow pattern where the parser reports an error
// in valid code, so we can drop that error instead of showing a red squiggle
// on correct code. Keep these narrow: a filter that's too broad hides real errors.

export type FalsePositiveFilter = (text: string) => (from: number, to: number) => boolean;

/**
 * Java: `Map<String, List<Integer>>` - the tokenizer reads the closing `>>`
 * (or `>>>`) as a shift operator. We ignore errors sitting on, or right next
 * to, a `>>` that has at least two unclosed `<` before it on the same line.
 */
const javaNestedGenerics: FalsePositiveFilter = (text) => {
  const spans: [number, number][] = [];
  for (const m of text.matchAll(/>{2,3}/g)) {
    const at = m.index!;
    const lineStart = text.lastIndexOf("\n", at - 1) + 1;
    const before = text.slice(lineStart, at).replace(/->/g, "").replace(/<<|>>|<=|>=/g, "");
    if (!/[\w?]\s*</.test(before)) continue;
    const open = (before.match(/</g) ?? []).length - (before.match(/>/g) ?? []).length;
    if (open < 2) continue;
    let end = at + m[0].length;
    while (end < text.length && (text[end] === " " || text[end] === "\t")) end++;
    spans.push([at - 1, end + 1]);
  }
  return (from) => spans.some(([s, e]) => from >= s && from <= e);
};

/**
 * C++: brace initialisation with three or more elements in a declaration,
 * e.g. `std::vector<int> v{1, 2, 3};`, reports "missing" right before `}`.
 */
const cppBraceInit: FalsePositiveFilter = (text) => (from, to) => {
  if (from !== to) return false;
  let i = from;
  while (i < text.length && /\s/.test(text[i])) i++;
  if (text[i] !== "}") return false;
  let depth = 0;
  for (let j = i - 1; j >= 0; j--) {
    const c = text[j];
    if (c === "}") depth++;
    else if (c === ";" && depth === 0) return false;
    else if (c === "{") {
      if (depth > 0) {
        depth--;
        continue;
      }
      const before = text.slice(Math.max(0, j - 80), j);
      const inner = text.slice(j + 1, i);
      return (
        /[\w\]>]\s*$/.test(before) && // `name{` / `arr[]{` / `Type<T>{`
        !/\b(struct|class|union|enum|namespace)\b[^;{}]*$/.test(before) &&
        !/\)\s*(const|noexcept|override|final|\s)*$/.test(before) && // function body
        inner.includes(",")
      );
    }
  }
  return false;
};

const FILTERS: Record<string, FalsePositiveFilter> = {
  Java: javaNestedGenerics,
  "C++": cppBraceInit,
  C: cppBraceInit,
};

/** Returns a predicate that is true for errors known to be false alarms. */
export function falsePositiveCheck(language: string | undefined, text: string) {
  const filter = language ? FILTERS[language] : undefined;
  return filter ? filter(text) : () => false;
}
