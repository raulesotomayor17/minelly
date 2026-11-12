# Teoamoxtli — Design System

Adapted from **UI UX Pro Max v2.15** for a desktop Bible-study application. The
skill's automatic landing-page pattern was not applicable; the decisions below
were selected from its `style`, `ux`, `typography`, `icons`, and `react` domains.

## Product

- Desktop reading and study tool for local Bible modules.
- Primary audience: readers, students, pastors and researchers working for long
  sessions on a laptop or desktop.
- Primary tasks: read, navigate, compare, search, study a passage, save a layout.
- Platform: Tauri 2 desktop (Windows, Linux, macOS).

## Visual direction

- **Style:** Minimalism & Swiss Style adapted to a dark reading surface.
- **Density:** compact desktop (8–32 px spacing scale).
- **Motion:** subtle, 150–220 ms; respect `prefers-reduced-motion`.
- **Avoid:** landing-page sections, decorative gradients, emoji icons, shadows
  without purpose, and text wider than 75 characters.

## Tokens

| Token | Value | Use |
| --- | --- | --- |
| `--bg` | `#0B0F14` | Application background |
| `--panel` | `#11161D` | Panels and cards |
| `--panel-2` | `#151B24` | Inputs, secondary surfaces |
| `--border` | `#263041` | Structural borders |
| `--text` | `#E6EDF3` | Primary text |
| `--muted` | `#9AA7B8` | Secondary text |
| `--faint` | `#6F7D90` | Metadata |
| `--accent` | `#5B95FF` | Focus, selection, primary action |
| `--gold` | `#D6B36A` | Scripture references, overlines |
| `--danger` | `#E06C75` | Destructive actions |
| `--radius` | `8px` | Controls and cards |

## Typography

- Interface: **Inter**, 10–14 px, tabular numerals where useful.
- Scripture and long-form reading: **Literata** by default, 18.5 px base,
  1.68 line-height, user-adjustable from 0.8× to 1.45×. Alternatives: Crimson
  Pro, Cormorant Garamond, Libre Baskerville, Georgia.
- Study panel: **Crimson Pro** by default, 12.5–18.75 px, user-adjustable from
  0.8× to 1.5×. The font family is independent from the Bible text.
- Reading measure: `72ch` maximum.
- Titles: serif, 22–28 px; avoid all-caps for long headings.
- Fonts are bundled locally with Fontsource and never fetched at runtime.

## Layout rules

- Three-pane desktop workspace: navigation, reader, study panel.
- Navigation becomes a compact icon rail at narrow widths.
- Resource lists are hidden behind a disclosure (`Recursos`) by default.
- Study panel is resizable (280–560 px), collapsible, and can be hidden.
- Reader toolbar is sticky and remains reachable while scrolling.
- Page mode uses a fixed sheet with explicit previous/next controls.
- Book mode removes chapter/verse markers when `123` is off, while preserving
  chapter boundaries as whitespace.
- Workspaces persist Bible/commentary/dictionary, passage, mode, font, panel
  width, visibility and focus mode in `localStorage`.

## Modular canvas

- A recursive binary tree splits the viewport into panes.
- Split nodes store direction (`horizontal`/`vertical`) and a `ratio` between
  0.18 and 0.82.
- Pane state stores resource type, module id, link set and reference.
- Link sets `A` and `B` propagate reference changes to every pane in the same
  set; `none` keeps a pane independent.
- Pane actions: split, close, swap with next, change type/resource.
- Layouts are serialisable JSON and stored locally; export/import uses the
  native clipboard.
- The modular canvas is a full-screen overlay so it never competes with the
  classic reader chrome.

## Themes

- **Glassmorphism** is the signature theme: vibrant fluid gradients in `body`,
  translucent panels, illuminated 1 px borders, broad soft shadows, and
  `backdrop-filter: blur(15px) saturate(140%)` on the main surfaces.
- Blue, Gray, Green, and White themes use the same tokens with different
  palettes. White switches to `color-scheme: light` and dark text.
- Theme is persisted in `localStorage["teoamoxtli.theme"]`.
- Use the standard `backdrop-filter`; the `-webkit-` prefixed declaration was
  discarded by WebView2 and is intentionally omitted.
- Typography limits: reading 1.8×, study panel 2.2× (27.5 px at the current
  base size).

## Interaction rules

- Every icon-only control has `aria-label` and a `title`.
- Focus is always visible with a 2 px accent ring.
- Disclosure controls expose `aria-expanded`.
- Segmented controls use `aria-pressed` where appropriate.
- `prefers-reduced-motion` disables smooth scrolling and transitions.
- Minimum pointer target: 28–32 px on desktop; 40 px for primary actions.
- Panels never overlap content: the reader grid shrinks when the panel grows.

## Accessibility checklist

- [x] Text contrast against dark surfaces.
- [x] Visible focus for keyboard users.
- [x] Resizable/collapsible regions have labels.
- [x] No icon-only action without a name.
- [x] Reader text limited to 72ch.
- [x] Reduced-motion support.
- [ ] Full keyboard test of every workspace action.
- [ ] Screen-reader pass on Windows Narrator.
- [ ] Linux/macOS visual verification.

## Verification status

Windows x64 was built and exercised through the real Tauri app. Linux and macOS
remain untested; the CI matrix is prepared in `.github/workflows/build.yml`.
