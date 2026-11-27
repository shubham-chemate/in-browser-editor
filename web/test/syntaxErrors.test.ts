import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { StreamLanguage } from "@codemirror/language";
import { findJsonErrors, findSyntaxErrors } from "../src/syntaxErrors";
import {
  ALL_LANGUAGES, FEATURED, MORE, PICKER_LANGUAGES, PLAIN_TEXT, SYNTAX_CHECKED, loadLanguage, languageFromTitle,
} from "../src/languages";

async function errorsFor(language: string, code: string) {
  const { support } = await loadLanguage(language);
  const state = EditorState.create({ doc: code, extensions: [support] });
  return language === "JSON" ? findJsonErrors(state) : findSyntaxErrors(state, language);
}

// Realistic, valid snippets: these must produce zero errors (no false alarms).
const VALID: Record<string, string> = {
  Python: `from dataclasses import dataclass
import asyncio

@dataclass
class User:
    name: str
    age: int = 0

    def greet(self) -> str:
        return f"Hi {self.name}, you are {self.age}"

async def main(users: list[User]) -> None:
    for u in users:
        match u.age:
            case 0:
                print("newborn")
            case n if n > 60:
                print("senior")
            case _:
                print(u.greet())
    squares = {x: x * x for x in range(10) if x % 2 == 0}
    with open("f.txt") as fh:
        data = fh.read()
    try:
        await asyncio.sleep(1)
    except (ValueError, KeyError) as e:
        raise RuntimeError("bad") from e
    lam = lambda a, *args, **kw: (a, args, kw)

if __name__ == "__main__":
    asyncio.run(main([User("ann", 3)]))
`,
  JSON: `{
  "name": "demo",
  "tags": ["a", "b"],
  "nested": { "n": 1.5e3, "ok": true, "nothing": null }
}`,
  Go: `package main

import (
	"errors"
	"fmt"
)

type Stack[T any] struct{ items []T }

func (s *Stack[T]) Push(v T) { s.items = append(s.items, v) }

func Map[T, U any](xs []T, f func(T) U) []U {
	out := make([]U, 0, len(xs))
	for _, x := range xs {
		out = append(out, f(x))
	}
	return out
}

func main() {
	ch := make(chan int, 2)
	go func() { ch <- 1 }()
	select {
	case v := <-ch:
		fmt.Println(v)
	default:
	}
	if err := errors.New("x"); err != nil {
		defer fmt.Println("done")
	}
	m := map[string]int{"a": 1}
	switch t := any(m).(type) {
	case map[string]int:
		fmt.Println(t)
	}
}
`,
  YAML: `version: "3.9"
services:
  web:
    image: nginx:alpine
    ports:
      - "8080:80"
    environment:
      - KEY=value
    command: ["npm", "start"]
anchors:
  base: &base
    retries: 3
  derived:
    <<: *base
    note: |
      multi line
      text block
empty: ~
`,
  Java: `package demo;

import java.util.*;
import java.util.stream.Collectors;

public class Main {
    record Point(int x, int y) {}

    enum Color { RED, GREEN }

    interface Shape { double area(); }

    @Override
    public String toString() { return "Main"; }

    public static <T extends Comparable<T>> T max(List<T> xs) {
        return xs.stream().max(Comparator.naturalOrder()).orElseThrow();
    }

    public static void main(String[] args) throws Exception {
        var list = new ArrayList<Integer>(List.of(3, 1, 2));
        Map<String, List<Integer>> m = new HashMap<>();
        list.forEach(x -> System.out.println(x));
        String joined = list.stream().map(String::valueOf).collect(Collectors.joining(","));
        int[] arr = {1, 2, 3};
        for (int i = 0; i < arr.length; i++) { if (arr[i] > 1) break; }
        try (var sc = new Scanner(System.in)) {
            System.out.println(joined);
        } catch (IllegalStateException | NoSuchElementException e) {
            throw new RuntimeException(e);
        }
        Object o = new Point(1, 2);
        if (o instanceof Point p) System.out.println(p.x());
    }
}
`,
  "C++": `#include <iostream>
#include <vector>
#include <memory>
#include <map>

namespace demo {

template <typename T>
class Box {
public:
    explicit Box(T v) : value_(std::move(v)) {}
    const T& get() const { return value_; }
private:
    T value_;
};

struct Point { int x; int y; };

}  // namespace demo

int main() {
    std::vector<int> v{1, 2, 3};
    auto p = std::make_unique<demo::Box<int>>(42);
    std::map<std::string, int> m = {{"a", 1}};
    for (const auto& x : v) {
        std::cout << x << std::endl;
    }
    auto add = [](int a, int b) { return a + b; };
    demo::Point pt{1, 2};
    int* raw = new int[3];
    delete[] raw;
    return add(pt.x, p->get()) > 0 ? 0 : 1;
}
`,
};

// One typical mistake per language: each must produce at least one error.
const BROKEN: Record<string, { code: string; near: string }> = {
  Python: { code: "def greet(name:\n    print(name)\n", near: "print" },
  JSON: { code: '{\n  "a": 1,\n  "b": 2,\n}', near: "}" },
  Go: { code: 'package main\n\nfunc main() {\n\tfmt.Println("hi"\n}\n', near: "}" },
  YAML: { code: "services:\n  - web\n  image: nginx\n", near: "image" },
  Java: { code: "class A {\n  void f() {\n    int x = 1\n    int y = 2;\n  }\n}\n", near: "int y" },
  "C++": { code: "int main() {\n  int x = (1 + 2;\n  return x;\n}\n", near: "" },
};

describe("valid code has no syntax errors", () => {
  for (const [lang, code] of Object.entries(VALID)) {
    it(lang, async () => {
      expect(await errorsFor(lang, code)).toEqual([]);
    });
  }
});

describe("broken code is flagged", () => {
  for (const [lang, { code }] of Object.entries(BROKEN)) {
    it(lang, async () => {
      const errs = await errorsFor(lang, code);
      expect(errs.length).toBeGreaterThan(0);
      for (const e of errs) {
        expect(e.from).toBeGreaterThanOrEqual(0);
        expect(e.to).toBeLessThanOrEqual(code.length);
        expect(e.message).toMatch(/error|JSON/i);
      }
    });
  }
});

describe("specific messages", () => {
  it("JSON trailing comma points at the closing brace", async () => {
    const code = BROKEN.JSON.code;
    const [err] = await errorsFor("JSON", code);
    expect(err.message).toMatch(/^JSON: /);
    expect(code[err.from]).toBe("}");
  });

  it("unclosed block at end of file says so", async () => {
    const [err] = (await errorsFor("Go", "package main\n\nfunc main() {\n\tx := 1\n")).slice(-1);
    expect(err.message).toMatch(/ends unexpectedly/);
  });

  it("missing colon underlines the token before the gap", async () => {
    const code = 'for p in ["a", "b"]\n    print(p)\n';
    const [err] = await errorsFor("Python", code);
    expect(code.slice(err.from, err.to)).toBe("]");
    expect(err.message).toMatch(/missing after `\]`/);
  });

  it("missing semicolon underlines the end of the previous statement", async () => {
    const code = "class A {\n  void f() {\n    int x = 1\n    int y = 2;\n  }\n}\n";
    const errs = await errorsFor("Java", code);
    expect(errs.map((e) => code.slice(e.from, e.to))).toContain("1");
  });

  it("missing token after a string underlines the whole string", async () => {
    const code = 'package main\n\nfunc main() {\n\tfmt.Println("hi"\n}\n';
    const errs = await errorsFor("Go", code);
    expect(errs.map((e) => code.slice(e.from, e.to))).toContain('"hi"');
  });

  it("every reported error has a visible (non-empty) range", async () => {
    for (const [lang, { code }] of Object.entries(BROKEN)) {
      for (const e of await errorsFor(lang, code)) expect(e.to).toBeGreaterThan(e.from);
    }
  });

  it("empty documents have no errors", async () => {
    for (const lang of FEATURED) expect(await errorsFor(lang, "")).toEqual([]);
    expect(await errorsFor("JSON", "   \n")).toEqual([]);
  });

  it("highlight-only languages never report errors", async () => {
    expect(await errorsFor("Ruby", "def broken(\n  puts 'x'\n")).toEqual([]);
  });
});

describe("grammar false-positive filters", () => {
  const J = (b: string) => `class A {\n  void f() {\n    ${b}\n  }\n}\n`;
  const C = (b: string) => `int main() {\n  ${b}\n}\n`;

  const validJava = [
    J("Map<String, List<Integer>> m = new HashMap<>();"),
    J("List<Map<String, Integer>> m = null;"),
    J("Map<String, Map<String, List<Integer>>> deep = null;"),
    "class A { Map<String, List<Integer>> field; }",
    "class A { <T extends Comparable<T>> T max() { return null; } }",
    J("int y = x >> 2; int z = x >>> 1;"),
  ];
  for (const code of validJava) {
    it(`Java ok: ${code.replace(/\s+/g, " ").slice(0, 60)}`, async () => {
      expect(await errorsFor("Java", code)).toEqual([]);
    });
  }

  const validCpp = [
    C("std::vector<int> v{1, 2, 3};"),
    C("std::set<int> s{1, 2, 3};\n  int y = 2;"),
    C("int arr[] {1, 2, 3, 4};"),
    C("std::vector<std::string> v{\"a\", \"b\", \"c\"};"),
  ];
  for (const code of validCpp) {
    it(`C++ ok: ${code.replace(/\s+/g, " ").slice(0, 60)}`, async () => {
      expect(await errorsFor("C++", code)).toEqual([]);
    });
  }

  // Real mistakes right next to the filtered patterns must still be caught.
  const brokenNearby: [string, string][] = [
    ["Java", J("Map<String, List<Integer>> m = null;\n    int q = 1")],
    ["Java", J("List<List<String>> ll = new ArrayList<>(;")],
    ["C++", C("std::vector<int> v{1, 2, 3};\n  foo(a, b")],
    ["C++", "int main() {\n  foo(a, b\n}\n"],
    ["C++", "struct P {\n  int a, b\n};\n"],
  ];
  for (const [lang, code] of brokenNearby) {
    it(`${lang} still flags: ${code.replace(/\s+/g, " ").slice(0, 60)}`, async () => {
      expect((await errorsFor(lang, code)).length).toBeGreaterThan(0);
    });
  }
});

describe("language catalogue", () => {
  it("SYNTAX_CHECKED matches the languages that ship a Lezer parser", async () => {
    const actual = new Set<string>();
    for (const l of ALL_LANGUAGES) {
      const s = await l.load();
      if (!(s.language instanceof StreamLanguage)) actual.add(l.name);
    }
    expect([...SYNTAX_CHECKED].sort()).toEqual([...actual].sort());
  });

  it("all featured languages are syntax-checked", () => {
    for (const lang of FEATURED) expect(SYNTAX_CHECKED.has(lang)).toBe(true);
  });

  it("picker list is hand-picked: 20-25 real languages, no duplicates, rest alphabetical", () => {
    const names = ALL_LANGUAGES.map((l) => l.name);
    for (const lang of [...FEATURED, ...MORE]) expect(names).toContain(lang);
    expect(new Set(PICKER_LANGUAGES).size).toBe(PICKER_LANGUAGES.length);
    expect(PICKER_LANGUAGES.length).toBeGreaterThanOrEqual(20);
    expect(PICKER_LANGUAGES.length).toBeLessThanOrEqual(25);
    expect(MORE).toEqual([...MORE].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" })));
    expect(PICKER_LANGUAGES.at(-1)).toBe(PLAIN_TEXT);
  });

  it("every picker language loads", async () => {
    for (const name of [...FEATURED, ...MORE]) expect((await loadLanguage(name)).name).toBe(name);
  });

  it("guesses language from a filename-like title", () => {
    expect(languageFromTitle("server.go")).toBe("Go");
    expect(languageFromTitle("config.yaml")).toBe("YAML");
    expect(languageFromTitle("Main.java")).toBe("Java");
    expect(languageFromTitle("algo.cpp")).toBe("C++");
    expect(languageFromTitle("Dockerfile")).toBe("Dockerfile");
    expect(languageFromTitle("deploy.sh")).toBe("Shell");
    expect(languageFromTitle("app.ts")).toBe("TypeScript");
    expect(languageFromTitle("notes")).toBeUndefined();
    expect(languageFromTitle("script.lua")).toBeUndefined(); // not in the picker
  });
});
