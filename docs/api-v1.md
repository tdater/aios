# AIOS HTTP API v1

Machine-readable contract: `/api/v1/openapi.json` (snapshot in `docs/openapi-v1.json`; a test fails if the
endpoint set drifts). Everything below is **implemented and covered by `tests/test_mobile_api.py`** unless marked.

## Conventions
- **Base**: `/api/v1`. Public: `GET /meta`, `POST /auth/pair`. Everything else needs a device session.
- **Auth**: `Authorization: Bearer <token>` (native) or the HttpOnly session cookie + `X-CSRF-Token` (browser).
  See `docs/mobile-remote-access.md`.
- **Client compatibility**: send `X-AIOS-Client: <name>/<version> api=<n>`. If `n < min_client_api` the server
  answers **426 `client_too_old`**. `GET /meta` returns `api_version`, `min_client_api`, `server_version`,
  `server_id` (stable identity; clients use it to detect "a different server at this address") and `capabilities`.
- **Errors** (always this shape, never HTML):
  `{"error":{"code","message","details"},"request_id"}`. `X-Request-ID` is echoed in the header.
  Stable codes include: `unauthenticated` 401, `csrf_failed`/`origin_mismatch`/`bad_host` 403, `not_found` 404,
  `version_conflict`/`invalid_state`/`approval_resolved`/`approval_expired`/`approval_superseded`/`action_changed`/
  `confirmation_required`/`resync_required`/`idempotency_in_progress`/`review_rejected` 409,
  `idempotency_key_reuse`/`validation_error`/`unknown_task_kind` 422, `client_too_old` 426, `pairing_locked` 429.
- **Timestamps**: UTC ISO-8601 with offset (`2026-10-24T08:06:00.000+00:00`). Clients render local time.
- **IDs**: stable, prefixed, time-ordered (`run_…`, `tsk_…`, `apr_…`, `mem_…`, `cnd_…`).
- **Pagination**: list endpoints take `limit` (1–200, default 50) and an opaque `cursor`; they return
  `{items, next_cursor, limit}`. Keyset based: stable under inserts. Most lists accept `q`.
- **Record versions**: `tasks`, `runs`, `projects`, `approvals`, `candidates`, `memories` carry an integer
  `version` that increments only on meaningful change (not heartbeats). Mutations accept `expected_version`;
  a mismatch returns **409 `version_conflict`** with `details.current_version`.
- **Idempotency**: `POST /tasks` and `POST /runs` accept `Idempotency-Key` (8–128 chars). Same key + same body →
  the stored response is replayed (HTTP 200 + `Idempotent-Replay: true`) and **no new work is created**; same key +
  different body → 422; concurrent duplicate → retryable 409. `POST /tasks` with `start_run:true` makes
  task + run one atomic idempotent unit.

## Endpoints
| Area | Endpoints |
|---|---|
| Meta/auth | `GET /meta` · `POST /auth/pair` · `GET /auth/me` · `GET /auth/sessions` · `POST /auth/sessions/{id}/revoke` · `POST /auth/logout` · `POST /auth/pairing-codes` |
| Overview | `GET /home` (counts, current + blocked runs, provider modes) · `GET /health` · `GET /providers` · `POST /providers/refresh` |
| Projects/tasks | `GET/POST /projects` · `GET /projects/{id}` · `GET/POST /tasks` · `GET /tasks/{id}` |
| Runs | `GET/POST /runs` · `GET /runs/{id}` (**snapshot**, includes `last_event_id`) · `GET /runs/{id}/events?after=<id>` · `POST /runs/{id}/cancel` · `/resume` · `/import-result` · `GET /artifacts/{id}` |
| Conversations | `GET/POST /conversations` · `GET /conversations/{id}` (messages, honest provider/session/permission **status**, changes, context supplied per run) · `GET/POST /conversations/{id}/messages` (poll with `after_seq`; POST starts a turn, idempotent) · `GET /conversations/{id}/changes` (latest patch, verification and review, plus AIOS-computed `readiness`) · `POST /conversations/{id}/review` (independent review of the latest recorded change; idempotent) · `GET/PUT /projects/{id}/verify-command` (owner-set argv list) |
| Approvals | `GET /approvals` · `GET /approvals/{id}` · `POST /approvals/{id}/decide` |
| Knowledge | `GET/POST /memories` · `GET/PATCH /memories/{id}` · `POST /memories/{id}/forget` · `GET /memories/export` · `POST /memories/rebuild-index` · `GET /history/search` · `GET /memories/tags` · `GET /memories/{id}/links` (outgoing, backlinks, unresolved, unlinked mentions) · `GET /graph` (nodes carry `project_id` and `created_at`) · `GET /published` (only notes tagged `publish` and approved) · `POST /published/export` (writes files under the state folder) |
| Skills | `GET /skills` · `GET /skills/candidates/{id}` (exact text, rationale, check results) · `POST /skills/candidates` · `/skills/candidates/{id}/evaluate|reject|promote` · `POST /skills/{name}/rollback` |
| Review | `GET /candidates` · `/candidates/shortlist` · `/candidates/{id}` · `POST /candidates/{id}/approve|reject|defer|edit|merge|supersede` · `GET /history/summary|sources|review-runs` · `POST /history/review-new` · `GET/PUT /history/schedule` (opt-in scheduled review) · `POST /history/sources/{id}/delete` |

## Conversations
A conversation belongs to one project. `POST /conversations/{id}/messages {content, mode}` stores the owner's
message and starts a `claude.turn` run (one at a time per conversation; otherwise 409 `turn_in_progress`).
`mode` is `read` (read-only tools, works in the worktree if one exists, else the project folder) or `edit`
(Claude may edit files, but only inside an isolated git worktree and branch `aios/<conversation id>` under the
state folder; the project folder is never written). An edit needs a git repository with at least one commit, else
409 `repo_not_ready` with the reason.

Every message has `author_kind` (`user`, `provider`, `aios`) and `author` (for example
`claude-code 2.1.310 (claude-opus-5-5)`), and a `kind`: `message`, `status`, `patch`, `verification`, `review`.
`patch` and `verification` messages come from AIOS (computed from git and from a command AIOS ran), not from the
model. A patch message's `meta` carries `artifact_id`, `sha256`, `base_revision`, `head_revision`, `files`,
`added`, `removed`, `sensitive_paths` and `possible_secret_kinds`; fetch the diff with `GET /artifacts/{id}`.

Verification is the project's `verify-command` (an argv list the **owner** sets with `PUT`; no shell). Each run
needs an approval for that exact command, worktree path, revision and patch hash (`type: run_verification`,
`destructive: true`, so `confirm_destructive:true` is required). A failing command is a recorded outcome
(`verification.meta.passed:false`) and the run still succeeds.

`GET /conversations/{id}` → `status`: `provider` (mode, billing, client version, plan, login method), `session`
(id, resumable, model), `permissions` (tools per mode, shell and network denied, no settings files, no CLAUDE.md or
auto memory, edits isolated, verification approval-gated), `workspace` (worktree, branch, base and head revision),
`last_turn` and `last_review_turn` (what Claude Code itself reported for the writer and for the independent reviewer:
tools, `unexpected_tools`, API key source, plugins, MCP servers, permission denials), `quota` (the newest report of
5-hour and 7-day subscription usage; not live) and `pending_approvals`.

`POST /conversations/{id}/review {model?, patch_message_id?}` starts an independent review of the latest recorded change
(409 `nothing_to_review` or `turn_in_progress`). A fresh read-only Claude session reviews the exact revision and sees only
the owner's request, the diff and the recorded verification. `GET /conversations/{id}/changes` and the conversation view
include `review` (findings with an AIOS-computed `grounded` flag) and `readiness`
(`ready`, `verified`, `reviewed`, `high_findings`, `reasons`), which AIOS computes from recorded facts: ready means a
passing verification of exactly this revision and no high-severity finding in a review of it. A review is optional.

## Insights, briefings, abilities (all additive)
- `GET /constellation`: every non-deleted approved, candidate or superseded memory as a `star` with `uses`, `verified_uses`
  (a use counts as verified only when the same run has a passing verification AIOS recorded), `hollow` (used, never verified),
  `state` (`fresh`, `stale` after 90 days unreviewed, `candidate`, `superseded`), and `brightness`. `links` are only
  `supersedes`. Titles of `secret-adjacent` items are withheld. `GET /constellation/{memory_id}` lists the uses.
- `GET /skyline`: per active project, `floors` (distinct revisions whose tests passed), `working`, `waiting`, `conversations`.
- `GET /briefing/{provider}?project_id=`: the approved, in-scope memories one AI may be told, ranked, capped at 4000
  characters and hashed. `claude` may see `public` and `private`; `gemini`, `perplexity`, `antigravity` only `public`.
- `POST /conversations/{id}/handoff {provider, question}` writes a ready-to-paste prompt (with that AI's briefing) and
  `POST /conversations/{id}/handoff/reply {provider, reply}` files the pasted answer, attributed to that AI and marked
  `unverified`. AIOS never contacts those AIs, and pasted answers are never mined for memories.
- Memory candidates (`status: candidate`) are proposed from the owner's own "remember / always / never" sentences and from a
  verification AIOS ran and saw pass. Never from AI text, repository text or pasted answers. They are never used until approved.
- `GET /abilities`, `PUT /abilities/{name} {enabled, confirm}` (turning on needs `confirm: true`; otherwise 422
  `confirmation_required`), `POST /pause`, `POST /resume`, `GET /receipts?changed_only=`. `paused` stops the dispatcher from
  starting runs and makes every ability answer 423 `paused`; a disabled ability answers 403 `ability_off`.
- `POST /system-scan` (needs the `system_scan` ability): reads memory, disk, temp-folder size and start-up count; returns
  `suggestions` computed by fixed rules and `changed_anything: false`.
- `POST /conversations/{id}/apply`: asks to merge the latest change into the owner's real project. 409 `nothing_to_apply`, `not_ready` (only a READY change qualifies), `already_applied`, `turn_in_progress`. It starts a `claude.apply` run that re-checks readiness, that the conversation branch still points at the reviewed revision, and that the project is on a branch with nothing uncommitted, then asks for an approval bound to the exact revision, branch and project HEAD (`type: apply_revision`, destructive). The merge is `git merge --no-ff` with the owner's hooks disabled; a conflict is aborted and reported. `changes.applied` carries the commit, the previous HEAD (for undo) and `tree_matches_reviewed`. Pending approvals in the conversation status carry a `type`.
- `POST /assist/plan {prompt, project_id?, kind?}` (changes nothing) returns what AIOS would do with a request: `kind` (`answer`, `write`,
  `research`, `plan`, `project_question`, `build`), `confidence`, `reasons`, and `steps`, each `{id, label, agent, state, why}` with `state`
  `will` (AIOS does it), `you` (needs you), `offer` (optional, one click) or `skip` (not needed, with the reason). The choice comes from fixed,
  explainable rules, not a model, and `kind` lets the owner override the guess. A `blocker` (`claude_not_ready`, `needs_project`,
  `no_verify_command`) says why it cannot start. `POST /assist` (201, idempotent) runs triage and starts the real work through the same guarded
  code as everything else: a read-only Claude turn for everything except `build`, and the start-to-finish workflow for `build`; a blocker answers
  409 with the plan in `details`. `GET /assist/{id}` returns the task with each step's live `status`
  (`pending|running|waiting|done|failed|skipped|offer`), the `state` (`working|waiting_you|needs_you|done|failed|cancelled`), `needs_you` and the
  `answer`; `GET /assist` lists recent tasks. Offered steps are the owner's to do (copy and paste) and are never reported as done.
  `GET /dashboard` returns the four agents (`claude`, `gemini`, `perplexity`, `antigravity`) with an honest `status` and what each is doing, the
  counts and first few items that need the owner, and the recent tasks.
- `GET /calibration` returns the last reviewer scorecard from the firing range (`available`, `model`, `at`, per-case `results`, and a `scorecard` with `catch_rate`,
  `false_alarm_rate`, `nitpicks_per_case`, `by_category`, `missed`, `incomplete`), or `{available: false, how}`. Read-only: only `scripts/run_calibration.py` starts a review.
- `GET /companion/{provider}?conversation_id=` (`gemini` or `perplexity`; 404 `unknown_companion` otherwise, and Antigravity has none because AIOS never starts it)
  returns the official `url`, the sharing `level`, a `notice`, and suggested prompts (`id`, `title`, `why`, `prompt`, `chars`,
  `includes_project_text`, `includes_memories`): `second_opinion` and `explain` (from the conversation's change and Claude's last answer),
  `research` (conversation title and project name only) and `introduce` (the memories that AI may be told). Project text is run
  through the secret scrubber and capped. `POST /companion/{provider}/copied {suggestion_id, conversation_id?}` writes a receipt naming the
  kind and size, never the text. AIOS never opens, reads or controls those sites; the browser opens them in a separate window.
- `POST /conversations/{id}/workflow {request, profile?, max_rounds?}` carries one request through implement, the owner's check,
  independent review, corrections, re-check and re-review (409 `no_verify_command`, `workflow_active`; 422 `bad_profile`, `bad_rounds`).
  `GET /conversations/{id}/workflow` returns the latest `workflow` (`state` working | waiting_you | finished | cancelled; `outcome`
  ready | needs_you | no_change | failed | cancelled; `round`, `max_rounds`, `steps`, `needs_you`, `pending_approvals`) and the capability
  `profiles` with their plain-language `permissions`. `POST /workflows/{id}/cancel` stops it. A workflow has no power of its own: every
  step is an ordinary run, the check still needs the owner's approval every time, the reviewer is a separate read-only session, readiness is
  still computed by AIOS, and merging stays a separate approval. Pausing AIOS stops it from moving on. Correction requests are authored by
  AIOS (`author_kind: aios`) and are never mined for memories; only AIOS-observed facts become memory candidates.
- Widgets are data, not code: `POST /widgets/preview`, `GET/POST /widgets`, `PUT /widgets/{id}`, `DELETE /widgets/{id}`. Kinds
  `counter`, `checklist`, `note`; unknown settings are rejected; creating or editing needs the `widgets` ability, removing never does.

## Universe objects, the widget catalog and routines (additive)
- `GET /universe/objects` lists every thing in the universe: `id`, `type` (`sun|planet|moon|nebula|wormhole|beacon|station|shuttle|probe|comet|log|allstop|home|module|rock`), `region`,
  plain `name` and `job`, and `state {tone, text}`. `GET /universe/objects/{id}/card` returns the plain explanation, `panels {basics, more, expert}` (fields of kind
  `toggle|choice|text|number|info|action`) and `links`. `PUT /universe/objects/{id}/config {values, confirm}` changes a setting through the same guarded function the older screen
  uses (422 `unknown_setting` for anything not on the card; abilities need `confirm`). `POST /universe/objects/{id}/actions/{action}` runs a card action (`show_briefing`,
  `run_health_check`, `pair_device`, `backup_now`, `stop`). `GET /meta` `capabilities.universe_objects` tells a client the server is new enough.
- `GET /widgets/catalog` returns the ready-made widgets (`groups`, and per entry `id`, `group`, `kind`, `name`, `space`, `blurb`, `you_can_change`, `who` = `Everyone|Technical`,
  `needs_claude`, `config`). `POST /widgets/from-catalog {template, title?, config?}` adds one (needs the `widgets` ability: 403 `ability_off`; 422 `no_such_template`; at most 24 widgets).
  Kinds are `counter`, `checklist`, `note`, `habit {days, per_week}`, `timer {focus, rest, sessions}` and `routine {prompt, when, at, day, last_run, last_task}`; every config is
  validated and has no code, links or secrets. `PUT /widgets/{id} {config, title?}` edits one.
- `POST /widgets/{id}/run` runs a routine's saved request through the single prompt now (201, returns the task; 423 while All Stop is on; 422 `not_a_routine`). The `routines` ability
  (off by default) lets AIOS start routines whose `when` is `daily`, `weekdays` or `weekly` by itself, at most once a day each, never while paused and only when Claude is signed in.

## Home Base and the Rover (additive)
- `GET /home/findings` (needs the `system_scan` ability) returns the findings from the last health check: `id` (`memory|disk|temp|startup`), `title`,
  `explain`, `how_to` (numbered Windows steps), `safe_to_automate`, `action_class` (`read_only|reversible|never`) and `open_uri` (an `ms-settings:`
  address the client may open, or null). `POST /home/actions {action, finding_id?}` is the only door for Home Base actions and is an allow-list:
  `check_health` and `open_windows_page` (returns `open_uri`; AIOS deletes and changes nothing). Everything else, including the whole never class
  (registry, services, drivers, antivirus, deleting files, installing or uninstalling, force-closing, switching start-up items) and any unknown name,
  answers 403 `action_refused` and writes a receipt. `GET/PUT /home/check-up {enabled}` and `POST /home/check-up/run` are the optional weekly
  check-up (`enabled`, `last_run`, `due`, `every_days`); it is off until turned on and only runs while `system_scan` is on and AIOS is not paused.
- The Rover has levels 1 (Look) and 2 (Guide) only and needs the `rover` ability (off by default). `GET /rover` is always readable: `status`
  (`idle|armed|looking|guiding|stopped|finished`), `ring` (true while a task is live: show the "Rover active" ring), the live `task` with its `steps`,
  `last_task`, `levels` (3 Browser and 4 Screen are `available: false` with the reason; they are never attempted), `stop`, `input_injection: false`.
  `POST /rover/tasks {goal, level, target, minutes?, opt_in: true}` starts one task (422 `opt_in_required`, `level_not_available`, `bad_time_limit`;
  403 `ability_off`, `rover_blocked` when the goal or target is on the block list; 409 `task_active`). `POST /rover/tasks/{id}/step` takes one step:
  Look saves a picture of the named foreground window under the state folder; Guide also asks Claude, through the Claude Code wrapper, for numbered
  `instructions` for the person to follow. A step refuses with 403 `rover_blocked` (banking, payment, password manager, login, admin tool, system
  settings window in front, checked before and after the picture) or 409 `wrong_window`, and returns `outcome: stopped` if Stop arrived mid-step. Nothing
  clicks or types. `POST /rover/tasks/{id}/finish` ends a task; `POST /rover/stop` stops every live task and always works (even paused or with the
  ability off); All Stop and turning the ability off do the same. Pictures are deleted when a task ends. Every step and refusal writes a receipt.

## Run state, execution honesty
`state` is the machine contract (`queued, running, awaiting_approval, blocked, interrupted, succeeded, failed,
cancelled`). `display_state` is the honest user-facing label: adds **`awaiting_provider_session`** (a user-started
Claude/Antigravity session is needed; AIOS does not drive subscription providers) and **`blocked_quota`**; `block_code`
carries the precise reason (`provider_unavailable`, `quota_exhausted`, `dependency`, `uncertain_side_effect`, …).
Quota stops never fall back to paid access. (Quota *detection* from real providers is **not implemented**; the
state exists and is tested through a test executor.)

## Cancellation is two-phase
`POST /runs/{id}/cancel` → `{"result":"confirmed"|"requested","run":{…,"cancellation":{…}}}`.
- Run not executing (queued/blocked/awaiting approval/interrupted): **confirmed** immediately; pending approvals
  for it are superseded.
- Run executing: **requested**. It stops at the next step boundary (`cancellation.status` becomes `confirmed`).
  `in_flight_step` / `may_still_finish_step` say whether a step may still complete. If the run finished first the
  status is `too_late`. Completed side effects are **never reversed**.

## Approvals
Each approval binds to `sha256(canonical action)`; `GET /approvals/{id}` returns the exact `action`, a reviewed
`review{type,target,side_effects,content_preview}`, `destructive`, `age_s`, `expires_in_s`, `version`,
`action_hash` and run evidence. `POST …/decide {approve, note?, expected_version?, action_hash?,
confirm_destructive?}` is race-safe (one atomic transaction): double submits and concurrent decisions resolve
exactly once; resolved, expired, superseded or tampered requests return 409 with a specific code; destructive or
unrecognised actions require `confirm_destructive:true`. An approval is single-use, expires (default 24 h) and
is spent *before* its effect runs.

## Reconnectable monitoring
Load the snapshot (`GET /runs/{id}`) → remember `last_event_id` → poll `GET /runs/{id}/events?after=<id>`.
No gaps/repeats across reconnects. If `after` is ahead of the server (restored backup) → **409 `resync_required`**:
reload the snapshot. A change in `run_version` means steps/artifacts changed: refetch the snapshot.
Server-Sent Events are **planned**, not implemented (`capabilities.sse_stream=false`).
