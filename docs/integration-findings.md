# Integration findings (Steps 1 and 2 of `docs/product-goal.md`)

Checked 2026-10-24 against the repository at `237c49b` and the official pages listed under Sources.

## Step 1: what the repository actually did

All six findings in the course-correction brief are confirmed. There was no real provider execution path anywhere.

| Finding | Status | Evidence |
|---|---|---|
| Claude discovered, execution left user-started | Confirmed | `apps/api/aios/providers.py` `_claude()` runs only `claude --version` and `claude auth status`; `apps/api/aios/main.py` advertises `provider_execution: user_started_session_only` |
| Gemini is `manual_handoff` when installed | Confirmed (and `unavailable` when not installed) | `providers.py` `_gemini()` |
| Perplexity is `manual_handoff` | Confirmed | `providers.py` `_perplexity()` |
| No Antigravity adapter | Confirmed | only a note string in `providers.py` and `docs/architecture.md` |
| Provider tasks export packets and wait for imports | Confirmed | `apps/api/aios/executors/provider_task.py` `provider_task()` raises `Blocked(awaiting_provider_session)` |
| The automated branch is mock-only | Confirmed | same file, `cap["mode"] == "automated"` branch, reached only by the `mock` provider |

Other external processes in the codebase, none of them provider execution:

- `apps/api/aios/executors/audit.py`: read-only `git` commands for the workspace audit (real, deterministic).
- `scripts/seed_sample.py`, `scripts/scan_secrets.py`: `git` only.
- `scripts/claude_guard.py` and `.claude/settings.json`: a safety hook for Claude Code sessions working *on this
  repository*. It does not let AIOS drive Claude.
- `scripts/stage_claude_sessions.py` and `apps/api/aios/history/`: read exported transcripts; no live sessions.

## Step 2: supported execution per provider

A = supported integrated execution · B = user-started official session connected through supported tools ·
C = manual packet handoff · D = unsupported or blocked.

| Provider | Classification | What AIOS does |
|---|---|---|
| Claude Code (Pro/Max login) | **A** | Starts the unmodified `claude` binary in print mode in one registered workspace. Claude Code authenticates itself; AIOS never sees credentials. Implemented in `apps/api/aios/claude_code.py`; proven only by `scripts/demo_claude_connection.py` on a signed-in machine |
| Antigravity CLI (`agy`) on a consumer plan | **D** for AIOS-started runs; **C** works | Never started by AIOS. Task packet, run by you in your own `agy` session, result imported as unverified |
| Antigravity via MCP into an `agy` session you start | **B, undetermined** | Not built. The terms do not mention MCP and Google is actively suspending accounts; needs written confirmation from Google first |
| Perplexity | **C** | Manual research handoff. Pro is not assumed to include API access |
| Gemini CLI | Removed | Owner decision. It also stopped serving Google AI Pro, Ultra and free users on 2026-06-18 |

### Why Claude Code is A

Anthropic's legal page says OAuth (subscription) login is for subscribers' ordinary use of Claude Code, that
developers may not route requests through subscription credentials *on behalf of their users* or collect or
intermediate Claude.ai credentials, and that this does not prevent an end user signing in to the unmodified Claude
Code binary with their own subscription. AIOS is a single-user local tool: the person signed in is the person
using AIOS, the binary is unmodified, and AIOS never touches the token. That is the permitted pattern.

This reverses the earlier conclusion in `docs/architecture.md`, which read the developer restriction as covering
your own local tool. It does not cover it.

Residual risks, stated plainly:

- Advertised Pro and Max limits assume ordinary, individual usage. A long unattended loop could hit limits.
  AIOS runs Claude only when you start a task, with a turn cap and a timeout.
- `--bare` mode is not used, because bare mode ignores the subscription login and needs an API key.
- A tester using AIOS needs their own Claude subscription and their own Claude Code sign-in.

### How a Claude run is constrained (`apps/api/aios/claude_code.py`)

| Control | How |
|---|---|
| Subscription only, never metered API | Refuses unless `claude auth status` reports `loggedIn` with `authMethod: claude.ai`; removes `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_BASE_URL` and the Bedrock, Vertex and Foundry switches from the child environment |
| Untrusted repositories cannot run code through Claude Code config | `--setting-sources user` (no project hooks or settings) and `--strict-mcp-config` with no servers. Without these, print mode runs a repository's hooks and MCP servers with no trust prompt |
| Read or edit only | `read`: `--permission-mode dontAsk`, Read, Glob, Grep. `edit`: `--permission-mode acceptEdits`, plus Edit and Write. Bash, web, notebook and subagent tools are denied in both |
| No hanging prompts | `--permission-prompts none` (needs Claude Code 2.1.259 or newer; older versions are refused) |
| Bounded | `--max-turns` and a wall-clock timeout that kills the process |
| Verification is not the model's opinion | AIOS runs the tests itself after the run |
| Prompt cannot become a flag | `--` before the prompt; Windows batch shims (`claude.cmd`) are refused |
| Transcripts | stream-json events saved with secret patterns redacted |

### Why Antigravity is D for AIOS-started runs

Antigravity's terms (section 6) say using third-party software, tools or services to access the service breaches
the agreement and can lead to suspension of Antigravity and Gemini CLI accounts. The FAQ says wrapping `agy`
inside third-party coding agents or applications is not supported under consumer plans. AIOS starting `agy` is
exactly that, even though `agy -p` itself is documented for scripting and CI. Press reports from September 2026
describe paid subscribers being suspended for third-party tool use.

What would change this: Google confirming in writing that a personal local tool may start `agy`, or an enterprise
or API-key path you choose to pay for (not assumed, not approved).

## Decision needed for Steps 3 and 4

The brief asks for a second, independent reviewer. With Antigravity blocked for automation, the options are:

1. **A second Claude session as reviewer.** A fresh session with no shared context, read-only, reviewing the
   patch at a known revision. Supported today; independent context but the same vendor.
2. **Antigravity as reviewer through manual handoff (C).** Different vendor, but you run every review by hand.
3. **Both:** Claude reviewer by default, an Antigravity review on demand.

## Sources (opened 2026-10-24)

- [Claude Code legal and compliance](https://code.claude.com/docs/en/legal-and-compliance)
- [Run Claude Code programmatically](https://code.claude.com/docs/en/headless)
- [Claude Code CLI reference](https://code.claude.com/docs/en/cli-reference)
- [Antigravity CLI headless mode](https://antigravity.google/docs/cli/headless/)
- [Antigravity FAQ](https://antigravity.google/docs/faq/)
- [Google Antigravity Additional Terms of Service](https://antigravity.google/terms/)
- [Transitioning Gemini CLI to Antigravity CLI (GitHub discussion #27274)](https://github.com/google-gemini/gemini-cli/discussions/27274)
- [Report on Antigravity subscriber suspensions (Enterprise DNA, 2026-09-03)](https://enterprisedna.co/resources/ai-pulse/ai-pulse-2026-09-03-google-suspends-paying-antigravity-subscribers-for-using-thi/)
