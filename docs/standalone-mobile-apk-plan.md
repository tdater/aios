# AIOS Standalone Mobile APK: Zero-Tailscale Architecture & Sync Blueprint

> **For Claude Code**: This document provides an exhaustive, production-grade architectural and implementation blueprint to transform AIOS Android from a remote-only client dependent on Tailscale into a **100% standalone mobile operating system** that runs completely independently on Android phones, TV boxes, and car head units—with an optional, effortless local Wi-Fi / QR sync to a Windows AIOS server when desired.

---

## Executive Summary

### The Current Barrier
In AIOS v0.4.0, the Android APK is strictly a remote display terminal:
1. It executes nothing locally and requires an active connection to an external desktop server.
2. The Android `network_security_config.xml` forbids all cleartext traffic (`usesCleartextTraffic="false"`) and trusts only system root CAs.
3. `apps/web/src/core/servers.ts` explicitly rejects local IP addresses (`http://192.168.x.x`), requiring users to set up Tailscale, configure MagicDNS, obtain HTTPS certificates, and run `tailscale serve`.
4. **Result**: Average non-technical users cannot install and use the Android app.

### The Solution: The "Dual-Engine" Architecture
1. **100% Standalone Out-Of-The-Box**:
   - The APK installs and runs **entirely on its own** on any Android device (phone, tablet, TV box, car head unit).
   - Powered by an **in-app Local Engine** (TypeScript + IndexedDB / SQLite inside the Capacitor bundle).
   - Provides the full AIOS experience: 3D Universe Cockpit, 6 Travel Regions, Living Orbit / My Day, Daily Habits, Knowledge Vault Markdown Notes, Task Tracking, Voice Input, and Activity Log.
   - Zero background daemons, zero battery drain, instant startup, and works 100% offline.
2. **Effortless Local Sync (No Tailscale Required)**:
   - When a user has a Windows AIOS server and wants to sync:
     - On Desktop: Click **"Pair Phone"** in AIOS Settings -> a QR code appears on the monitor.
     - On Mobile: Tap **"Scan QR to Sync"** -> point phone camera at the screen.
     - Connects directly over home Wi-Fi via local subnet IP (`192.168.x.x`) with **Trust-On-First-Use (TOFU) certificate pinning** or secure local HMAC pairing.
     - Bi-directional sync: Mobile notes and tasks merge into the desktop vault; desktop agent runs and approvals sync down to mobile.
   - Sync is completely optional: mobile continues running seamlessly whether connected or offline.

---

## 1. High-Level Architecture

```
+-----------------------------------------------------------------------------------+
|                            AIOS Android Application                              |
|                                                                                   |
|  +-----------------------------------------------------------------------------+  |
|  |                     React UI (Universal Mobile Adaptation)                  |  |
|  |   - 3D Universe Cockpit (WebGL)       - Bottom-Sheet Object Cards           |  |
|  |   - 6-Region Mobile Dock (Thumb Zone) - Living Orbit & MyDay Habits         |  |
|  |   - Knowledge Vault & Templates       - Push-to-Talk Voice & Haptics        |  |
|  +-----------------------------------------------------------------------------+  |
|                                         |                                         |
|                                  [ Driver Switch ]                                |
|                                         |                                         |
|                 +-----------------------+-----------------------+                 |
|                 |                                               |                 |
|                 v                                               v                 |
|   +---------------------------+                   +---------------------------+   |
|   |    Local In-App Engine    |                   |     Remote Sync Client    |   |
|   |     (Default Mode)        |                   |      (Optional Mode)      |   |
|   | - Pure TS / IndexedDB     |                   | - Local Wi-Fi (Home LAN)  |   |
|   | - 100% Standalone         | <--- Delta Sync-> | - QR Code Pairing (TOFU)  |   |
|   | - Zero Battery Drain      |                   | - Bi-directional Merge    |   |
|   | - Full Offline Storage    |                   | - Desktop Run Monitoring  |   |
|   +---------------------------+                   +---------------------------+   |
|                 |                                               |                 |
|                 v                                               v                 |
|   +---------------------------+                   +---------------------------+   |
|   |   Android Local Storage   |                   |    Windows AIOS Host      |   |
|   | (Capacitor KV / SQLite)   |                   |  (http://192.168.x.x:8765)|   |
|   +---------------------------+                   +---------------------------+   |
+-----------------------------------------------------------------------------------+
```

---

## 2. Standalone In-App Engine (`LocalEngine.ts`)

Instead of requiring an external Python backend to answer REST API calls, the standalone APK runs a lightweight, client-side driver that implements the exact same API contract (`/universe`, `/vault/notes`, `/tasks`, `/home`, `/receipts`) directly in TypeScript.

### 2.1 File Location: `apps/web/src/core/localEngine.ts`

```typescript
import { KV, LocalKV } from "./storage";
import { newKey } from "./client";
import { Universe, ObjectList, Home as HomeData, Note, Task, Receipt } from "./types";

const DB_PREFIX = "aios.local.";

/** Standalone in-app storage and state driver for mobile devices. */
export class LocalEngine {
  constructor(private kv: KV = new LocalKV()) {
    this.ensureInitialized();
  }

  private ensureInitialized() {
    if (!this.kv.get(`${DB_PREFIX}initialized`)) {
      this.bootstrapDefaultUniverse();
      this.kv.set(`${DB_PREFIX}initialized`, "true");
    }
  }

  private bootstrapDefaultUniverse() {
    const now = new Date().toISOString();
    
    // 1. Default Universe State (Sun = Mobile Command Center)
    const universe: Universe = {
      version: 1,
      you: {
        name: "My Mobile AIOS",
        title: "Mobile Command Anchor",
        summary: "Standalone mobile operating layer.",
        approved: 0,
      },
      fleet: [
        { id: "assistant", name: "Mobile Rover", role: "Daily Assistant", state: "idle" },
      ],
      stations: [
        { id: "st-home", name: "Living Orbit", region: "home", purpose: "Daily habits and routines" },
        { id: "st-vault", name: "Deep Space", region: "stars", purpose: "Knowledge and memories" },
      ],
    };
    this.kv.set(`${DB_PREFIX}universe`, JSON.stringify(universe));

    // 2. Default Knowledge Starter Pack
    const defaultNotes: Note[] = [
      {
        id: "welcome-mobile",
        title: "Welcome to Mobile AIOS",
        content: "# Welcome to Mobile AIOS\n\nYour personal command center is running completely standalone on this device.\n\n- **Living Orbit**: Track daily habits in My Day.\n- **Deep Space**: Store your notes, vehicle specs, appliance manuals, and personal records.\n- **Mission Control**: Organize tasks and goals.\n\nTo sync with a Windows PC running AIOS, visit **Settings → Sync with Windows**.",
        type: "concept",
        tags: ["welcome", "guide"],
        created_at: now,
        updated_at: now,
      },
    ];
    this.kv.set(`${DB_PREFIX}notes`, JSON.stringify(defaultNotes));

    // 3. Default Tasks & Habits
    const defaultTasks: Task[] = [
      { id: newKey(), title: "Explore your 3D universe", status: "completed", created_at: now },
      { id: newKey(), title: "Add your first habit in My Day", status: "pending", created_at: now },
    ];
    this.kv.set(`${DB_PREFIX}tasks`, JSON.stringify(defaultTasks));
  }

  // API Emulation Handlers
  async getUniverse(): Promise<Universe> {
    const raw = this.kv.get(`${DB_PREFIX}universe`);
    return raw ? JSON.parse(raw) : null;
  }

  async getHome(): Promise<HomeData> {
    const tasks = await this.getTasks();
    const pending = tasks.filter((t) => t.status === "pending").length;
    return {
      counts: {
        pending_approvals: 0,
        active_runs: 0,
        blocked_runs: 0,
        pending_candidates: 0,
      },
      recent_tasks: tasks.slice(0, 5),
    };
  }

  async getNotes(): Promise<Note[]> {
    const raw = this.kv.get(`${DB_PREFIX}notes`);
    return raw ? JSON.parse(raw) : [];
  }

  async saveNote(note: Partial<Note>): Promise<Note> {
    const notes = await this.getNotes();
    const now = new Date().toISOString();
    let saved: Note;
    if (note.id) {
      const idx = notes.findIndex((n) => n.id === note.id);
      saved = { ...notes[idx], ...note, updated_at: now } as Note;
      if (idx >= 0) notes[idx] = saved; else notes.push(saved);
    } else {
      saved = {
        id: newKey(),
        title: note.title || "Untitled Note",
        content: note.content || "",
        type: note.type || "note",
        tags: note.tags || [],
        created_at: now,
        updated_at: now,
      };
      notes.unshift(saved);
    }
    this.kv.set(`${DB_PREFIX}notes`, JSON.stringify(notes));
    this.addReceipt("note_saved", `Saved note "${saved.title}"`);
    return saved;
  }

  async getTasks(): Promise<Task[]> {
    const raw = this.kv.get(`${DB_PREFIX}tasks`);
    return raw ? JSON.parse(raw) : [];
  }

  async createTask(title: string): Promise<Task> {
    const tasks = await this.getTasks();
    const t: Task = { id: newKey(), title, status: "pending", created_at: new Date().toISOString() };
    tasks.unshift(t);
    this.kv.set(`${DB_PREFIX}tasks`, JSON.stringify(tasks));
    this.addReceipt("task_created", `Created task "${title}"`);
    return t;
  }

  private addReceipt(kind: string, summary: string) {
    const raw = this.kv.get(`${DB_PREFIX}receipts`);
    const list: Receipt[] = raw ? JSON.parse(raw) : [];
    list.unshift({ id: newKey(), ts: new Date().toISOString(), actor: "you", kind, summary, changed: 1 });
    this.kv.set(`${DB_PREFIX}receipts`, JSON.stringify(list.slice(0, 30)));
  }
}
```

---

## 3. First-Launch Onboarding UX (Fork in the Road)

Currently, `apps/web/src/screens/Boot.tsx` presents a single mandatory prompt: `"Enter server address: https://..."`.
This must be replaced with a modern, friendly onboarding screen that gives users choice:

### 3.1 Onboarding Design: `apps/web/src/screens/Boot.tsx`

```tsx
export function WelcomeScreen({
  onStartStandalone,
  onConnectServer,
}: {
  onStartStandalone: () => void;
  onConnectServer: () => void;
}) {
  return (
    <main className="boot welcome-flow">
      <div className="brand-header">
        <h1 className="brand-logo">AIOS</h1>
        <p className="brand-tagline">Personal Workflow & Command Center</p>
      </div>

      <div className="card-options">
        {/* Primary Choice: Standalone Mobile */}
        <button type="button" className="mode-card primary" onClick={onStartStandalone}>
          <div className="card-badge">RECOMMENDED</div>
          <div className="card-icon">📱</div>
          <div className="card-content">
            <h3>Use Standalone on this Phone</h3>
            <p>
              Your personal command center right here. Manage habits in My Day, organize
              household notes, track goals, and use voice capture. 100% offline, zero server required.
            </p>
          </div>
          <span className="btn-action">Start Now →</span>
        </button>

        {/* Secondary Choice: Connect to Windows AIOS */}
        <button type="button" className="mode-card secondary" onClick={onConnectServer}>
          <div className="card-icon">💻</div>
          <div className="card-content">
            <h3>Sync with Windows AIOS</h3>
            <p>
              Already have AIOS running on your PC? Scan a QR code on your home Wi-Fi to sync
              tasks, notes, and monitor Claude agent sessions.
            </p>
          </div>
          <span className="btn-action ghost">Scan QR Code</span>
        </button>
      </div>

      <p className="muted small text-center">
        You can always pair or switch to standalone mode later in Settings.
      </p>
    </main>
  );
}
```

---

## 4. Zero-Tailscale Local Sync (QR Code & LAN Discovery)

To eliminate Tailscale, we implement a **Local Wi-Fi Pairing Protocol**:

### 4.1 The LAN Pairing Protocol (How It Works)

```
[ Windows PC (Desktop AIOS) ]                           [ Android Phone (Mobile AIOS) ]
         |                                                            |
         |  1. User clicks "Pair Phone" in Desktop Settings           |
         |  2. Windows AIOS displays QR Code:                         |
         |     aios://pair?h=192.168.1.50&p=8765&code=K7QM-X4TD       |
         |     &fp=7a8b... (Cert Fingerprint)                         |
         |                                                            |
         |                                      3. User taps "Scan QR to Sync"
         |                                      4. Camera scans QR Code
         |                                                            |
         |<----- 5. Direct HTTPS/HTTP POST /auth/pair (Home Wi-Fi) ---|
         |       Headers: X-AIOS-Pair-Code: K7QM-X4TD                 |
         |                                                            |
         |------ 6. Returns 30-Day Session Token + Server ID -------->|
         |                                                            |
         |  7. Devices are Paired! (Zero VPN, Zero Accounts)          |
         |<==== 8. Bi-directional Delta Sync over Local Wi-Fi =======>|
```

### 4.2 Removing the Tailscale Restriction in `servers.ts`

In `apps/web/src/core/servers.ts`, relax the URL check to allow **Private Local IPv4 Subnets** when on home Wi-Fi:

```typescript
// Allow standard private home subnets: 192.168.x.x, 10.x.x.x, 172.16-31.x.x, and .local mDNS
const PRIVATE_IP_REGEX = /^(http|https):\/\/(192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|[\w-]+\.local)(:\d+)?$/;

export function checkServerUrl(raw: string, allowDevLoopback = false): UrlCheck {
  const s = raw.trim().replace(/\/+$/, "");
  if (s === "") return { ok: true, url: "" };
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return { ok: false, reason: "Not a valid URL." };
  }
  if (u.username || u.password) return { ok: false, reason: "Do not put credentials in the URL." };

  // Allow HTTPS everywhere
  if (u.protocol === "https:") return { ok: true, url: u.origin };

  // Allow localhost / dev loopback
  if (allowDevLoopback && LOOPBACK.test(u.origin)) return { ok: true, url: u.origin };

  // Allow Private Home Wi-Fi Subnets (Zero Tailscale Needed!)
  if (PRIVATE_IP_REGEX.test(u.origin)) {
    return { ok: true, url: u.origin };
  }

  return {
    ok: false,
    reason: "Enter a valid local network address (e.g., http://192.168.1.50:8765) or an https:// address.",
  };
}
```

### 4.3 Updating Android Network Security Config

Update `apps/web/android/app/src/main/res/xml/network_security_config.xml` to allow cleartext communication **exclusively for local private subnets**:

```xml
<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
    <!-- By default, require HTTPS with system CAs for external internet -->
    <base-config cleartextTrafficPermitted="false">
        <trust-anchors>
            <certificates src="system" />
            <certificates src="user" />
        </trust-anchors>
    </base-config>

    <!-- Allow cleartext communication on private home Wi-Fi subnets -->
    <domain-config cleartextTrafficPermitted="true">
        <domain includeSubdomains="true">192.168.</domain>
        <domain includeSubdomains="true">10.</domain>
        <domain includeSubdomains="true">172.16.</domain>
        <domain includeSubdomains="true">local</domain>
        <domain includeSubdomains="true">localhost</domain>
    </domain-config>
</network-security-config>
```

---

## 5. Mobile Ergonomics & UI Adaptations

The space canvas, dock, and HUD must feel tailor-made for handheld touchscreen use:

### 5.1 Bottom-Sheet Modal for `ObjectCard.tsx`
On screens narrower than `700px`, `ObjectCard.tsx` transforms into a swipeable bottom sheet:
- Slides up from the bottom of the screen.
- Features a curved frosted glass header with a centered grab bar (`width: 36px; height: 4px; border-radius: 999px`).
- Swipe down dismisses the card and returns focus to the 3D space canvas.

### 5.2 Thumb-Zone Travel Dock (Bottom Pill Navigation)
On mobile portrait mode:
- The left travel dock shifts to a horizontal swipeable pill strip at the bottom of the screen (above system navigation).
- The 6 regions (Sun, Fleet, Deep Space, Yards, Living Orbit, Mission Control) are accessible with one thumb.

### 5.3 Quick Add Floating Action Button (FAB)
- A glowing floating action button (`+`) sits in the lower-right corner.
- Tapping it pops up a 1-tap capture drawer:
  - 🎤 **Voice Brain-Dump**
  - 📝 **New Note (with Household Templates)**
  - ⚡ **Quick Task**
  - ☀️ **Habit Check-in**

### 5.4 Native Haptics & Feedback
Using `@capacitor/haptics`:
- Light impact vibration on region travel dock clicks.
- Success notification vibration when checking off habits in My Day.
- Warning buzz when reviewing approval requests.

---

## 6. Step-by-Step Implementation Roadmap for Claude Code

Follow this precise sequence to execute this transformation safely:

### Step 1: Pre-Implementation Test Baseline
```powershell
.venv\Scripts\python.exe -m pytest
cd apps\web; npm test; npm run build
```
Confirm 100% passing tests before modifying any code.

### Step 2: Implement `LocalEngine.ts`
- Create `apps/web/src/core/localEngine.ts` (as detailed in Section 2).
- Add unit tests in `apps/web/src/core/localEngine.test.ts` verifying:
  - Default universe initialization.
  - CRUD operations for notes, tasks, and habits.
  - Receipt log appending.

### Step 3: Integrate Local Driver into `App.tsx`
- Update `apps/web/src/App.tsx`:
  - Add `engineMode: "standalone" | "synced"` to runtime state.
  - When in standalone mode, routes and hooks read from `LocalEngine` instead of making network `fetch()` requests.
  - On first native launch, display `<WelcomeScreen>` offering Standalone vs. Sync choices.

### Step 4: Relax Network Security & Update Server Check
- Modify `apps/web/src/core/servers.ts` to accept local private subnet IPs (`192.168.x.x`).
- Update `apps/web/android/app/src/main/res/xml/network_security_config.xml` to permit cleartext for local IP subnets.
- Update tests in `apps/web/src/core/servers.test.ts` to assert that `http://192.168.1.50:8765` is accepted while arbitrary public HTTP addresses remain refused.

### Step 5: Implement QR Code Sync Modal on Desktop
- In desktop AIOS (`apps/web/src/screens/Settings.tsx` or `Cockpit.tsx`), add a **"Pair Phone"** modal:
  - Uses `qrcode.react` to render a QR code containing local IP and one-time code.
  - Displays simple 3-step instructions: *"1. Open AIOS on your phone. 2. Tap Scan QR. 3. Point camera at this screen."*

### Step 6: Mobile UI & Bottom Sheet Styling
- Add bottom-sheet styles to `apps/web/src/styles.css` for `@media (max-width: 700px)`.
- Test responsive layout in mobile viewport.

### Step 7: Android APK Build & Verification
```powershell
scripts\android-build.ps1 -Variant debug
```
Install on emulator or physical phone:
- Test 1: Launch app without any server running -> Select "Use Standalone on this Phone" -> Verify 3D universe, My Day, Knowledge Vault, and tasks work offline.
- Test 2: In Settings, enter local IP of desktop server -> Verify successful pairing over home Wi-Fi without Tailscale.

### Step 8: Final Test Suite Run
```powershell
.venv\Scripts\python.exe -m pytest
cd apps\web; npm test; npm run build
```
Verify zero regressions and update `docs/HANDOFF.md`.
