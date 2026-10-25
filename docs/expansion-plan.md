# AIOS expansion plan: a daily interface for everyone

Written 2026-10-25 from four research reports (sources at the end) and the owner's brief. Nothing here removes or weakens the
coding workflow; it all sits beside it. Status of each item is in the table at the bottom and in `docs/HANDOFF.md`.

## The idea in one paragraph

The AI app market is crowded with chat clients. What nobody does well is **trust**: showing what the AI actually did, checking it
independently, asking before acting, and letting you see and correct what it remembers. AIOS already does that for code. The
expansion makes the same machinery useful for ordinary tasks and ordinary people, so that it becomes the place you open every day
and the AIs get more helpful the more you use it, without becoming creepy.

## Principles (these decide every trade-off below)

1. **Verified outcomes are the product**, for coders and non-coders alike. A "proof seal" means the same thing everywhere.
2. **Calm by default.** Three modes (Simple, Standard, Power) so an average user sees five things, not fifty. Switching never deletes anything.
3. **Opt-in, one capability at a time, revocable in one tap.** The three privileged abilities (system scan, widgets from habits, computer control) are off until you turn each one on, and each says plainly what it can see and do.
4. **Local-first and inspectable.** Everything AIOS learns is a page you can read, edit and delete. Nothing is inferred about health, money or relationships without an explicit opt-in.
5. **Official routes only.** No token extraction, no unofficial proxies, no wrapping a provider's app where its terms forbid it, no paid API without your approval.
6. **Safety is code, not prompts.** Consent, tiers, allowlists, kill switch and audit are enforced by AIOS, never left to the model.

## What each provider's desktop features can become inside AIOS

| Capability | Claude | Gemini | Perplexity |
|---|---|---|---|
| Chat, files, images, web search | **Real**, through the unmodified `claude -p` with your login | Manual handoff (AIOS writes the prompt and context, you paste the answer back). Optional: a Gemini API key you approve, with a spend cap | Manual handoff. Optional: Perplexity API key you approve (pay-as-you-go; Pro includes no API credit) |
| Projects / spaces / gems | AIOS projects and conversations (already built) | AIOS's own, same layer | AIOS's own, same layer |
| Deep research with sources | Claude's built-in search through the CLI, plus an evidence-checked brief (see ideas) | Manual, or API key | Official MCP server, only with an API key you approve |
| Memory and personalization | AIOS memory, shared with every AI through a per-AI briefing | same | same |
| Connectors (mail, calendar, files) | Claude's official MCP connectors where the CLI supports them (unverified under `-p`); otherwise import by file | Not available officially | Not available |
| Scheduled tasks | AIOS can schedule its own `claude -p` runs on this PC | Not by AIOS | Not by AIOS |
| Voice | Not available through any official route | same | same |
| Browser and computer control | An AIOS-owned controller, with Claude as the planner (see below). Claude's own computer-use cannot be driven from AIOS: the CLI version is macOS-only and unavailable with `-p`, and the desktop app is not automatable by a third party | Must not be automated | Must not be automated (their terms forbid automation) |

Things AIOS must not do, now or later: start `agy` for Gemini on a consumer plan, reuse Gemini or Claude OAuth tokens, script the
Perplexity or Claude apps by UI automation, or offer a Claude login to other people.

## The three privileged abilities (each needs your explicit opt-in)

### 1. System scan and performance suggestions
- **What it does:** a read-only scan (memory, disk, startup items, background processes, temp and cache sizes, largest folders) that explains in plain language what is slowing the PC and what is safe to do.
- **What it never does:** change anything by itself, count "problems" to scare you, upsell, or touch the registry.
- **How cleanup works:** you choose items from a preview; they are moved to a quarantine folder and kept 30 days, not deleted. The preview says "could free 2.1 GB, 0 risky" with the actual numbers.
- **The AI's part:** optionally explain the findings. It sees aggregated numbers by default; a preview shows exactly what would be sent.
- **Consent:** off by default; a screen lists every check it runs; every cleanup step goes through the same approval as other actions.

### 2. Widgets and micro-apps
- **What it is:** small panels pinned to Today (a counter, a checklist, a list, a button that opens a screen or runs an approved skill).
- **The safety idea:** a widget is **data, not code**. It is a small JSON description checked against a closed registry of sources, views and actions. An AI may *propose* one, you preview and approve it, and AIOS renders it as plain text. A suggested widget therefore cannot be an attack, and a broken one shows "this stopped working" instead of failing silently.
- **Habit suggestions:** only coarse, local events (which screens you open, time-of-day bucket, repeated sequences); never content, keystrokes, window titles or the clipboard. Raw events are kept about 30 days, then only counts. A pattern must repeat on 5 or more different days before AIOS suggests anything, at most one suggestion a week, and every suggestion says which events it is based on. A "What AIOS learned" page lets you delete one item, everything, or say "never suggest this".
- **Signing in to your own accounts:** AIOS does not store third-party sign-in tokens. Services come in through Claude's official connectors where those work, or by importing a file (for example a calendar export). This is a deliberate limit, not an omission.

### 3. Computer control (mouse, browsers, apps)
- **Why an AIOS-owned controller:** see the provider table. Claude proposes actions as validated JSON; only AIOS touches the computer.
- **Phases (each ships only after the previous one has been tested, including adversarial pages):**
  0. A ten-minute spike: can `claude -p` read a screenshot through its Read tool? Build the audit log, the always-on banner and the kill switch as tested code with no model attached.
  1. **Look and explain.** Window-scoped screenshot, redaction, one answer. The build contains no code that can click or type.
  2. **Browser only.** Its own throwaway profile, a site allowlist, logins done by you by hand.
  3. **Apps.** Windows UI Automation first, with a tiny allowlist (Notepad, Calculator) and a recommended Windows Sandbox or VM before anything wider.
- **The safety stack (all enforced by AIOS):** per-capability and per-session consent with a banner the model cannot dismiss; three action tiers (look, reversible, irreversible) where irreversible actions need an approval bound to the exact action; always-deny list (terminals, admin consoles, password managers, banking, system settings, UAC); every screenshot and on-screen text treated as untrusted data; redaction before the model sees pixels; rate limits; a global kill hotkey and a visible Stop button; automatic stop if you touch the mouse; append-only audit log with before and after screenshots; credentials and 2FA are never typed or read by the model.
- **Be honest about the limit:** Anthropic itself says computer use has no sandbox between Claude and your apps. This feature reduces risk; it cannot remove it. It starts with the smallest safe slice.

## Memory shared between AIs (the engine behind everything)

- **Capture:** after each session AIOS proposes typed candidates (decision, preference, fact, procedure, lesson), each with source run and AI, a quoted evidence span, trust of origin (you typed it / an AI wrote it / it came from a repo or web page), sensitivity tier, scope (global, project, one AI), a review-by date, and a "supersedes" link. Nothing is extracted from retrieved notes, repository text or web content as if it were your intent: that is the documented memory-poisoning route.
- **Importance:** a visible sum, not a vibe: you said "remember"; you corrected the AI; it recurred in two or more sessions; it is tied to a passing test or an accepted change; it has a concrete evidence span. Minus points for AI-only origin and for sensitivity.
- **Approval:** low-risk items (your own words or a verified outcome, project-scope fact or preference, no conflict, with a short expiry) may be auto-approved if you turn that on, with a one-click undo. Always reviewed by you: procedures and anything that reads as an instruction, anything that came from AI-written text or a manual handoff, personal or secret tiers, and anything that supersedes an approved note.
- **Sharing:** each AI gets a compiled, versioned, hashed **briefing**, never the whole vault: approved, in scope, under that AI's sensitivity ceiling, ranked, size-capped, framed as reference data. Manual-handoff AIs are treated as external and get a lower ceiling. The per-run supply record that already exists is the proof of what each AI was told.
- **Conflicts:** contradictions stay side by side as "contested", with both evidence lists. Your own statement beats an AI inference; a verified outcome beats an unverified claim; newer wins only within the same trust class.

## The Constellation (expanded)

A star is one approved item from the memory. The picture means something because every visual element is one stored fact.

- **Shape:** the type (lesson, decision, preference, fact, procedure).
- **Brightness:** *verified and used*. Used means it was supplied to a run; verified means that run produced a passing check AIOS ran. Verified but never used is dim. Used but never verified is a hollow outline. There is no hidden score to hide which condition is missing.
- **Colour (with a distinct outline for accessibility):** fresh and verified; stale (past its review-by date); contested; candidate (ghost outline, not yet approved).
- **Decay:** brightness fades with the time since the last verified use and returns on the next one, computed from the usage ledger.
- **Links:** only three kinds: supersedes, derived-from (evidence), contradicts. Optional faint "used together" lines, off by default. No similarity edges, so it never becomes a hairball.
- **Clusters:** by project. Click a star to see its evidence, versions, and the runs and conversations that used it.

## The six UI ideas, as built

1. **Proof Seal.** Shape from the patch hash; rings = independent checks that passed (you approved the run, tests passed on this exact revision, an independent review of this revision found no high-severity problem); solid, cracked or hollow by state. It never claims more than the facts.
2. **Flight Recorder.** A scrubbable replay of a run built from the saved transcript: files light up as read, edits flash, refused actions spark red, then the test result lands.
3. **Constellation.** As above.
4. **Skyline.** Each project is a building; a floor per verified outcome; windows glow while an agent works; scaffolding when blocked or waiting for you.
5. **The Bench.** Writer and reviewer at two seats; the patch slides across, findings pin to it, the verdict is stamped.
6. **The Vault Door.** Approvals as a lock; destructive ones are a heavier door you must hold open for a moment. Plain controls remain for keyboard and screen reader users, and every animation respects "reduce motion".

## A calm daily home (for average users)

- **Today:** at most five cards: *Needs you* (pending approvals), *Done since yesterday* (verified outcomes with seals), *Coming up*, one suggested next step with its reason, and an "ask anything" box. Coders and non-coders see the same cards filled with different content.
- **Modes:** Simple (Today, chat, approvals, memory), Standard (adds projects, history, models), Power (adds worktrees, diffs, raw logs, providers). A "why is this hidden?" link explains.
- **Plain-language onboarding:** three questions (what do you want help with, what should AIOS never touch, who else uses this PC), mapped to a permission profile, ending with a harmless first task. No API-key talk.
- **Trust surfaces:** *What AIOS knows about you* (grouped, each item with where it came from, edit, forget, never-remember-this-kind, export, forget-since-a-date); *Receipts* (every action in plain language, searchable, filterable by "things that changed stuff"); a **pause everything** switch and a private session that keeps no memory; *earned autonomy* (after you approve the same low-risk action several times AIOS offers "stop asking for this?", never automatic, expires in 30 days).
- **Ideas for non-coding work that reuse the verification machinery:** verified writing revisions (edit in an isolated copy, tracked diff, independent reviewer checks meaning was not changed); evidence-backed research briefs (every claim links to a quoted source and a reviewer re-checks each as supported, weak or not found); household admin with approvals (AIOS drafts, you approve each step, nothing is sent or paid on its own).
- **Folder-scoped helpers:** grant one folder; a chip on every screen says "AIOS can see: 1 folder".
- **Multiple AIs:** open separate or side-by-side conversations, or one combined window that sends your message to the AIs you pick. Claude answers for real; others return a ready-to-paste prompt and take the pasted reply back into the same thread, labelled as unverified and attributed to its source.

## Improving the coding experience too

Earned autonomy for repeated low-risk verification runs; a one-click "apply this revision" with an approval that shows the exact merge; automatic re-verify and re-review after a fix; a Today card for each repository; seals and the constellation making verified work visible; per-project memory briefings; a reviewer calibration set so reviewer quality is measured, not assumed.

## Decisions that are yours

1. **API keys.** Do you want to enable optional Gemini and Perplexity API keys (paid, pay-as-you-go, with a spend cap), or keep them manual handoff only? Default: manual only.
2. **Computer control.** Agree to the phased rollout above, starting with look-and-explain, and to Windows Sandbox or a VM for app control?
3. **Auto-approval of low-risk memories.** On by default, or off until you turn it on? Default: off.
4. **Simple mode test.** Have your non-technical tester try Simple mode before more is added.

## Status

| Item | State |
|---|---|
| This plan and the research | Done |
| Proof Seal | In progress on branch `phase1-delight` |
| Vault Door, Flight Recorder, Bench, Skyline, Constellation | Planned next, in that order, on the same branch |
| Modes, Today, customizable interface | Planned after the visual pieces |
| What AIOS knows, Receipts, pause switch, memory capture and briefings | Planned |
| Multi-AI conversations | Planned (needs a provider-aware conversation model) |
| System scan, widgets, computer control | Planned; each starts with consent, audit and a read-only slice |

## Sources

- Claude Code terms and docs: [legal and compliance](https://code.claude.com/docs/en/legal-and-compliance), [headless](https://code.claude.com/docs/en/headless), [CLI computer use](https://code.claude.com/docs/en/computer-use), [desktop](https://code.claude.com/docs/en/desktop), [Chrome](https://code.claude.com/docs/en/chrome), [memory](https://code.claude.com/docs/en/memory), [Anthropic computer use safety](https://support.claude.com/en/articles/14128542), [computer use tool](https://platform.claude.com/docs/en/agents-and-tools/tool-use/computer-use-tool)
- Google: [Antigravity terms](https://antigravity.google/terms/), [FAQ](https://antigravity.google/docs/faq/), [Gemini API billing](https://ai.google.dev/gemini-api/docs/billing)
- Perplexity: [API billing](https://www.perplexity.ai/help-center/en/articles/10354847-api-payment-and-billing), [credits](https://www.perplexity.ai/help-center/en/articles/13838041-how-credits-work-on-perplexity), [changelog and MCP](https://docs.perplexity.ai/docs/resources/changelog), [terms](https://www.perplexity.ai/hub/legal/terms-of-service)
- Similar products and lessons: [Rewind to Limitless](https://9to5mac.com/2025/12/05/rewind-limitless-meta-acquisition/), [Windows Recall criticism](https://venturebeat.com/business/microsofts-new-recall-feature-for-copilotpcs-draws-criticism-spyware), [Claude memory](https://9to5mac.com/2026/03/02/free-claude-users-can-now-use-memory-and-import-context-from-rivals/), [PC Manager](https://www.ctrl.blog/entry/microsoft-pc-manager-conflicting-interests/), [OpenMemory](https://mem0.ai/blog/introducing-openmemory-mcp), [Letta memory](https://docs.letta.com/guides/agents/memory)
- Memory attacks: [MemoryGraft](https://arxiv.org/html/2512.16962), [GhostWriter](https://promptfoo.dev/lm-security-db/vuln/ghostwriter-persistent-memory-poisoning-in-tool-using-agents-e9cd87a8)

Not verified (do not rely on these): Windows widgets, Home Assistant, Android widgets, Shortcuts, Msty and ChatGPT memory research was not done; several
feature lists come from third-party reviews; whether `claude -p` reads screenshots, and whether claude.ai-hosted connectors work under `-p`, must be tested before building on them.
