# AIOS v0.5.0 Master Proposal: UI, Aesthetics & Everyday Command Center Blueprint

> **Notice for Claude Code**: This document provides an exhaustive, actionable blueprint for upcoming UI overhauls, aesthetic improvements, and everyday user features for AIOS. It contains exact CSS rules, JSX structures, architectural boundaries, and implementation sequences conforming strictly to [CLAUDE.md](file:///c:/aios/CLAUDE.md) (local-first, loopback only, zero paid APIs, safety controls as code, full test suite preservation).

---

## Table of Contents
1. [Vision & Design Principles](#1-vision--design-principles)
2. [Left Travel Dock & Right HUD Telemetry (Immediate UI Standout)](#2-left-travel-dock--right-hud-telemetry-immediate-ui-standout)
3. [Everyday Command Center ("Single Pane of Glass" for All Users)](#3-everyday-command-center-single-pane-of-glass-for-all-users)
4. [Interactive 3D Canvas & WebGL Innovations](#4-interactive-3d-canvas--webgl-innovations)
5. [Mind Map & Graph Constellation Enhancements](#5-mind-map--graph-constellation-enhancements)
6. [Voice Brain-Dump & Sub-Tactile Web Audio Feedback](#6-voice-brain-dump--sub-tactile-web-audio-feedback)
7. [Universal Mobile, Android TV & Ambient Dashboard Mode](#7-universal-mobile-android-tv--ambient-dashboard-mode)
8. [Step-by-Step Implementation Roadmap for Claude Code](#8-step-by-step-implementation-roadmap-for-claude-code)

---

## 1. Vision & Design Principles

### The Problem
AIOS currently excels as an agent-assisted development operating system for technical tasks, but:
1. **Visual Prominence**: The standout color accents and deep HUD glass panels implemented in `styles.css` can be pushed further to create a truly unforgettable, sci-fi mission-control first impression.
2. **Everyday Utility**: For average, non-technical users (household management, personal goals, daily dispatch, document translation), Git commits and worktrees feel intimidating.
3. **The Solution**: Transform AIOS into a **dual-purpose personal command center**: a stunning, tactile, local-first cockpit where anyone can track routines, organize family records, dissect confusing documents, and manage life goals—while power users retain all their coding superpowers.

### Core Architectural Guardrails
- **Local-First & Loopback Only**: All processing stays on the local machine (`http://127.0.0.1:8765`).
- **Zero Paid API Usage**: Zero secret keys stored; all LLM operations route through unmodified local Claude CLI (`claude.ai` subscriber session) or local offline models.
- **Safety as Code**: Reversible actions execute freely; irreversible/destructive actions mandate explicit on-screen user approval.
- **Preserve All Test Suites**: Must maintain 100% pass rate across backend pytest (~619 tests) and frontend vitest (~609 tests).

---

## 2. Left Travel Dock & Right HUD Telemetry (Immediate UI Standout)

The user specifically requested that the standout styling and vibrant color scheme for the left dock ("You", "The Fleet", etc.) and right-side HUD panels be clearly detailed, enhanced, and verified for implementation.

### 2.1 Left Travel Dock Enhancements

Each region of the universe has a distinct spatial and emotional purpose. The left dock buttons in `apps/web/src/ui/Cockpit.tsx` must visually announce these identities with high-contrast glowing accents, gradient backdrops, and interactive states.

#### Color System by Region:
| Region ID | Name | Theme Accent | Visual Meaning & Color Code |
| :--- | :--- | :--- | :--- |
| `sun` | **You** | Solar Gold | Primary anchor, identity, personal sun (`#ffbe0b` to `#fb5607`) |
| `fleet` | **The Fleet** | Electric Cyan | Active AI agents and companions (`#00f5d4` to `#00bbf9`) |
| `stars` | **Deep Space** | Cosmic Violet | Long-term memory, knowledge, archives (`#c77dff` to `#7b2cbf`) |
| `yards` | **Shipyards** | Industrial Amber | Projects, builds, active worktrees (`#ff9e00` to `#ff5400`) |
| `home` | **Living Orbit** | Emerald Mint | Daily routines, habits, living probes (`#38ef7d` to `#11998e`) |
| `control` | **Mission Control** | Tactical Ruby | Inboxes, approvals, pending decisions (`#ff0054` to `#9e0059`) |

#### Component Structure (`apps/web/src/ui/Cockpit.tsx`):
Ensure the dock button markup retains numeric hotkey shortcuts (`1` to `6`) and rich content hierarchy:

```tsx
<nav className="dock" aria-label="Travel to a region">
  {REGIONS.map((r, idx) => (
    <button
      key={r.id}
      type="button"
      className={`dock-btn dock-${r.id} ${region === r.id ? "on" : ""}`}
      aria-current={region === r.id ? "true" : undefined}
      title={`${r.name}: ${r.question} (Press ${idx + 1})`}
      onClick={() => travelTo(r.id)}
    >
      <span className="dock-accent" aria-hidden="true" />
      <span className="dock-body">
        <span className="dock-row">
          <span className="dock-name">{r.name}</span>
          <kbd className="dock-num">{idx + 1}</kbd>
        </span>
        <span className="dock-q">{r.question}</span>
      </span>
    </button>
  ))}
</nav>
```

#### Enhanced CSS for `apps/web/src/styles.css`:
```css
/* ==========================================================================
   ENHANCED COCKPIT DOCK: VIBRANT REGION IDENTITIES & MICRO-INTERACTIONS
   ========================================================================== */
.cockpit .dock {
  position: absolute;
  left: 12px;
  top: 54px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  z-index: 5;
  width: min(220px, calc(100% - 24px));
  pointer-events: none;
}
.cockpit .dock > * { pointer-events: auto; }

.cockpit .dock button.dock-btn {
  position: relative;
  display: flex;
  align-items: stretch;
  text-align: left;
  background: rgba(5, 12, 28, 0.78);
  color: #e8eefc;
  border: 1px solid rgba(143, 180, 255, 0.22);
  border-radius: 12px;
  padding: 0;
  cursor: pointer;
  overflow: hidden;
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  box-shadow: 0 4px 18px rgba(0, 4, 14, 0.45);
  transition: transform .18s cubic-bezier(0.2, 0.8, 0.2, 1),
              border-color .18s ease,
              box-shadow .18s ease,
              background .18s ease;
}
.cockpit .dock button.dock-btn:hover {
  transform: translateX(4px);
  background: rgba(10, 22, 48, 0.90);
  box-shadow: 0 6px 22px rgba(0, 4, 14, 0.6);
}
.cockpit .dock button.dock-btn:focus-visible {
  outline: 2px solid #5ee2d6;
  outline-offset: 2px;
}

.cockpit .dock-accent {
  width: 5px;
  flex: none;
  background: rgba(143, 180, 255, 0.4);
  transition: width .18s ease, box-shadow .18s ease;
}
.cockpit .dock-body {
  padding: 8px 12px;
  flex: 1;
  min-width: 0;
}
.cockpit .dock-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.cockpit .dock-name {
  font-size: 13.5px;
  font-weight: 600;
  letter-spacing: 0.02em;
  line-height: 1.2;
}
.cockpit .dock-num {
  font-size: 10px;
  font-family: var(--font-mono, monospace);
  opacity: 0.5;
  background: rgba(255, 255, 255, 0.08);
  padding: 1px 4px;
  border-radius: 4px;
  border: 1px solid rgba(255, 255, 255, 0.12);
}
.cockpit .dock-q {
  display: block;
  font-size: 11px;
  opacity: 0.72;
  margin-top: 3px;
  line-height: 1.25;
}

/* Region: Sun (Solar Gold) */
.cockpit .dock button.dock-sun .dock-accent { background: linear-gradient(180deg, #ffbe0b, #fb5607); }
.cockpit .dock button.dock-sun:hover { border-color: rgba(255, 190, 11, 0.65); box-shadow: 0 0 18px rgba(255, 190, 11, 0.28); }
.cockpit .dock button.dock-sun.on {
  border-color: #ffbe0b;
  background: rgba(32, 20, 4, 0.92);
  box-shadow: 0 0 20px rgba(255, 190, 11, 0.45);
  transform: translateX(6px);
}
.cockpit .dock button.dock-sun.on .dock-accent { width: 7px; box-shadow: 0 0 12px #ffbe0b; }
.cockpit .dock button.dock-sun .dock-name { color: #ffe28a; }

/* Region: Fleet (Electric Cyan) */
.cockpit .dock button.dock-fleet .dock-accent { background: linear-gradient(180deg, #00f5d4, #00bbf9); }
.cockpit .dock button.dock-fleet:hover { border-color: rgba(0, 245, 212, 0.65); box-shadow: 0 0 18px rgba(0, 245, 212, 0.28); }
.cockpit .dock button.dock-fleet.on {
  border-color: #00f5d4;
  background: rgba(4, 30, 36, 0.92);
  box-shadow: 0 0 20px rgba(0, 245, 212, 0.45);
  transform: translateX(6px);
}
.cockpit .dock button.dock-fleet.on .dock-accent { width: 7px; box-shadow: 0 0 12px #00f5d4; }
.cockpit .dock button.dock-fleet .dock-name { color: #94fdf0; }

/* Region: Stars (Cosmic Violet) */
.cockpit .dock button.dock-stars .dock-accent { background: linear-gradient(180deg, #c77dff, #7b2cbf); }
.cockpit .dock button.dock-stars:hover { border-color: rgba(199, 125, 255, 0.65); box-shadow: 0 0 18px rgba(199, 125, 255, 0.28); }
.cockpit .dock button.dock-stars.on {
  border-color: #c77dff;
  background: rgba(28, 8, 44, 0.92);
  box-shadow: 0 0 20px rgba(199, 125, 255, 0.45);
  transform: translateX(6px);
}
.cockpit .dock button.dock-stars.on .dock-accent { width: 7px; box-shadow: 0 0 12px #c77dff; }
.cockpit .dock button.dock-stars .dock-name { color: #e2b6ff; }

/* Region: Shipyards (Industrial Amber) */
.cockpit .dock button.dock-yards .dock-accent { background: linear-gradient(180deg, #ff9e00, #ff5400); }
.cockpit .dock button.dock-yards:hover { border-color: rgba(255, 158, 0, 0.65); box-shadow: 0 0 18px rgba(255, 158, 0, 0.28); }
.cockpit .dock button.dock-yards.on {
  border-color: #ff9e00;
  background: rgba(38, 18, 3, 0.92);
  box-shadow: 0 0 20px rgba(255, 158, 0, 0.45);
  transform: translateX(6px);
}
.cockpit .dock button.dock-yards.on .dock-accent { width: 7px; box-shadow: 0 0 12px #ff9e00; }
.cockpit .dock button.dock-yards .dock-name { color: #ffd180; }

/* Region: Home / Living (Emerald Mint) */
.cockpit .dock button.dock-home .dock-accent { background: linear-gradient(180deg, #38ef7d, #11998e); }
.cockpit .dock button.dock-home:hover { border-color: rgba(56, 239, 125, 0.65); box-shadow: 0 0 18px rgba(56, 239, 125, 0.28); }
.cockpit .dock button.dock-home.on {
  border-color: #38ef7d;
  background: rgba(6, 32, 22, 0.92);
  box-shadow: 0 0 20px rgba(56, 239, 125, 0.45);
  transform: translateX(6px);
}
.cockpit .dock button.dock-home.on .dock-accent { width: 7px; box-shadow: 0 0 12px #38ef7d; }
.cockpit .dock button.dock-home .dock-name { color: #a3f7c4; }

/* Region: Control / Mission (Tactical Ruby) */
.cockpit .dock button.dock-control .dock-accent { background: linear-gradient(180deg, #ff0054, #9e0059); }
.cockpit .dock button.dock-control:hover { border-color: rgba(255, 0, 84, 0.65); box-shadow: 0 0 18px rgba(255, 0, 84, 0.28); }
.cockpit .dock button.dock-control.on {
  border-color: #ff0054;
  background: rgba(42, 4, 16, 0.92);
  box-shadow: 0 0 20px rgba(255, 0, 84, 0.45);
  transform: translateX(6px);
}
.cockpit .dock button.dock-control.on .dock-accent { width: 7px; box-shadow: 0 0 12px #ff0054; }
.cockpit .dock button.dock-control .dock-name { color: #ff80a6; }
```

---

### 2.2 Right-Side HUD Telemetry & Mission Panels

The right HUD in `apps/web/src/ui/Hud.tsx` houses telemetry tiles, system health status, and the real-time ship's log.

#### Enhanced CSS for `apps/web/src/styles.css`:
```css
/* ==========================================================================
   RIGHT-SIDE HUD: TELEMETRY TILES & FROSTED GLASS PANELS
   ========================================================================== */
.cockpit .hud {
  position: absolute;
  right: 12px;
  top: 54px;
  width: min(320px, calc(100% - 240px));
  display: grid;
  gap: 10px;
  z-index: 5;
  max-height: calc(100% - 190px);
  overflow-y: auto;
  padding-right: 2px;
}
.cockpit .hud::-webkit-scrollbar { width: 4px; }
.cockpit .hud::-webkit-scrollbar-thumb { background: rgba(143, 180, 255, 0.2); border-radius: 4px; }

/* Telemetry stat tiles (grid of 2) */
.cockpit .tiles {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}
.cockpit .tile {
  position: relative;
  text-align: left;
  background: linear-gradient(145deg, rgba(8, 18, 40, 0.88) 0%, rgba(4, 10, 24, 0.78) 100%);
  border: 1px solid rgba(94, 226, 214, 0.24);
  border-radius: 12px;
  padding: 10px 12px;
  color: inherit;
  cursor: pointer;
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  overflow: hidden;
  box-shadow: 0 4px 18px rgba(0, 4, 14, 0.45);
  transition: transform .18s ease, border-color .18s ease, box-shadow .18s ease;
}
.cockpit .tile:hover {
  transform: translateY(-2px);
  border-color: rgba(94, 226, 214, 0.6);
  box-shadow: 0 6px 22px rgba(94, 226, 214, 0.22);
}
.cockpit .tile-glow {
  position: absolute;
  top: -14px;
  right: -14px;
  width: 44px;
  height: 44px;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(94, 226, 214, 0.28) 0%, transparent 70%);
  pointer-events: none;
}
.cockpit .tile-label {
  display: block;
  font-size: 10.5px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  font-weight: 600;
  color: #9cb8e8;
}
.cockpit .tile-value {
  display: block;
  font-size: 28px;
  font-weight: 700;
  line-height: 1.15;
  margin-top: 4px;
  font-variant-numeric: tabular-nums;
  font-family: var(--font-sans, system-ui);
}

/* Status colors for tiles */
.cockpit .tile.warn { border-color: rgba(255, 200, 87, 0.55); }
.cockpit .tile.warn .tile-glow { background: radial-gradient(circle, rgba(255, 200, 87, 0.38) 0%, transparent 70%); }
.cockpit .tile.warn .tile-value { color: #ffc857; text-shadow: 0 0 12px rgba(255, 200, 87, 0.4); }

.cockpit .tile.bad { border-color: rgba(255, 93, 108, 0.6); }
.cockpit .tile.bad .tile-glow { background: radial-gradient(circle, rgba(255, 93, 108, 0.45) 0%, transparent 70%); }
.cockpit .tile.bad .tile-value { color: #ff5d6c; text-shadow: 0 0 14px rgba(255, 93, 108, 0.45); }

.cockpit .tile.ok { border-color: rgba(62, 224, 160, 0.45); }
.cockpit .tile.ok .tile-glow { background: radial-gradient(circle, rgba(62, 224, 160, 0.35) 0%, transparent 70%); }
.cockpit .tile.ok .tile-value { color: #3ee0a0; text-shadow: 0 0 12px rgba(62, 224, 160, 0.35); }

/* Mission HUD glass panels */
.cockpit .hud-panel {
  background: linear-gradient(160deg, rgba(8, 18, 40, 0.90) 0%, rgba(3, 8, 20, 0.82) 100%);
  border: 1px solid rgba(94, 226, 214, 0.25);
  border-radius: 14px;
  padding: 12px 14px;
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  box-shadow: 0 6px 24px rgba(0, 4, 14, 0.5), inset 0 1px 0 rgba(143, 180, 255, 0.18);
}
.cockpit .glass-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
  padding-bottom: 6px;
  border-bottom: 1px solid rgba(143, 180, 255, 0.12);
}
.cockpit .glass-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #3ee0a0;
  box-shadow: 0 0 8px #3ee0a0;
  flex: none;
}
.cockpit .glass-dot.log-dot {
  background: #5ee2d6;
  box-shadow: 0 0 8px #5ee2d6;
}
.cockpit .hud-panel h2 {
  margin: 0;
  font-size: 11px;
  letter-spacing: .12em;
  text-transform: uppercase;
  color: #b4cdfc;
  font-weight: 700;
}

/* Systems List */
.cockpit .systems {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 3px;
  font-size: 12px;
}
.cockpit .systems button {
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  background: transparent;
  border: 0;
  border-radius: 6px;
  color: inherit;
  text-align: left;
  padding: 5px 8px;
  cursor: pointer;
  transition: background .15s ease;
}
.cockpit .systems button:hover {
  background: rgba(94, 226, 214, 0.12);
}
.cockpit .systems .dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex: none;
  box-shadow: 0 0 6px currentColor;
}
.cockpit .systems .muted {
  margin-left: auto;
  font-size: 11px;
  opacity: 0.72;
}

/* Ship's Log (Activity Feed) */
.cockpit .shiplog {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 4px;
  font-size: 12px;
}
.cockpit .shiplog li {
  padding: 4px 6px;
  border-radius: 6px;
  transition: background .15s ease;
  line-height: 1.35;
}
.cockpit .shiplog li:hover {
  background: rgba(143, 180, 255, 0.08);
}
.cockpit .log-time {
  font-family: var(--font-mono, monospace);
  font-size: 10.5px;
  color: #7cb1ff;
  background: rgba(143, 180, 255, 0.12);
  padding: 1px 5px;
  border-radius: 4px;
  margin-right: 5px;
  display: inline-block;
}
.cockpit .log-summary {
  color: #dce5fa;
}
```

---

## 3. Everyday Command Center ("Single Pane of Glass" for All Users)

To make AIOS immensely appealing to individuals, families, and everyday users who aren't writing software, implement these high-value capabilities:

### 3.1 Life Missions & Personal Goals (`apps/web/src/screens/Projects.tsx`)
Average users don't think in git commits or worktrees. They think in **Missions**: "Renovate the Kitchen", "Plan Summer Vacation", "Organize Tax Returns", "Complete Marathon Training".

- **Dual Persona Selector**:
  - Add a pill toggle at the top of the Projects screen: `[ 🛠 Developer Projects | 🎯 Life Missions ]`.
  - In **Life Missions mode**:
    - Each mission card displays: Title, Target Date, Progress Bar (% completed checklists), Next Action Step, and Attached Notes.
    - 1-click "Add Step" or "Mark Step Complete" right from the dashboard.
    - AIOS assists by breaking down ambiguous goals (e.g., "Prep for DMV visit") into concrete checklists and required documents.

### 3.2 Household & Personal Vault Starter Pack (`apps/web/src/screens/Knowledge.tsx`)
Extend the Knowledge Vault beyond ad-hoc markdown notes by offering structured, 1-click **Household Templates**:

1. **Appliance & Warranty Card**:
   - Model #, serial #, purchase date, manual link/PDF, warranty expiration date.
2. **Vehicle Service Record**:
   - VIN, mileage log, oil change interval, tire size, mechanic notes.
3. **Doctor & Health Diary**:
   - Physician contacts, recurring prescriptions, vaccination dates, allergen list.
4. **Subscription & Recurring Bill Audit**:
   - Monthly cost, renewal date, cancellation URL, shared family members.
5. **Emergency Action Card**:
   - Water main shutoff location, electrical breaker notes, emergency numbers, insurance policy IDs.

#### Scrapbook / Card-Grid View:
Add a view switcher in `Knowledge.tsx`:
- `[ ☰ List Explorer | ▦ Scrapbook Grid ]`
- Scrapbook Grid displays cards with color-coded tags, preview snippets, and quick action buttons ("Edit", "Preview", "Copy").

### 3.3 Daily Dispatch: Morning Briefing & Evening Wrap-up
Build upon the `MyDay` component to provide daily bookends:

- **Morning Dispatch**:
  - Automatically pops up on first launch of the day (or via `MyDay`).
  - Summarizes:
    - 3 key priorities for today.
    - Habits due (water, meds, workout, review).
    - AI-suggested memory refresher ("1 year ago today, you completed: ...").
  - Spoken aloud via the existing local Web Speech API synthesis button if voice is enabled.
- **Evening Wrap-up**:
  - Accessible at day's end:
    - Review completed tasks with celebratory checkmarks.
    - 1-click "Move unfinished items to tomorrow".
    - Streak updates for living probe habits.

### 3.4 Document Squeezer & Scam Detective ("Second Opinion")
A dedicated tool card inside `Workspace.tsx` or `Ask.tsx`:
- **Document Squeezer**:
  - User pastes dense legal terms, insurance claims, medical bills, or rental agreements.
  - Returns a 3-part structured breakdown:
    1. *The 30-Second Summary* (plain words, zero jargon).
    2. *Hidden Gotchas or Deadlines* (dates, cancellation fees, rate hikes).
    3. *Recommended Next Action* (e.g., "Ask for itemized billing").
- **Scam Detective ("Second Opinion")**:
  - User pastes a suspicious SMS, email, or urgent message.
  - Checks against phishing heuristics (urgency pressure, mismatched sender domain, gift-card demands).
  - Wording adheres to project rule: **"Looks like a scam"** rather than declaring absolute safety.

---

## 4. Interactive 3D Canvas & WebGL Innovations

The Three.js/WebGL space canvas in `apps/web/src/ui/UniverseGL.tsx` is AIOS's signature aesthetic. Enhance it with dynamic environmental life:

### 4.1 Living Probe Habit Celebrations
In `Cockpit.tsx`, when the user checks off a habit or routine in `MyDay`:
- Emit an event to `UniverseGL.tsx`.
- The corresponding probe in orbit fires a momentary **supernova twinkle / particle burst** (30 golden starlight particles bursting and fading over 1.2s).
- Creates an immediate, delightful psychological reward for completing daily tasks.

### 4.2 Cinematic "Zen Orbit" Ambient Screensaver
- When the Cockpit has had zero user input for 90 seconds (and reduced motion is not requested):
  - Slowly drift the camera into a smooth, cinematic orbital pan around the Sun and Fleet.
  - Any keypress or mouse movement immediately returns camera control to the user with a gentle ease.

### 4.3 3D Spatial Compass Gyroscope
Enhance the 2D compass widget (`apps/web/src/ui/Cockpit.tsx` line 238) with pitch/yaw horizon indicators:
- Shows artificial horizon line and pitch angle.
- Clicking the compass levels the camera to 0° pitch and points directly at the Sun.

---

## 5. Mind Map & Graph Constellation Enhancements

`apps/web/src/screens/Graph.tsx` and `apps/web/src/ui/GraphView.tsx` currently render a force-directed network. Upgrade it with:

### 5.1 Radial Mind-Map Mode
Add a layout selector toggle to the Graph toolbar:
- `[ 🕸 Force Physics | ☸ Radial Mind-Map ]`
- In **Radial Mind-Map mode**:
  - Centers on the selected node or primary hub (e.g., "Personal Life", "Projects", "Finances").
  - Arranges 1st-degree neighbors in an inner ring and 2nd-degree neighbors in an outer orbital ring.
  - Eliminates visual clutter and produces an intuitive, readable concept tree.

### 5.2 Frosted Glass Hover Previews
- When hovering any node in the graph:
  - Display a floating frosted glass card (`.graph-preview-card`) positioned near the node.
  - Displays: Note title, type badge, word count, excerpt of first 120 characters, and linked tags.
  - Clicking navigates directly to the note.

### 5.3 Story Constellation Lines
- When filtering by a tag (e.g., `#trip-2026` or `#house-hunt`), render a glowing connected constellation path tracing the notes chronologically by `created_at`.

---

## 6. Voice Brain-Dump & Sub-Tactile Web Audio Feedback

### 6.1 Voice Brain-Dump Mode
Expand on the push-to-talk voice input:
- The user holds the microphone button and speaks continuously for up to 60 seconds:
  > *"Remember to order replacement air filters for the HVAC, pay the quarterly car insurance by Friday, and write down a note that Dr. Smith recommended 500mg vitamin C."*
- AIOS parses the transcript and presents a single structured approval card:
  - 1 Task created: "Pay quarterly car insurance (Due: Friday)".
  - 1 Habit/Todo: "Order HVAC air filters".
  - 1 Knowledge Note: "Medical Note: Dr. Smith recommendation".
- The user taps **"Accept All"** or edits individual items before saving.

### 6.2 Sub-Tactile Web Audio Feedback (0 External Assets)
Create a lightweight audio utility (`apps/web/src/ui/sound.ts`) using the native browser **Web Audio API** (synthesized waveforms, 0 KB external file size, zero network requests):
- `playChime()`: A high, warm sinusoidal chime (523 Hz -> 659 Hz) played when a task or habit is marked complete.
- `playWarp()`: A subtle, low-pass frequency sweep (120 Hz -> 80 Hz) on region travel.
- `playTick()`: A faint 20ms mechanical tick when clicking HUD buttons.
- Fully respectful of user preferences:
  - Disabled by default or easily toggled via a speaker icon in the Cockpit topbar and in Settings.
  - Obeys `settings.reduceMotion` and system mute.

---

## 7. Universal Mobile, Android TV & Ambient Dashboard Mode

AIOS runs on everything from phones to wall-mounted screens:

### 7.1 Mobile & Phone Ergonomics
- **Bottom-Sheet Object Cards**: On viewports `< 700px`, `ObjectCard.tsx` renders as a swipeable bottom sheet with a top grab handle (`border-radius: 20px 20px 0 0`).
- **Thumb-Friendly Bottom Dock**: The region dock shifts into a horizontal swipeable pill bar at the bottom above the system navigation bar.

### 7.2 Android TV & Ambient Wall Display Mode
- **Leanback Mode** (`#ambient` or route query `?mode=ambient`):
  - Large 32px+ high-contrast typography readable from 10 feet away.
  - Auto-rotates every 30 seconds between:
    1. *Today's Mission & Routines*
    2. *Systems Telemetry & Weather/Health*
    3. *Family Knowledge Spotlight (Random memory card)*
  - Full D-Pad navigation support (`ArrowUp`, `ArrowDown`, `ArrowLeft`, `ArrowRight`, `Enter`, `Back`).

---

## 8. Step-by-Step Implementation Roadmap for Claude Code

When Claude Code executes this plan, follow this exact sequence:

### Step 1: Verify Current Test Baseline
```powershell
.venv\Scripts\python.exe -m pytest
cd apps\web; npm test; npm run build
```
Verify that all ~619 pytest and ~609 vitest tests pass before modifying any files.

### Step 2: Implement Dock & HUD Styling Enhancements
- **Target Files**:
  - `apps/web/src/ui/Cockpit.tsx`: Add numeric hotkey badges (`<kbd className="dock-num">`) to the travel dock buttons.
  - `apps/web/src/styles.css`: Incorporate the enhanced dock colors (`.dock-sun`, `.dock-fleet`, `.dock-stars`, `.dock-yards`, `.dock-home`, `.dock-control`) and HUD glass panels (`.cockpit .tiles`, `.cockpit .tile-glow`, `.cockpit .hud-panel`) detailed in Section 2.
- **Verification**: Run `npm run build` and visual inspection in browser.

### Step 3: Implement Web Audio Synthesizer
- **Target Files**:
  - `apps/web/src/core/sound.ts`: Create synthesized Web Audio sound triggers (`chime`, `warp`, `click`, `alert`).
  - Wire to `Cockpit.tsx` region travel, `MyDay.tsx` task completion, and Settings toggle.

### Step 4: Implement Life Missions Persona in Projects
- **Target Files**:
  - `apps/web/src/screens/Projects.tsx`: Add `[Developer | Life Missions]` toggle. Render non-technical goal cards with progress bars and milestones.
  - Add test in `apps/web/src/screens/projects.test.tsx`.

### Step 5: Implement Knowledge Vault Templates & Card Grid
- **Target Files**:
  - `apps/web/src/screens/Knowledge.tsx` & `apps/web/src/screens/knowledge/NewNote.tsx`: Add template selector ("Appliance", "Vehicle", "Health", "Bill") pre-filling markdown frontmatter and headers.
  - Add Scrapbook Card Grid view toggle.

### Step 6: WebGL Living Probe Celebration
- **Target Files**:
  - `apps/web/src/ui/UniverseGL.tsx` & `apps/web/src/gl/engine.ts`: Add `triggerHabitBurst(probeId)` particle flare.
  - Wire callback in `Cockpit.tsx` when `MyDay` emits completion.

### Step 7: Final Test Suite Run & Handoff
```powershell
.venv\Scripts\python.exe -m pytest
cd apps\web; npm test; npm run build
```
Ensure 0 failures, update `docs/HANDOFF.md`, and report real test counts to the owner.
