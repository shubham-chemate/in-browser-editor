# UI Plan: Snippet Editor v2 shell

## 1. What this UI is for

One person opens a tab, pastes or picks a snippet, and **explains it, often on a screen recording**. That gives four design goals, in priority order:

1. **The code is the hero.** Chrome (sidebar, bars) is quiet, low-contrast and thin. Nothing competes with the code for attention on video.
2. **Instantly familiar.** Anyone who has used VS Code, Cursor or Zed should know where everything is without thinking.
3. **Zero friction.** New snippet, switch snippet, change language, find an error: each is one click or one shortcut, and there are no modal detours.
4. **Calm and trustworthy.** Saving is automatic and quietly confirmed. Errors are visible but never shouty.

## 2. What we borrow from the best editors

| Product | What works | What we take |
|---|---|---|
| **VS Code** | Activity bar, explorer, tabs, breadcrumbs, 22px status bar with *clickable* segments (Ln/Col → go to line, language → language picker, problems → problems). Quick-pick popovers with type-to-filter. | Clickable status-bar segments; quick-pick language picker (`Ctrl/Cmd+K M`); `Ctrl/Cmd+B` sidebar toggle; `Ctrl/Cmd+P` quick open; F2 rename; F8 next error. |
| **Cursor** | VS Code layout but calmer: neutral (not blue) status bar, softer borders, more whitespace, rounded hover states, muted section headers. | Neutral status bar. Rounded 6px hover/active rows. Uppercase 11px section labels with letter-spacing. |
| **Zed** | Dense but airy title bar with breadcrumbs and a few right-aligned icon buttons. Crisp 1px hairlines, no shadows except popovers. | A single 40px title bar (no separate toolbar) holding the sidebar toggle, breadcrumb title, language pill and actions. Hairline borders only. |
| **Sublime / Nova** | Strong file-type color cues in the sidebar. | Small colored language badges (`py`, `go`, `{}`) for scanning the list. |
| **Linear / Raycast** | Command-palette search, keyboard-first, great empty states. | Search field with `⌘P` hint. Friendly empty and no-results states. Toasts for "Copied". |

## 3. Layout

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ ▤  Snippets › server.go ✎                    [● Go ▾]  [⧉] [☾] [⋯]           │ ← title bar 40px
├────────────────┬─────────────────────────────────────────────────────────────┤
│ SNIPPETS  + ⇤  │                                                             │
│ ⌕ Search… ⌘P   │   1  package main                                           │
│ TODAY          │   2                                                         │
│ ▌go server.go  │   3  func main() {                                          │
│   py welcome   │   4      fmt.Println("hi"   ← tinted squiggle              │
│ EARLIER        │   5  }                                                      │
│   {} config    │                                                             │
│                │                                                             │
├────────────────┴─────────────────────────────────────────────────────────────┤
│ ⊗ 1  · Syntax check            ✓ Saved   Ln 4, Col 22   Spaces: 4   Go       │ ← status bar 24px
└──────────────────────────────────────────────────────────────────────────────┘
```

- Grid: `title bar (40px)` / `sidebar (default 264px, 200–420, resizable, collapsible) | editor` / `status bar (24px)`.
- The title bar spans the full width. The sidebar sits under it, like Zed and Cursor's unified title bar.
- Below 720px wide, the sidebar becomes an overlay drawer, opened with the title bar's sidebar button. It closes on selection or Escape.

## 4. Regions

### 4.1 Sidebar (Agent A: `ui/sidebar.ts`, `ui/sidebar.css`)
- **Header row (36px):** uppercase "SNIPPETS" label (11px, 600 weight, 0.06em tracking, muted), item count in faint text, and icon buttons for New (`+`, `Alt+N`) and Collapse sidebar.
- **Search:** input with a search icon and a `⌘P` / `Ctrl P` kbd hint on the right that hides while typing. `Ctrl/Cmd+P` focuses it from anywhere. It matches title and language. ↓/Enter moves from the search into the list. Escape clears it, then returns focus to the editor.
- **List:** grouped by recency (**Today**, **Yesterday**, **This week**, **Earlier**), with sticky group labels. Each row is 30–34px:
  - a colored language badge (from `ui/languageMeta.ts`), then the title (ellipsis).
  - relative time, right-aligned and faint ("2m", "3h", "5d"); hover shows a full date tooltip.
  - Active row: tinted background plus a 2px accent bar on the left. Hover: subtle background.
  - Hover or focus shows a trailing ⋯ button (Rename, Duplicate, Download, Delete).
  - **Rename inline** on double-click or F2 (Enter commits, Escape cancels).
- **Keyboard:** the list is a single tab stop (`role="listbox"`). ↑/↓ move, Enter opens, F2 renames, Delete deletes (with confirm).
- **States:** an empty state with an illustration-free message and a "New snippet" button, plus a no-matches state.
- **Resize:** drag handle on the right edge, plus double-click to reset. Width is remembered in localStorage.
- **Collapse:** `Ctrl/Cmd+B` or the header button. The collapsed state is remembered.

### 4.2 Title bar (Agent B: `ui/titlebar.ts`, `ui/titlebar.css`, `ui/languagePicker.ts`)
- **Left:** sidebar toggle icon button, then a breadcrumb `Snippets › <title>`. The title is click-to-edit: it looks like text until hover (subtle box) or focus (input with focus ring). Enter or blur commits, and Escape reverts. An empty title shows the "Untitled" placeholder.
- **Right:**
  - **Language pill:** language badge, name, chevron. It opens the **language quick-pick**, a popover anchored under the pill (VS Code "Select Language Mode" style) with these parts:
    - a search input at the top (autofocus)
    - a "Your languages" group, then "More"
    - badges, ✓ on the current language, and a faint "syntax check" or "highlight only" tag on each row
    - ↑/↓ to move, Enter to select, Escape to close
    - type-to-filter that matches name and extension
  - `Ctrl/Cmd+K` then `M` also opens the picker.
  - **Copy code** icon button: copies to the clipboard and shows a "Copied" toast.
  - **Theme toggle** (sun/moon).
  - **⋯ menu:** Rename, Duplicate, Download as file, Delete.
- **Save state** belongs in the status bar, not here.
- Icon buttons are 28×28 with a 16px icon, and every one has a tooltip (`title` plus `aria-label`).

### 4.3 Status bar (Agent C: `ui/statusbar.ts`, `ui/statusbar.css`)
- 24px tall with neutral background, 12px text and clickable segments with hover backgrounds, like VS Code.
- **Left:**
  - **Problems** shows `⊗ 0` in muted text, or `⊗ 2` in error color. Clicking jumps to the next error (`actions.nextError()`). The tooltip says "2 syntax errors · F8 to jump".
  - **Check mode** shows "Syntax check" with a shield-check icon, or "Highlight only" with a faint tooltip explaining what that means.
- **Right:**
  - **Save state:** `✓ Saved` (faint), `● Unsaved` (warn dot), `↻ Saving…`, or `⚠ Offline – retrying` (error).
  - `Ln 4, Col 22` (plus `(12 selected)` when there's a selection). Clicking runs `actions.gotoLine()`.
  - `Spaces: 4` or `Tab` (info only).
  - **Language name:** clicking opens the language picker (`actions.openLanguagePicker()`).
- Segments use `<button>`s with focus rings. At narrow widths, hide Spaces, then check mode.

### 4.4 Design system and editor canvas (Agent D: `tokens.css`, `theme.ts`, `ui/editor.css`, `ui/primitives.*`, `ui/icons.ts`)
- **Tokens** (in `tokens.css`, the single source):
  - neutral surfaces: `--surface-0` app background, `--surface-1` sidebar/bars, `--surface-2` popovers, `--editor-bg`
  - text: `--text`, `--text-muted`, `--text-faint`
  - lines and accent: `--border`, `--border-strong`, `--accent`, `--accent-soft`
  - status colors: `--danger`, `--warn`, `--ok`
  - interaction: `--hover`, `--active`, `--focus-ring`
  - shape and type: radii 4/6/8, spacing 4px grid, font sizes 11/12/13/14
  - motion: 120ms ease-out, disabled when `prefers-reduced-motion` is set
  - **Dark** is the default and is based on VS Code Dark Modern and One Dark (neutral greys, a blue accent). **Light** is based on VS Code Light Modern.
- **Editor:**
  - a monospace stack with an optionally self-hosted JetBrains Mono (`@fontsource`, offline). Font 14–15px, line-height 1.6.
  - subtle active-line highlight, faint gutter numbers (the active line number at full contrast)
  - matching bracket highlight, selection matches
  - thin overlay-style scrollbars
  - a lint tooltip styled like a VS Code hover card: icon, "Syntax error" heading, message, then a faint "F8 next error" hint.
  - the error range keeps the squiggle and a soft tint.
  - syntax colors tuned so both themes pass WCAG AA on their backgrounds.
- **Primitives:** `confirmDialog()` (accessible modal: focus trap, Escape, Enter), `toast()`, `menu()` (popover menu with keyboard navigation, used by the ⋯ menus), `tooltip` styling, buttons (`.btn`, `.icon-btn`), `kbd`.

## 5. Principles every component must follow
- **Hierarchy through contrast, not size.** Primary text is `--text`, secondary is `--text-muted`, tertiary is `--text-faint`. Never more than two weights on a row.
- **Hairlines, not boxes.** Use 1px `--border` separators. Shadows are only for floating layers (popovers, dialogs, toasts).
- **4px spacing grid.** Paddings are 4/6/8/12/16. Align everything to the baseline of the bars.
- **Every interactive element is a real `<button>`/`<input>`** with a visible `:focus-visible` ring, an `aria-label` for icons, and a tooltip with its shortcut.
- **Keyboard parity.** Anything you can click, you can do from the keyboard.
- **Motion is short and purposeful** (≤150ms) and respects `prefers-reduced-motion`.
- **Both themes are first-class.** Check every state in dark *and* light.
- **No layout shift:** status text changes must not move neighbors (fixed widths, `tabular-nums`).
- **Use only tokens.** No hard-coded colors in component CSS, except language badge colors from `languageMeta`.

## 6. Shortcuts (single source of truth)
| Shortcut | Action | Owner |
|---|---|---|
| Ctrl/Cmd+S | Save now | editor (exists) |
| Ctrl/Cmd+B | Toggle sidebar | sidebar |
| Ctrl/Cmd+P | Focus snippet search | sidebar |
| Alt+N | New snippet | sidebar |
| F2 | Rename current snippet | sidebar (in list) / title bar (global) |
| Ctrl/Cmd+K, M | Language picker | title bar |
| F8 / Shift+F8 | Next / previous error | editor (CodeMirror lint keymap) |
| Ctrl/Cmd+Alt+G | Go to line | editor (exists) |
| Escape | Close popover, menu or dialog | each |

## 7. Architecture contract (enables parallel work)
- `src/state.ts`: `Store<AppState>` (get/set/subscribe) plus the `AppActions` interface. The app controller (`main.ts`) owns it.
- Each region exports `mountX(root, store, actions)`, renders into its own mount point in `index.html`, and **only** touches DOM inside its root, plus popovers appended to `document.body`.
- Component CSS is scoped under the component root class (`.sidebar`, `.titlebar`, `.statusbar`). Only Agent D edits `tokens.css`. `icons.ts` and `languageMeta.ts` are append-only for others.
- Stable `data-testid`s (needed by the e2e test):
  - **sidebar:** `new-snippet`, `snippet-search`, `snippet-item` (+ `aria-selected`), `item-menu`
  - **title bar:** `title-input`, `language-button`, `language-search`, `language-option`, `theme-toggle`, `copy-code`, `more-menu`
  - **status bar:** `problems`, `check-mode`, `save-state`, `cursor-pos`, `indent`, `status-language`
  - **primitives:** `confirm-ok`, `confirm-cancel`, `toast`, `menu-item`

## 7a. Decisions made during the build
- **Contrast beats "faint":**
  - Small text that must be read ("Saved", "Highlight only") uses a muted/faint mix that passes AA, because `--text-faint` alone is about 3:1.
  - `--accent` is a fill color. Accent-colored text and icons use `--accent-fg`.
- **Syntax colors are tokens** (`--syn-*` in `tokens.css`), so the theme switch recolors code instantly and every color is checked for AA on `--editor-bg`.
- **Phone drawer state isn't persisted:** closing the sidebar drawer on a phone doesn't collapse it on desktop.
- **Status bar reserves widths** for the cursor and save segments. The small gap is intentional, so nothing jumps while you type.

- **No separate title bar (added later):** after tabs arrived, the breadcrumb repeated the active tab's title.
  - The top row is now `[sidebar toggle] [tabs…] [language ▾] [copy] [theme] [⋯]` at 36px, level with the sidebar header. That saves 40px of height.
  - Rename moved onto the tab: double-click, F2 or ⋯ → Rename.
  - The browser tab title follows the active snippet.

## 8. Acceptance (I review each agent against this)
1. Screenshots in dark **and** light, at 1280×760 and 390×780, look polished and consistent with the others.
2. No hard-coded colors, all tokens. Focus rings are visible. Everything works from the keyboard.
3. No console errors. `npm run build` (typecheck) passes, and existing unit tests pass.
4. Behavior is intact: autosave, language switching, errors, theme persistence.
