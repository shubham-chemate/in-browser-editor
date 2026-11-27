// Inline SVG icons (24x24 grid, 1.75 stroke, Lucide-like style, drawn here, no
// dependency). Append-only for UI agents: add new names, don't change existing ones.

const PATHS = {
  plus: '<path d="M12 5v14M5 12h14"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  sidebar: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/>',
  "chevron-down": '<path d="m6 9 6 6 6-6"/>',
  "chevron-right": '<path d="m9 6 6 6-6 6"/>',
  "chevrons-left": '<path d="m11 17-5-5 5-5M18 17l-5-5 5-5"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/>',
  moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>',
  more: '<circle cx="5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="19" cy="12" r="1.2"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/>',
  pencil: '<path d="M4 20h4L19 9a2.83 2.83 0 0 0-4-4L4 16v4z"/><path d="m13.5 6.5 4 4"/>',
  download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
  duplicate: '<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M4 16V5a1 1 0 0 1 1-1h11M14.5 11.5v6M11.5 14.5h6"/>',
  check: '<path d="m5 12 5 5 9-10"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  "circle-x": '<circle cx="12" cy="12" r="9"/><path d="m9 9 6 6M15 9l-6 6"/>',
  "alert-triangle": '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
  "shield-check": '<path d="M12 3 4.5 6v6c0 4.5 3.2 7.8 7.5 9 4.3-1.2 7.5-4.5 7.5-9V6L12 3z"/><path d="m9 12 2 2 4-4"/>',
  refresh: '<path d="M20 11a8 8 0 0 0-14.9-3.5M4 4v4h4M4 13a8 8 0 0 0 14.9 3.5M20 20v-4h-4"/>',
  code: '<path d="m9 7-5 5 5 5M15 7l5 5-5 5"/>',
  "file-code": '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9l-6-6z"/><path d="M14 3v6h6M10 13l-2 2 2 2M14 13l2 2-2 2"/>',
  cloud: '<path d="M7 18a5 5 0 0 1-.5-9.98A6 6 0 0 1 18 9a4.5 4.5 0 0 1 0 9H7z"/>',
  "cloud-off": '<path d="M3 3l18 18M8.5 8.2A5 5 0 0 0 7 18h10m3.4-1.6A4.5 4.5 0 0 0 18 9a6 6 0 0 0-8.3-3.3"/>',
  // sidebar agent
  "panel-left-close": '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16M16 10l-2 2 2 2"/>',
  // Status bar ("highlight only": no syntax checking for this language).
  "shield-off": '<path d="M7.4 4.8 12 3l7.5 3v6c0 1.7-.45 3.3-1.25 4.6M4.5 7.6V12c0 4.5 3.2 7.8 7.5 9 1.5-.4 2.9-1.1 4.1-2M3 3l18 18"/>',
  // design system (toasts, dialogs)
  "circle-check": '<circle cx="12" cy="12" r="9"/><path d="m8.5 12.5 2.5 2.5 4.5-5"/>',
  "circle-alert": '<circle cx="12" cy="12" r="9"/><path d="M12 7.5v5M12 16.5h.01"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.5h.01"/>',
} as const;

export type IconName = keyof typeof PATHS;

/** SVG markup for an icon. Uses currentColor; size in px. */
export function iconSvg(name: IconName, size = 16): string {
  return `<svg class="icon icon-${name}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${PATHS[name]}</svg>`;
}

/** An icon as a DOM element. */
export function icon(name: IconName, size = 16): SVGElement {
  const t = document.createElement("template");
  t.innerHTML = iconSvg(name, size);
  return t.content.firstElementChild as SVGElement;
}
