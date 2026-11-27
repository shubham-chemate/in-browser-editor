// Per-language display info: short badge label, brand-ish color (mostly from
// GitHub Linguist) and the file extension used for downloads.
// Append-only for UI agents; colors here are the ONLY hard-coded colors allowed
// in components (see docs/ui-plan.md §5).

export interface LanguageMeta {
  badge: string;
  color: string;
  ext: string;
}

const META: Record<string, LanguageMeta> = {
  Python: { badge: "py", color: "#3572A5", ext: "py" },
  JSON: { badge: "{}", color: "#cbcb41", ext: "json" },
  Go: { badge: "go", color: "#00ADD8", ext: "go" },
  YAML: { badge: "yml", color: "#cb171e", ext: "yaml" },
  Java: { badge: "java", color: "#b07219", ext: "java" },
  "C++": { badge: "c++", color: "#f34b7d", ext: "cpp" },
  C: { badge: "c", color: "#8a8f98", ext: "c" },
  "C#": { badge: "c#", color: "#178600", ext: "cs" },
  CSS: { badge: "css", color: "#663399", ext: "css" },
  Dockerfile: { badge: "dkr", color: "#2496ED", ext: "Dockerfile" },
  HTML: { badge: "html", color: "#e34c26", ext: "html" },
  JavaScript: { badge: "js", color: "#f1e05a", ext: "js" },
  Kotlin: { badge: "kt", color: "#A97BFF", ext: "kt" },
  Markdown: { badge: "md", color: "#4a8cd6", ext: "md" },
  PHP: { badge: "php", color: "#4F5D95", ext: "php" },
  Ruby: { badge: "rb", color: "#cc342d", ext: "rb" },
  Rust: { badge: "rs", color: "#dea584", ext: "rs" },
  Shell: { badge: "sh", color: "#89e051", ext: "sh" },
  SQL: { badge: "sql", color: "#e38c00", ext: "sql" },
  Swift: { badge: "swift", color: "#F05138", ext: "swift" },
  TOML: { badge: "toml", color: "#9c4221", ext: "toml" },
  TypeScript: { badge: "ts", color: "#3178c6", ext: "ts" },
  XML: { badge: "xml", color: "#0060ac", ext: "xml" },
  "Plain text": { badge: "txt", color: "#8a8f98", ext: "txt" },
};

const FALLBACK: LanguageMeta = { badge: "</>", color: "#8a8f98", ext: "txt" };

export function languageMeta(name: string): LanguageMeta {
  return META[name] ?? { ...FALLBACK, badge: name.slice(0, 3).toLowerCase() || FALLBACK.badge };
}

/** Filename for downloads: "server.go" stays, "Welcome" + Python -> "Welcome.py". */
export function downloadName(title: string, language: string): string {
  const { ext } = languageMeta(language);
  const safe = (title.trim() || "snippet").replace(/[\\/:*?"<>|]+/g, "-");
  if (ext === "Dockerfile") return safe.toLowerCase().includes("dockerfile") ? safe : "Dockerfile";
  return /\.[A-Za-z0-9+_-]+$/.test(safe) ? safe : `${safe}.${ext}`;
}
