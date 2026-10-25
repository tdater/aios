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
| Approvals | `GET /approvals` · `GET /approvals/{id}` · `POST /approvals/{id}/decide` |
| Knowledge | `GET/POST /memories` · `GET/PATCH /memories/{id}` · `POST /memories/{id}/forget` · `GET /memories/export` · `POST /memories/rebuild-index` · `GET /history/search` · `GET /memories/tags` · `GET /memories/{id}/links` (outgoing, backlinks, unresolved, unlinked mentions) · `GET /graph` (nodes carry `project_id` and `created_at`) · `GET /published` (only notes tagged `publish` and approved) · `POST /published/export` (writes files under the state folder) |
| Skills | `GET /skills` · `GET /skills/candidates/{id}` (exact text, rationale, check results) · `POST /skills/candidates` · `/skills/candidates/{id}/evaluate|reject|promote` · `POST /skills/{name}/rollback` |
| Review | `GET /candidates` · `/candidates/shortlist` · `/candidates/{id}` · `POST /candidates/{id}/approve|reject|defer|edit|merge|supersede` · `GET /history/summary|sources|review-runs` · `POST /history/review-new` · `GET/PUT /history/schedule` (opt-in scheduled review) · `POST /history/sources/{id}/delete` |

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
