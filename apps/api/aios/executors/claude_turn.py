"""claude.turn: one turn of a conversation with Claude Code, run for real.

Supported execution (category A in docs/integration-findings.md): AIOS starts the unmodified
`claude` CLI in print mode with the owner's own claude.ai login. Nothing here mocks a provider.

A turn is a sequence of resume-safe steps:
  worktree  (edit turns) isolated git worktree + branch for this conversation
  context   approved notes and repository facts handed to Claude, recorded with versions
  claude    the provider turn itself (side effect: never replayed after a crash)
  patch     (edit turns) AIOS commits what Claude changed and records the diff at a pinned revision
  verification  the owner's command, run by AIOS only after the owner approves that exact action

Pass/fail comes from the verification command AIOS runs, never from the model's say-so. A failing
verification is a recorded outcome of a completed turn, not an engine error.
"""
from __future__ import annotations

import hashlib
from pathlib import Path

from .. import approvals, claude_code, context_pack, conversations, verification, worktrees
from ..engine import Blocked, RunContext, RunError, executor
from ..security import find_secret_kinds, redact
from ..util import now

VERIFY_TIMEOUT_S = 600


# ---------------------------------------------------------------- live activity
def _short(text, n: int = 240) -> str:
    text = " ".join(str(text).split())
    return text if len(text) <= n else text[: n - 1] + "…"


def _rel(path: str, cwd: Path) -> str:
    try:
        return str(Path(path).resolve().relative_to(cwd.resolve()))
    except (ValueError, OSError):
        return str(path)


def describe_tool(name: str, inp: dict, cwd: Path) -> str:
    """One readable line per tool call. Paths and patterns only, never file contents."""
    if name in ("Read", "Edit", "Write"):
        verb = {"Read": "reading", "Edit": "editing", "Write": "writing"}[name]
        return f"{verb} {_rel(inp.get('file_path', '?'), cwd)}"
    if name == "Glob":
        return f"listing files matching {_short(inp.get('pattern', '?'), 80)}"
    if name == "Grep":
        return f"searching for {_short(inp.get('pattern', '?'), 80)}"
    return f"using tool {name}"


def make_activity(ctx: RunContext, cwd: Path):
    def on_event(ev: dict) -> None:
        t = ev.get("type")
        if t == "system" and ev.get("subtype") == "init":
            ctx.event("claude", f"session started: {ev.get('model')}, tools: {', '.join(ev.get('tools') or [])}")
        elif t == "assistant":
            content = (ev.get("message") or {}).get("content")
            for b in content if isinstance(content, list) else []:
                if not isinstance(b, dict):
                    continue
                if b.get("type") == "text" and str(b.get("text", "")).strip():
                    ctx.event("claude", "says: " + _short(b["text"]))
                elif b.get("type") == "tool_use":
                    ctx.event("claude", describe_tool(str(b.get("name")), b.get("input") or {}, cwd),
                              {"tool": b.get("name")})
        elif t == "user":
            content = (ev.get("message") or {}).get("content")
            for b in content if isinstance(content, list) else []:
                if isinstance(b, dict) and b.get("type") == "tool_result" and b.get("is_error"):
                    ctx.event("claude", "tool error: " + _short(b.get("content", "")))
        elif t == "result":
            ctx.event("claude", f"finished: {ev.get('subtype')} after {ev.get('num_turns')} turn(s)")
    return on_event


# ---------------------------------------------------------------- steps
def _step_done(ctx: RunContext, name: str) -> bool:
    row = ctx.db.one("SELECT state FROM steps WHERE run_id=? AND name=?", (ctx.run_id, name))
    return bool(row and row["state"] == "done")


def _ensure_worktree(ctx: RunContext, conv: dict, repo: Path) -> dict:
    if worktrees.worktree_ok(conv["worktree_path"]):
        return {"path": conv["worktree_path"], "branch": conv["branch"],
                "base_revision": conv["base_revision"], "created": False}
    st = worktrees.repo_state(repo)
    if not st["usable"]:
        conversations.note_once(ctx.db, conv["id"], ctx.run_id, st["reason"])
        raise Blocked(st["reason"], code="repo_not_ready")
    info = worktrees.create_worktree(repo, ctx.settings.worktrees_dir / conv["id"], f"aios/{conv['id']}")
    conversations.set_worktree(ctx.db, conv["id"], info["path"], info["branch"], info["base_revision"])
    note = (f"Created an isolated git worktree on branch {info['branch']} from revision "
            f"{info['base_revision'][:12]}. Your project folder is not touched.")
    if info["dirty_source"]:
        note += " Your project folder has uncommitted changes; they are not included in the worktree."
    ctx.add_evidence("worktree", note)
    conversations.note_once(ctx.db, conv["id"], ctx.run_id, note)
    return {**info, "created": True}


def make_probe(ctx: RunContext):
    """Watchdog callback for claude_code.run: heartbeat the run and report a cancel request. It runs
    every second on its own thread, so a silent provider is still stopped and the run never looks stalled."""
    def probe() -> bool:
        ctx.db.execute("UPDATE runs SET updated_at=? WHERE id=? AND state='running'", (now(), ctx.run_id))
        row = ctx.db.one("SELECT cancel_requested_at FROM runs WHERE id=?", (ctx.run_id,))
        return bool(row and row["cancel_requested_at"])
    return probe


def isolation_problems(res, summary: dict) -> list[str]:
    """Why a provider run cannot be trusted, judged from what Claude Code itself reported at startup."""
    problems = []
    if res.unexpected_tools:
        problems.append(f"Claude reported tools AIOS did not allow: {', '.join(res.unexpected_tools)}")
    if res.external_plugins:
        problems.append("plugins loaded: " + ", ".join(map(str, summary["external_plugins"])))
    if res.mcp_servers:
        problems.append("MCP servers loaded: " + ", ".join(map(str, summary["mcp_servers"])))
    if res.api_key_source not in (None, "none"):
        problems.append(f"API key source was '{res.api_key_source}', not the subscription login")
    return problems


def failure_reason(res, timeout: int) -> str | None:
    if res.cancelled:
        return "you cancelled it"
    if res.timed_out:
        return f"it timed out after {timeout}s"
    if not res.ok:
        return (f"Claude Code ended with '{res.subtype or 'no result'}' (exit code {res.exit_code})"
                + (f": {redact(res.stderr).strip()[-300:]}" if res.stderr.strip() else ""))
    return None


def _run_turn(ctx: RunContext, conv: dict, msg: dict, mode: str, cwd: Path, pack, pf) -> dict:
    db, settings = ctx.db, ctx.settings
    stream_dir = settings.runs_dir / ctx.run_id
    stream_dir.mkdir(parents=True, exist_ok=True)
    stream = stream_dir / "claude-stream.jsonl"

    timeout = max(60, min(int(ctx.spec.get("timeout_s", 1200)), ctx.run["deadline_s"] - 90))
    res = claude_code.run(
        cwd, context_pack.wrap_prompt(pack, msg["content"]), exe=pf.exe, mode=mode,
        max_turns=int(ctx.spec.get("max_turns", 20)), timeout_s=timeout, resume=conv["session_id"],
        append_system_prompt=context_pack.OPERATING_RULES, model=conv["model"],
        on_event=make_activity(ctx, cwd), transcript=stream, should_cancel=make_probe(ctx))

    ctx.add_artifact("claude_transcript", "claude-transcript.jsonl",
                     stream.read_text(encoding="utf-8", errors="replace") if stream.exists() else "",
                     provenance=f"claude-code {res.client_version or pf.version}, stream-json, secrets redacted")
    conversations.set_session(db, conv["id"], res.session_id)

    summary = res.summary()
    summary["role"] = "writer"
    text = summary.pop("result")
    problems = isolation_problems(res, summary)
    why = failure_reason(res, timeout)

    turn_meta = {"turn": summary, "mode": mode, "context_items": len(pack.items)}
    author = f"claude-code {res.client_version or pf.version} ({res.model or 'default model'})"
    if text.strip() and not res.cancelled:
        conversations.add_message(db, conv["id"], role="assistant", author_kind="provider", author=author,
                                  content=text, run_id=ctx.run_id, meta=turn_meta)
        turn_meta = {"turn": summary}          # already stored on the reply
    if why:
        conversations.add_message(db, conv["id"], role="system", author_kind="aios", author="aios",
                                  kind="status", content=f"Claude's turn did not complete: {why}.",
                                  run_id=ctx.run_id, meta=turn_meta)
    if problems:
        conversations.add_message(db, conv["id"], role="system", author_kind="aios", author="aios",
                                  kind="status", run_id=ctx.run_id, meta=turn_meta,
                                  content="Isolation check FAILED, so AIOS will not use this result: "
                                          + "; ".join(problems) + ".")
    if res.ok and not text.strip():
        conversations.add_message(db, conv["id"], role="system", author_kind="aios", author="aios",
                                  kind="status", run_id=ctx.run_id, meta=turn_meta,
                                  content="Claude finished without writing a reply.")
    ctx.add_evidence("provider_turn", f"claude-code {res.client_version}: {res.subtype}, "
                     f"{res.num_turns} turn(s), model {res.model}, tools {','.join(res.tools)}, "
                     f"api_key_source {res.api_key_source}, isolated={res.isolated}")
    return {"ok": res.ok, "why": why, "problems": problems, "session_id": res.session_id,
            "num_turns": res.num_turns, "model": res.model, "rate_limit": res.rate_limit}


def _collect_patch(ctx: RunContext, conv: dict, wt: dict, msg: dict) -> dict:
    cwd, base = Path(wt["path"]), wt["base_revision"]
    title = " ".join(msg["content"].split())[:60]
    new_commit = worktrees.commit_all(cwd, f"AIOS: {title}", ctx.settings.empty_hooks_dir)
    tip = new_commit or worktrees.head(cwd)
    files = worktrees.changed_files(cwd, base, tip)
    base_out = {"changed": bool(files), "new_commit": bool(new_commit), "head": tip, "base": base,
                "files": files}
    if not files:
        conversations.add_message(ctx.db, conv["id"], role="system", author_kind="aios", author="aios",
                                  kind="patch", run_id=ctx.run_id, meta={"changed": False},
                                  content="Claude made no file changes.")
        return base_out
    text, truncated = worktrees.diff_text(cwd, base, tip)
    data = text.encode("utf-8")
    added, removed = worktrees.numstat(cwd, base, tip)
    sensitive = worktrees.sensitive_paths(files)
    secrets = find_secret_kinds(text)
    # bytes on purpose: stored faithfully so the patch still applies; display paths redact on read
    art = ctx.add_artifact("patch", "changes.patch", data,
                           provenance=f"git diff {base[:12]}..{tip[:12]} on {conv['branch']}")
    sha = hashlib.sha256(data).hexdigest()
    conversations.set_head(ctx.db, conv["id"], tip)
    ctx.add_evidence("patch", f"{len(files)} file(s), +{added} -{removed}, {base[:12]}..{tip[:12]}, sha256 {sha[:12]}")
    lines = [f"Proposed change: {len(files)} file(s), +{added} -{removed}, revision {base[:12]}..{tip[:12]} "
             f"on branch {conv['branch']}."]
    lines += [f"  {f['status']} {f['path']}" for f in files[:40]]
    if sensitive:
        lines.append("Review these carefully before applying; they run code or change tool behaviour: "
                     + ", ".join(sensitive))
    if secrets:
        lines.append("The patch may contain secret-like values of kind: " + ", ".join(secrets))
    if truncated:
        lines.append("The diff is larger than AIOS shows and was cut off in the stored patch.")
    meta = {"changed": True, "artifact_id": art, "sha256": sha, "base_revision": base, "head_revision": tip,
            "files": files, "added": added, "removed": removed, "sensitive_paths": sensitive,
            "possible_secret_kinds": secrets, "truncated": truncated}
    conversations.add_message(ctx.db, conv["id"], role="system", author_kind="aios", author="aios",
                              kind="patch", run_id=ctx.run_id, meta=meta, content="\n".join(lines))
    return {**base_out, "sha256": sha, "artifact_id": art, "added": added, "removed": removed}


def _verify(ctx: RunContext, conv: dict, argv: list[str], cwd: Path, patch: dict) -> dict:
    timeout = int(ctx.spec.get("verify_timeout_s", VERIFY_TIMEOUT_S))
    shown = " ".join(argv)
    action = {"type": "run_verification", "argv": argv, "cwd": str(cwd), "head_revision": patch["head"],
              "patch_sha256": patch["sha256"], "timeout_s": timeout}
    state, _ = approvals.status_for(ctx.db, ctx.run_id, action)
    if state in ("none", "pending"):
        conversations.note_once(
            ctx.db, conv["id"], ctx.run_id,
            f"Waiting for your approval to run `{shown}` against revision {patch['head'][:12]}. "
            "This runs code Claude just wrote, with your Windows account's rights. Review the change, "
            "then approve or reject it in Approvals.")

    def perform() -> dict:
        try:
            return verification.run_command(argv, cwd, timeout_s=timeout)
        except verification.VerifyError as e:   # the approval is spent; record why nothing ran
            return {"argv": argv, "program": None, "cwd": str(cwd), "exit_code": None, "passed": False,
                    "timed_out": False, "duration_s": 0, "output_truncated": False, "error": True,
                    "output": f"AIOS could not start the command: {e}"}

    result = ctx.guarded_action(
        action, f"Run `{shown}` against revision {patch['head'][:12]} ({len(patch['files'])} file(s) changed) "
                "in an isolated worktree", perform)
    return ctx.step("verification_record", lambda: _record_verification(ctx, conv, result, patch))


def _record_verification(ctx: RunContext, conv: dict, r: dict, patch: dict) -> dict:
    status = "PASSED" if r["passed"] else "FAILED"
    report = (f"Command: {' '.join(r['argv'])}\nProgram: {r.get('program')}\nWorking directory: {r['cwd']}\n"
              f"Revision: {patch['head']}\nExit code: {r['exit_code']}\nDuration: {r['duration_s']}s\n"
              f"Timed out: {r['timed_out']}\nRun by: AIOS (not by the model)\n\n--- output ---\n{r['output']}")
    art = ctx.add_artifact("verification", "verification.txt", report, provenance="run by AIOS, not by the model")
    ctx.add_evidence("verification", f"{status}: `{' '.join(r['argv'])}` exit {r['exit_code']} in "
                     f"{r['duration_s']}s at {patch['head'][:12]}", art)
    tail = r["output"][-3000:]
    conversations.add_message(
        ctx.db, conv["id"], role="system", author_kind="aios", author="aios", kind="verification",
        run_id=ctx.run_id, content=(f"Verification {status}: `{' '.join(r['argv'])}` exited {r['exit_code']} in "
                                    f"{r['duration_s']}s against revision {patch['head'][:12]}.\n\n{tail}"),
        meta={"passed": r["passed"], "exit_code": r["exit_code"], "duration_s": r["duration_s"],
              "argv": r["argv"], "head_revision": patch["head"], "artifact_id": art,
              "timed_out": r["timed_out"], "output_truncated": r.get("output_truncated", False)})
    if r["passed"]:
        try:                               # a passed check becomes a candidate fact; never able to break the run
            from .. import memory_capture
            memory_capture.from_passed_verification(ctx.db, ctx.settings, conv, r["argv"], patch["head"])
        except Exception:  # noqa: BLE001
            pass
    return {"passed": r["passed"], "artifact_id": art}


# ---------------------------------------------------------------- executor
@executor("claude.turn")
def claude_turn(ctx: RunContext) -> dict:
    db, settings = ctx.db, ctx.settings
    conv = conversations.get(db, str(ctx.spec.get("conversation_id", "")))
    msg = db.one("SELECT * FROM conversation_messages WHERE id=?", (str(ctx.spec.get("message_id", "")),))
    mode = ctx.spec.get("mode", "read")
    if not conv or not msg or not ctx.workspace or mode not in claude_code.MODES:
        raise RunError("the conversation, its message or its project folder no longer exists")
    cid, repo = conv["id"], Path(ctx.workspace["path"])
    argv = conversations.verify_argv(db, conv["project_id"])

    pf = None
    if not _step_done(ctx, "claude"):
        try:
            pf = claude_code.preflight()
        except claude_code.ClaudeUnavailable as e:
            conversations.note_once(db, cid, ctx.run_id, f"Claude Code is not usable right now: {e}")
            raise Blocked(f"Claude Code is not usable: {e}", code="provider_unavailable") from e
        ctx.event("provider", f"Claude Code {pf.version}; {pf.auth_method} login; plan {pf.plan}", pf.public())

    wt = None
    if mode == "edit" or worktrees.worktree_ok(conv["worktree_path"]):
        wt = ctx.step("worktree", lambda: _ensure_worktree(ctx, conv, repo), side_effect=True)
        conv = conversations.get(db, cid)
    cwd = Path(wt["path"]) if wt else repo

    def make_context() -> dict:
        pack = context_pack.build(db, settings, project_id=conv["project_id"], prompt=msg["content"], mode=mode,
                                  branch=(wt or {}).get("branch"), base_revision=(wt or {}).get("base_revision"),
                                  verify_argv=argv)
        context_pack.record(db, cid, ctx.run_id, pack.items)
        notes = sum(1 for i in pack.items if i["kind"] == "memory")
        ctx.add_evidence("context", f"supplied {len(pack.items)} item(s) to Claude, {notes} of them approved note(s)")
        return {"text": redact(pack.text), "items": pack.items}
    packed = ctx.step("context", make_context)
    pack = context_pack.ContextPack(text=packed["text"], items=packed["items"])

    out = ctx.step("claude", lambda: _run_turn(ctx, conv, msg, mode, cwd, pack, pf), side_effect=True)
    ctx.check()                                    # a cancel requested during the turn stops here
    if not out["ok"]:
        raise RunError(f"Claude Code turn did not complete: {out['why']}")
    if out["problems"]:
        raise RunError("isolation check failed: " + "; ".join(out["problems"]))

    patch, verified = None, None
    if mode == "edit" and wt:
        patch = ctx.step("patch", lambda: _collect_patch(ctx, conv, wt, msg), side_effect=True)
        if patch["changed"] and patch["new_commit"]:
            if argv:
                verified = _verify(ctx, conv, argv, cwd, patch)
            else:
                conversations.note_once(
                    db, cid, ctx.run_id,
                    "No verification command is set for this project, so these changes have not been tested. "
                    "Set one (an argv list) to have AIOS run it against future changes.")
    return {"summary": ("proposed a change" + ("" if verified is None else
                                               (", verification passed" if verified["passed"]
                                                else ", verification FAILED"))
                        if patch and patch["changed"] else "turn completed"),
            "mode": mode, "changed": bool(patch and patch["changed"]),
            "verified": None if verified is None else verified["passed"],
            "head_revision": (patch or {}).get("head"), "session_id": out["session_id"]}
