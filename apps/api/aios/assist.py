"""One prompt for any task. Turns a request into the right amount of work and reports it as a dashboard.

`create` runs triage, then starts the real work through code the rest of AIOS already uses and guards: a read-only Claude turn for
everything except `build`, and the start-to-finish workflow for `build`. It adds no power. Steps that need another AI are shown
as the owner's to do (copy and paste), never as done. `view` and `dashboard` only read recorded facts."""
from __future__ import annotations

import json

from . import conversations, providers, services, triage, workflow
from .config import Settings
from .db import Database
from .errors import ApiError, not_found
from .security import redact_obj
from .util import new_id, now

ACTIVE_RUN = ("queued", "running")
NEEDS_YOU_RUN = ("awaiting_approval", "blocked", "interrupted")


def claude_ready(db: Database) -> bool:
    cap = providers.capability(db, "claude") or {}
    return cap.get("mode") != "unavailable" and (cap.get("detail") or {}).get("logged_in") is not False


def _project(db: Database, settings: Settings, project_id: str | None) -> dict | None:
    """The chosen project, or None. The 'Everyday' space counts as no project."""
    if not project_id:
        return None
    row = db.one("SELECT p.id, p.name FROM projects p WHERE p.id=? AND p.status='active'", (project_id,))
    if not row:
        raise not_found("project")
    ev = db.one("SELECT p.id FROM projects p WHERE p.name=? ORDER BY p.created_at LIMIT 1", (services.EVERYDAY_NAME,))
    return {**row, "everyday": bool(ev and ev["id"] == row["id"])}


def preview(db: Database, settings: Settings, prompt: str, project_id: str | None = None, kind: str | None = None) -> dict:
    proj = _project(db, settings, project_id)
    has_check = bool(proj and conversations.verify_argv(db, proj["id"]))
    return triage.plan_for(prompt, project=proj, project_has_check=has_check, claude_ready=claude_ready(db), kind=kind)


def create(db: Database, engine, settings: Settings, prompt: str, project_id: str | None = None, kind: str | None = None) -> dict:
    prompt = (prompt or "").strip()
    if not prompt or len(prompt) > triage.MAX_PROMPT:
        raise ApiError(422, "bad_prompt", f"write a request of up to {triage.MAX_PROMPT} characters")
    if kind is not None and kind not in triage.KINDS:
        raise ApiError(422, "bad_kind", f"kind must be one of {sorted(triage.KINDS)}")
    plan = preview(db, settings, prompt, project_id, kind)
    if plan["blocker"]:
        raise ApiError(409, plan["blocker"]["code"], plan["blocker"]["message"], {"plan": plan})
    proj = _project(db, settings, project_id)
    if plan["uses_project"]:
        pid = proj["id"]
    else:
        pid = services.ensure_everyday_project(db, settings)["id"]          # no project involved: a plain chat space
    title = " ".join(prompt.split())[:60]
    conv = conversations.create(db, project_id=pid, title=title)
    aid, workflow_id = new_id("ast"), None
    db.execute("INSERT INTO assists(id,conversation_id,workflow_id,project_id,kind,chosen_by_owner,prompt,plan_json,created_at) VALUES (?,?,?,?,?,?,?,?,?)",
               (aid, conv["id"], None, pid, plan["kind"], 1 if kind else 0, prompt, json.dumps(plan), now()))
    try:
        if plan["kind"] == "build":
            wf = workflow.start(db, engine, conv["id"], prompt)
            workflow_id = wf["id"]
            db.execute("UPDATE assists SET workflow_id=? WHERE id=?", (workflow_id, aid))
        else:
            conversations.post_user_message(db, engine, conv["id"], prompt, "read")
    except Exception:
        db.execute("DELETE FROM assists WHERE id=?", (aid,))
        raise
    return view(db, aid)


# ---------------------------------------------------------------- reading
def _row(db: Database, aid: str) -> dict:
    row = db.one("SELECT * FROM assists WHERE id=?", (aid,))
    if not row:
        raise not_found("task")
    return row


def _first_run(db: Database, conversation_id: str) -> dict | None:
    return db.one("SELECT r.* FROM runs r JOIN conversation_messages m ON m.run_id=r.id WHERE m.conversation_id=? AND m.role='user' "
                  "ORDER BY m.seq LIMIT 1", (conversation_id,))


def _answer(db: Database, conversation_id: str) -> dict | None:
    for m in conversations.messages(db, conversation_id):
        if m["role"] == "assistant" and m["author_kind"] == "provider" and m["kind"] == "message" and not (m.get("meta") or {}).get("handoff"):
            return {"text": m["content"], "author": m["author"], "at": m["created_at"], "message_id": m["id"]}
    return None


def _status_of_run(run: dict | None) -> str:
    if not run:
        return "pending"
    s = run["state"]
    if s in ACTIVE_RUN:
        return "running"
    if s in NEEDS_YOU_RUN:
        return "waiting"
    return "done" if s == "succeeded" else "failed"


def _simple(db: Database, row: dict, plan: dict) -> tuple[list[dict], str, str | None, dict | None]:
    run = _first_run(db, row["conversation_id"])
    answered = _answer(db, row["conversation_id"])
    st = _status_of_run(run)
    steps = []
    for s in plan["steps"]:
        status = {"understand": "done", "answer": st}.get(s["id"], "skipped" if s["state"] == "skip" else "offer")
        steps.append({**s, "status": status})
    state = {"pending": "working", "running": "working", "waiting": "waiting_you", "done": "done", "failed": "failed"}[st]
    need = None
    if run and run["state"] == "blocked":
        need = "Claude is blocked: " + (run.get("state_reason") or "open the details to see why.")
    elif run and run["state"] == "failed":
        need = (run.get("state_reason") or "The request did not finish.")
    return steps, state, need, answered


def _build(db: Database, row: dict, plan: dict) -> tuple[list[dict], str, str | None, dict | None]:
    wf = workflow.view_by_id(db, row["workflow_id"])
    by_kind: dict[str, list[dict]] = {}
    for s in wf["steps"]:
        by_kind.setdefault(s["kind"], []).append(s)
    ch = conversations.changes(db, row["conversation_id"])
    ver = (ch["verification"] or {}).get("meta") or {}
    done = wf["state"] in ("finished", "cancelled")

    def of(kind: str) -> str:
        items = by_kind.get(kind, [])
        if not items:
            return "skipped" if done else "pending"
        last = items[-1]
        return {"running": "waiting" if wf["state"] == "waiting_you" else "running", "done": "done", "failed": "failed"}[last["status"]]
    implement = of("implement")
    verify = "waiting" if wf["pending_approvals"] else (("done" if ver.get("passed") else "failed") if ver else ("skipped" if done else "pending"))
    status_of = {"understand": "done", "implement": implement, "verify": verify, "review": of("review"), "correct": of("correct") if by_kind.get("correct") else ("skipped" if done else "pending"),
                 "result": "done" if wf["outcome"] in ("ready", "no_change") else ("waiting" if wf["outcome"] == "needs_you" else ("failed" if wf["outcome"] in ("failed", "cancelled") else "pending"))}
    steps = [{**s, "status": status_of.get(s["id"], "pending")} for s in plan["steps"]]
    state = {"working": "working", "waiting_you": "waiting_you", "cancelled": "cancelled"}.get(wf["state"])
    if wf["pending_approvals"] and state == "working":         # the coordinator ticks about once a second; the approval is already waiting
        state = "waiting_you"
    if wf["state"] == "finished":
        state = {"ready": "done", "no_change": "done", "needs_you": "needs_you", "failed": "failed", "cancelled": "cancelled"}[wf["outcome"]]
    return steps, state or "working", wf["needs_you"] or (wf["outcome_reason"] if wf["outcome"] in ("needs_you", "failed") else None), _answer_for_build(db, row, wf)


def _answer_for_build(db: Database, row: dict, wf: dict) -> dict | None:
    if wf["outcome"] not in ("ready", "needs_you", "no_change"):
        return None
    text = wf["outcome_reason"] or ""
    last = None
    for m in conversations.messages(db, row["conversation_id"]):
        if m["role"] == "assistant" and m["author_kind"] == "provider" and m["kind"] == "message":
            last = m
    if last:
        text = f"{last['content']}\n\n{text}".strip()
    if wf["outcome"] == "ready":
        text += "\n\nNothing has been merged into your project yet. Open the details to apply it when you are happy with it."
    return {"text": text, "author": "Claude and AIOS", "at": wf["updated_at"], "message_id": None}


def view(db: Database, aid: str) -> dict:
    row = _row(db, aid)
    plan = json.loads(row["plan_json"])
    steps, state, need, answered = (_build if row["workflow_id"] else _simple)(db, row, plan)
    proj = db.one("SELECT id, name FROM projects WHERE id=?", (row["project_id"],))
    ev = db.one("SELECT id FROM projects WHERE name=? ORDER BY created_at LIMIT 1", (services.EVERYDAY_NAME,))
    return redact_obj({
        "id": aid, "prompt": row["prompt"], "kind": row["kind"], "label": plan["label"], "confidence": plan["confidence"], "reasons": plan["reasons"],
        "chosen_by_owner": bool(row["chosen_by_owner"]), "state": state, "needs_you": need, "steps": steps, "answer": answered,
        "conversation_id": row["conversation_id"], "workflow_id": row["workflow_id"], "created_at": row["created_at"],
        "project": None if (ev and ev["id"] == row["project_id"]) else proj, "uses_project": plan["uses_project"],
        "high_stakes": plan["high_stakes"]})


def recent(db: Database, limit: int = 12) -> list[dict]:
    out = []
    for r in db.query("SELECT id FROM assists ORDER BY created_at DESC, id DESC LIMIT ?", (max(1, min(limit, 50)),)):
        v = view(db, r["id"])
        a = v["answer"]["text"] if v["answer"] else ""
        out.append({"id": v["id"], "prompt": v["prompt"][:200], "kind": v["kind"], "label": v["label"], "state": v["state"], "needs_you": v["needs_you"],
                    "snippet": " ".join(a.split())[:160], "created_at": v["created_at"], "project": v["project"]})
    return out


# ---------------------------------------------------------------- the dashboard
def _quota(db: Database) -> dict | None:
    row = db.one("SELECT meta_json FROM conversation_messages WHERE meta_json LIKE '%rate_limit%' ORDER BY created_at DESC, seq DESC LIMIT 1")
    if not row:
        return None
    return ((json.loads(row["meta_json"]).get("turn") or {}).get("rate_limit")) or None


def dashboard(db: Database, settings: Settings) -> dict:
    active = db.query("SELECT r.id, r.state, t.title FROM runs r JOIN tasks t ON t.id=r.task_id WHERE r.state IN ('queued','running','awaiting_approval','blocked','interrupted') ORDER BY r.created_at DESC LIMIT 20")
    working = [r for r in active if r["state"] in ACTIVE_RUN]
    waiting = [r for r in active if r["state"] in NEEDS_YOU_RUN]
    ready = claude_ready(db)
    claude = {"id": "claude", "name": "Claude", "role": "Does the work", "how": "Runs inside AIOS with your own sign-in", "ready": ready,
              "status": "offline" if not ready else ("working" if working else ("needs_you" if waiting else "idle")),
              "doing": (working or waiting)[0]["title"] if (working or waiting) else None, "quota": _quota(db)}
    agents = [claude,
              {"id": "gemini", "name": "Gemini", "role": "Second opinions", "how": "Copy and paste: AIOS writes the prompt, you paste it", "ready": True, "status": "on_call", "doing": None, "quota": None},
              {"id": "perplexity", "name": "Perplexity", "role": "Finds sources", "how": "Copy and paste: AIOS writes the prompt, you paste it", "ready": True, "status": "on_call", "doing": None, "quota": None},
              {"id": "antigravity", "name": "Antigravity", "role": "Big coding jobs", "how": "Manual handoff only; AIOS never starts it", "ready": True, "status": "manual", "doing": None, "quota": None}]
    approvals = db.one("SELECT COUNT(*) AS n FROM approvals WHERE status='pending'")["n"]
    candidates = db.one("SELECT COUNT(*) AS n FROM memories WHERE status='candidate' AND deleted=0")["n"]
    items = [{"kind": "approval", "title": r["title"], "href": "#/inbox"} for r in db.query(
        "SELECT t.title FROM approvals a JOIN runs r ON r.id=a.run_id JOIN tasks t ON t.id=r.task_id WHERE a.status='pending' ORDER BY a.requested_at DESC LIMIT 5")]
    items += [{"kind": "blocked", "title": r["title"], "href": "#/runs"} for r in waiting if r["state"] in ("blocked", "interrupted")][:3]
    return {"agents": agents, "needs_you": {"approvals": approvals, "blocked": sum(1 for r in waiting if r["state"] in ("blocked", "interrupted")),
                                            "to_review": candidates, "items": items[:6]},
            "recent": recent(db, 8), "claude_ready": ready}
