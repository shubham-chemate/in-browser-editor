// Thin client for the Go server's snippet API.

export interface SnippetMeta {
  id: string;
  title: string;
  language: string;
  updatedAt: string;
}

export interface Snippet extends SnippetMeta {
  code: string;
  createdAt: string;
}

export type SnippetChanges = Partial<Pick<Snippet, "title" | "language" | "code">>;

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    throw new Error(detail.error ?? `${method} ${path} failed (${res.status})`);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

export const api = {
  list: () => request<SnippetMeta[]>("GET", "/api/snippets"),
  get: (id: string) => request<Snippet>("GET", `/api/snippets/${id}`),
  create: (data: SnippetChanges) => request<Snippet>("POST", "/api/snippets", data),
  update: (id: string, data: SnippetChanges) => request<Snippet>("PUT", `/api/snippets/${id}`, data),
  remove: (id: string) => request<void>("DELETE", `/api/snippets/${id}`),

  /** Best-effort save that survives the tab closing (used on page unload). */
  updateOnUnload(id: string, data: SnippetChanges) {
    const body = JSON.stringify(data);
    // keepalive requests are limited to 64 KB by browsers.
    if (body.length > 60_000) return;
    fetch(`/api/snippets/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => {});
  },
};
