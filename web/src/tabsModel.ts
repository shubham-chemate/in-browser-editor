// Pure tab-list logic (no DOM), so it can be unit-tested.
// A tab list is an ordered array of snippet ids.

/** Open `id`: if it's already a tab, nothing changes; otherwise insert it right after `afterId` (or at the end). */
export function openTab(tabs: readonly string[], id: string, afterId: string | null): string[] {
  if (tabs.includes(id)) return [...tabs];
  const at = afterId ? tabs.indexOf(afterId) : -1;
  if (at < 0) return [...tabs, id];
  return [...tabs.slice(0, at + 1), id, ...tabs.slice(at + 1)];
}

/**
 * Close tabs. Returns the new list and which tab should be active:
 * the current one if it survived, else its right neighbour, else its left
 * neighbour (like VS Code), else null (no tabs left).
 */
export function closeTabs(
  tabs: readonly string[],
  closing: readonly string[],
  activeId: string | null,
): { tabs: string[]; active: string | null } {
  const gone = new Set(closing);
  const next = tabs.filter((t) => !gone.has(t));
  if (activeId && !gone.has(activeId) && next.includes(activeId)) return { tabs: next, active: activeId };
  const i = activeId ? tabs.indexOf(activeId) : -1;
  if (i >= 0) {
    for (let j = i + 1; j < tabs.length; j++) if (!gone.has(tabs[j])) return { tabs: next, active: tabs[j] };
    for (let j = i - 1; j >= 0; j--) if (!gone.has(tabs[j])) return { tabs: next, active: tabs[j] };
  }
  return { tabs: next, active: next[0] ?? null };
}

/** Move `id` to position `index` (clamped). */
export function moveTab(tabs: readonly string[], id: string, index: number): string[] {
  const from = tabs.indexOf(id);
  if (from < 0) return [...tabs];
  const rest = tabs.filter((t) => t !== id);
  const to = Math.max(0, Math.min(index, rest.length));
  return [...rest.slice(0, to), id, ...rest.slice(to)];
}

/** Tabs to the right of `id`. */
export function tabsRightOf(tabs: readonly string[], id: string): string[] {
  const i = tabs.indexOf(id);
  return i < 0 ? [] : tabs.slice(i + 1);
}

/** Restore a saved tab list: drop ids that no longer exist and duplicates. */
export function restoreTabs(saved: unknown, existing: ReadonlySet<string>): string[] {
  if (!Array.isArray(saved)) return [];
  const out: string[] = [];
  for (const id of saved) {
    if (typeof id === "string" && existing.has(id) && !out.includes(id)) out.push(id);
  }
  return out;
}

/**
 * Where a dragged tab lands: given the left edges and widths of the *other*
 * tabs (in order) and the dragged tab's centre x, return the insertion index.
 */
export function dropIndex(others: readonly { left: number; width: number }[], centerX: number): number {
  let i = 0;
  while (i < others.length && centerX > others[i].left + others[i].width / 2) i++;
  return i;
}
