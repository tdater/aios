# The Universe (Home)

Home is the universe, full screen, and the rest of AIOS is reached through it (the design is in `docs/universe-spec.md`). The first thing on Home is one picture of everything AIOS knows and every AI you use. It is a map, not decoration: every part
is something real, and clicking it tells you what it is and what you can do.

## What each part means

| You see | It is | What it tells you |
|---|---|---|
| The glowing centre | **You** | How many things AIOS remembers about you, how many are waiting for your yes, and whether learning is on. |
| Planets | **Your AIs** (Claude, Gemini, Perplexity, Antigravity) | What each one is allowed to be told, and how you reach it: Claude is connected through your own sign-in; the others work by copy and paste. |
| Rings | **How much each AI may be told** | Closer to you means it may be told more. Inner ring: public and private memories. Middle ring: only memories you marked public. Outer ring: nothing. Moving an AI to another ring is changing its sharing level. |
| Stars | **Memories** AIOS holds for you | Brighter means AIOS used it and a check then passed. Hollow means it was used but never confirmed by a check. Dim means it has not been reviewed for 90 days. |
| Star clusters | **Where a memory applies** | One cluster per project, plus "Everywhere" for things true across all your work. |
| Comets | **Things waiting for you** | Approvals, stuck work, and suggested memories to look over. Click one to open it. |
| A beam from a planet | **What that AI was told** | Pick an AI and a beam lights up to exactly the memories it would be told at its current level. |

Memories marked secret are never shown to any AI and never appear as stars with a title.

## Moving around

The default view is 3D and you can travel through it.

- Drag to look around. Shift-drag (or two-finger drag) slides the view. Mouse wheel or pinch zooms.
- Click anything to fly to it and open its details. Clicking the centre returns you.
- **Travel to** is a menu that does the same without any dragging.
- Keyboard: arrow keys turn, `+` and `-` zoom, `0` resets, `Escape` clears the selection. On-screen buttons do the same.
- **Spin** turns the whole scene slowly. **Flat map** switches to a simple 2D view; the choice is remembered.
- With "reduce motion" set in your system, flights are instant and nothing spins on its own.

Everything on the map is also a labelled, keyboard-operable button, so the page works without a mouse and with a screen reader.

## The cockpit (what Home is now)

- **Travel dock** (left): *You*, *The Fleet*, *The Star Fields*, *The Shipyards*, *Home Base*, *Mission Control*, each with the question it answers. Pressing one flies there.
- **Go to** (Ctrl+G) finds a region or any object by name. The **radar** (bottom right) is a small map of everything. The **breadcrumb** (top) says where you are.
- **Every object has a card** (`GET /universe/objects/{id}/card`): what it is in plain words, its settings in three levels (Basics, More, Expert), links to the older screens that go deeper, and **Replay arrival**. Changes that matter ask first, and the card offers **Undo**. Settings that live on this device (look, motion, offline copies) have a home on **You** and **Home Base** too, so nothing in Settings is homeless (a test checks this).
- **Deep links:** `#/home/o/<object id>` opens the universe at that object. `#/home/details` is the older Today and details page.
- **My Day** (top bar) is the dock of daily widgets. **Add a widget** opens the catalog (`docs/api-v1.md`, widgets): 19 ready-made panels, each with a plain name and a space-themed subtitle. Routines need Claude and say so; scheduled runs need their own switch.
- **List view** is the whole universe as text, grouped by region, for screen readers and for anyone who prefers it. Calm mode (or the system's reduced-motion setting) turns off drifting and arrival animations.
- **Arrivals:** when something new appears while you are looking (a probe, a memory cloud, an AI, a skill, a finding) it plays a short arrival and a caption says what it is. The first look is never animated. Skip ends it; an optional soft sound is off until you turn it on.
- **Drawing:** a procedural three.js renderer (no downloaded textures) when the browser supports WebGL 2, with a flat SVG version of the same scene otherwise. Both read one scene description (`core/scene.ts`), so labels, clicks and animations agree.

## What it does not do

It does not change anything by itself. Picking an AI shows its sharing level and lets you change it (a receipt is written);
picking a memory shows where it came from; picking a comet opens the screen where you decide. The map is rebuilt from what
AIOS stores (`GET /universe`) every few seconds, and when AIOS is paused it says so.

## Where it comes from

`apps/api/aios/universe.py` builds the data (stars, planets, comets) from the memory, sharing and approval records.
`apps/web/src/core/scene.ts` describes the whole universe (regions, objects, layout, orbits); `apps/web/src/gl/` draws it; `core/arrival.ts` and `core/travel.ts` hold the arrival and travel rules. `apps/web/src/core/space3d.ts` is a small dependency-free 3D engine (camera, projection, layout, depth sorting) with its own
tests; `apps/web/src/ui/Space3D.tsx` draws it as accessible SVG, and `apps/web/src/ui/Universe.tsx` is the flat map and the
detail panels.
