# Bridge: a first-person command center for Home

Status: draft for owner review (2026-11-07). Branch `feat-bridge`.

## Purpose

AIOS is a work tool, not a game. Today Home is a full-screen universe where the camera flies in third person to each
planet or object (`ui/Cockpit.tsx`). The Bridge replaces that as the default Home: the user stands on a ship bridge and
works from it. Immersion is the delivery method; the goal is the product goal in `docs/product-goal.md`.

Success test: from a cold start, within five seconds the user can tell what is running, what needs them, and what is
done, and can reach any project, answer a pending approval, and read test results without leaving the bridge.

Game ideas are borrowed only where they serve the UI (diegetic panels as information architecture, alert priority,
confirm-then-engage, short skippable transitions, keyboard/D-pad first, search and recents). Fake friction (fuel,
mass-lock), camera shake/roll and decoration with no job are excluded.

## Scope

In: new Bridge screen and its layout/camera logic, Blender-rendered bridge art, panels bound to existing data, warp
transition, phone/desktop/TV layouts, keyboard and reduced-motion support, toggle back to the old Cockpit.

Out: new backend features, note-taking features, sound beyond an optional later pass, full 3D bridge geometry,
look-around beyond a few degrees, gyro by default, AI-generated art, imagery from existing franchises.

## Approach: layered 2.5D

- **Stage.** One fixed-aspect stage (`object-fit: cover` style, with a safe area so key controls never crop). Layers back
  to front: live WebGL canvas (the existing renderer) behind a transparent window cutout in the bridge frame art;
  bridge frame layers (WebP/AVIF with alpha, at most 4-6); DOM/SVG panels on top.
- **Art.** Rendered by us in Blender from one blockout, so perspective and lighting agree across layers. Reference
  mood: the supplied holo-wall and window-over-console images. Licence and source recorded per file in
  `docs/assets/bridge/README.md`.
- **Controls are real DOM.** Buttons, lists, SVG hit areas: keyboard focus, `aria-label`, native hit-testing. No
  polygon hotspots over a flat image.
- **Camera.** The window shows the existing universe through the existing `Camera`, `project()` and `pickBody()`
  (`core/space3d.ts`, `core/travel.ts`), so labels, picking and deep links stay consistent. Bridge look-around is only
  a clamped parallax offset of the frame layers (pointer or drag), off on TV/car and under reduced motion.

## Panels (each is a real work surface)

| Area | Content (existing data) | Notes |
|---|---|---|
| Window | Live universe, destination labels | Where the warp plays |
| Holo-table "navigation computer" | Pinned/recent projects, Go to search, six regions, all `destinations()` | The single way in; reuses `goTo` and fuzzy search |
| Left wall "Ops" | Agent activity, runs in progress, Tests (pass/fail with real result lines) | Reuses Hud panel data |
| Right wall "Alerts" | Comets: approvals, blocked, review; plain-English approval cards, actionable here | Only place with strong red/amber and blinking |
| Console bank "Today" | My Day widgets, computer check-up, Changes and Outcomes summary | |
| Status strip | One line of global state; All Stop always reachable | |

A calm bridge means nothing is waiting. Alerts are the only blinking element.

## Flow

Select a destination on the holo-table (or window label), the holo card appears, press Engage (confirm). The window
does a skippable push-in of about 1.5 s (dolly only, no roll, flash masks the object swap); the bridge frame stays
still. Arrival parks in the existing orbit view of that object and opens its `ObjectCard`. Deep links
(`#/home/o/<id>`) go straight to the arrived state. Reduced motion or Esc: crossfade.

## Layouts and input

- Desktop: full stage with parallax.
- Phone portrait (<600 px via `layoutFor`): window on top, panels as stacked cards/bottom sheets, no parallax.
- TV and car: landscape, targets of at least 48 px, ten-foot text, deterministic D-pad focus order, no hover
  dependence, no parallax.
- Keys: arrows move focus along a fixed order, Enter engages, Esc backs out, 1-6 regions, 0 reset, Ctrl+K and
  Ctrl+G as today. Visible focus ring.
- Simple mode keeps its four anchors; the Bridge shows a reduced layout (window, holo-table, Alerts) and adds nothing
  else.

## Fallbacks and settings

- WebGL unavailable or software GPU: the existing flat SVG field replaces the window canvas; the bridge frame and
  panels still work. A static frame image is used on very low-end devices.
- Setting "Home view": Bridge (default) or Classic cockpit. The classic Cockpit stays intact.
- Pause the WebGL loop when the tab is hidden; cap device pixel ratio at 1.5.

## Architecture

New code under `apps/web/src/bridge/`:
- `layout.ts`: pure; stage safe-area math, panel placement per layout, D-pad focus order.
- `parallax.ts`: pure; clamped offset from pointer/drag, disabled flags.
- `warp.ts`: pure; transition timeline (phases, duration, skip), reduced-motion variant.
- `Bridge.tsx`: composes stage, window, panels; owns selection and engage state.
- `panels/`: `HoloTable.tsx`, `OpsWall.tsx`, `AlertsWall.tsx`, `TodayBank.tsx`, `StatusStrip.tsx`.
Routing stays in `ui/hooks.ts`; `App.tsx` renders Bridge or Cockpit by setting. Styling in `styles.css` using the
existing tokens and `.glass`/`.hud-panel` classes. Art in `apps/web/public/bridge/`.

## Testing

- Unit: layout, parallax clamping and disabling, warp timeline, D-pad order.
- Component (vitest/jsdom, `fakeServer`, `setWidth`): every `destinations()` entry reachable by button or list;
  Engage requires confirm; approvals actionable from Alerts; reduced-motion path; phone/desktop/TV layouts; deep-link
  arrival; setting toggles to Classic.
- Browser: extend the Playwright e2e (Edge) for keyboard-only travel and a screenshot of each layout; check the
  window cutout aligns with the canvas at extreme aspect ratios (phone portrait, ultrawide).
- Gates: `npm test`, `npm run build` (tsc), backend `pytest` unchanged. Not verifiable here: real phone, TV, car head
  unit, and low-end Android WebView; a hardware test procedure will be provided.

## Risks

- Flat layers can read as cardboard; mitigated by rendering from one 3D blockout and keeping parallax small.
- CSS 3D/parallax inconsistencies on Android WebView; test on a low-end device before final art.
- Layer misalignment across aspect ratios; fixed stage with safe area and extreme-ratio tests.
- Motion comfort; small clamped ranges, dolly only, reduced-motion respected.
- Art licensing; own renders only, per-file record.

## Open questions (defaults chosen, owner may override)

- Art mood: holo wall centre plus a big window over a console bank (blend of the two supplied references).
- Sound: deferred to a later optional pass.
