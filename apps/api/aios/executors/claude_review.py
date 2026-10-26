"""claude.review: an independent Claude Code session reviews a patch at a pinned revision.

Supported execution (category A), same transport and isolation as claude.turn, with these differences
that make the review independent of the writer:
  * a fresh session: never resumed, and its session id is never stored over the writer's;
  * a separate detached checkout of the exact reviewed revision, removed afterwards;
  * read-only tools only;
  * its only inputs are the owner's request, the diff, the recorded verification result and the
    project's approved notes. It never sees the writer's replies or reasoning;
  * its findings are checked by AIOS against the checkout (`grounded`), and whether a change is ready
    is decided by reviewer.readiness() from recorded facts, never by the reviewer.
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

from .. import claude_code, context_pack, conversations, reviewer, worktrees
from ..engine import Blocked, RunContext, RunError, executor
from ..security import redact
from .claude_turn import (_step_done, failure_reason, isolation_problems, make_activity, make_probe)

REVIEW_MAX_TURNS = 15
REVIEW_TIMEOUT_S = 900


def default_reviewer_model(writer_model: str | None) -> str:
    """A different model from the writer's when we can tell: cheap diversity of blind spots."""
    return "opus" if writer_model and "sonnet" in writer_model.lower() else "sonnet"


def _verification_for(db, conversation_id: str, head: str) -> dict | None:
    for row in db.query("SELECT content, meta_json FROM conversation_messages WHERE conversation_id=? "
                        "AND kind='verification' ORDER BY seq DESC", (conversation_id,)):
        meta = json.loads(row["meta_json"] or "{}")
        if meta.get("head_revision") == head:
            tail = row["content"].split("\n\n", 1)[1][-2000:] if "\n\n" in row["content"] else ""
            return {"argv": meta.get("argv", []), "passed": bool(meta.get("passed")),
                    "exit_code": meta.get("exit_code"), "output_tail": tail}
    return None


def _readiness_note(ctx: RunContext, cid: str) -> None:
    ch = conversations.changes(ctx.db, cid)
    r = ch["readiness"]
    verdict = "READY" if r["ready"] else "NOT READY"
    conversations.add_message(
        ctx.db, cid, role="system", author_kind="aios", author="aios", kind="status", run_id=ctx.run_id,
        content=f"AIOS readiness for revision {str(r['head_revision'])[:12]}: {verdict}. "
                + ("; ".join(r["reasons"]) if r["reasons"] else "Verification passed and no high-severity findings."),
        meta={"readiness": r})


@executor("claude.review")
def claude_review(ctx: RunContext) -> dict:
    db, settings = ctx.db, ctx.settings
    conv = conversations.get(db, str(ctx.spec.get("conversation_id", "")))
    patch_msg = db.one("SELECT * FROM conversation_messages WHERE id=? AND kind='patch'",
                       (str(ctx.spec.get("patch_message_id", "")),))
    if not conv or not patch_msg or patch_msg["conversation_id"] != conv["id"] or not ctx.workspace:
        raise RunError("the conversation or the patch to review no longer exists")
    pmeta = json.loads(patch_msg["meta_json"] or "{}")
    if not pmeta.get("changed"):
        raise RunError("that patch message records no change, so there is nothing to review")
    cid, repo = conv["id"], Path(ctx.workspace["path"])
    head, base = pmeta["head_revision"], pmeta["base_revision"]
    model = ctx.spec.get("model") or default_reviewer_model(conv["model"])
    task_row = db.one("SELECT content, meta_json FROM conversation_messages WHERE conversation_id=? AND run_id=? "
                      "AND role='user'", (cid, patch_msg["run_id"]))
    task = task_row["content"] if task_row else "(the request that produced this change could not be found)"
    original = ((json.loads(task_row["meta_json"] or "{}").get("workflow") or {}).get("request") if task_row else None)
    if original:          # a workflow correction round: the reviewer judges the change against the owner's request,
        task = original   # not against the earlier reviewer's findings



    pf = None
    if not _step_done(ctx, "claude"):
        try:
            pf = claude_code.preflight()
        except claude_code.ClaudeUnavailable as e:
            conversations.note_once(db, cid, ctx.run_id, f"Claude Code is not usable right now: {e}")
            raise Blocked(f"Claude Code is not usable: {e}", code="provider_unavailable") from e

    def make_checkout() -> dict:
        dest = settings.worktrees_dir / f"{cid}-rev-{ctx.run_id[-8:]}"
        got = worktrees.create_detached(repo, dest, head)
        if got != head:
            raise RunError(f"checkout is at {got[:12]}, not the revision under review {head[:12]}")
        return {"path": str(dest), "head": got}
    co = ctx.step("checkout", make_checkout, side_effect=True)
    cwd = Path(co["path"])
    try:
        def make_input() -> dict:
            text, truncated = worktrees.diff_text(cwd, base, head)
            if not truncated and hashlib.sha256(text.encode("utf-8")).hexdigest() != pmeta.get("sha256"):
                raise RunError("the diff git reports for these revisions no longer matches the recorded "
                               "patch, so AIOS will not review it as the recorded patch")
            body = reviewer.build_input(task=task, diff=text, diff_truncated=truncated,
                                        verification=_verification_for(db, cid, head),
                                        sensitive_paths=worktrees.sensitive_paths(pmeta.get("files", [])),
                                        base=base, head=head)
            pack = context_pack.build(db, settings, project_id=conv["project_id"], prompt=task, mode="read",
                                      branch=conv["branch"], base_revision=base,
                                      verify_argv=conversations.verify_argv(db, conv["project_id"]))
            context_pack.record(db, cid, ctx.run_id, pack.items)
            full = f"<aios_context>\n{redact(pack.text)}\n</aios_context>\n\n{body}"
            ctx.add_artifact("review_input", "review-input.txt", full,
                             provenance="exactly what the reviewer was given; contains no writer replies")
            ctx.add_evidence("review_input", f"reviewer input: request, diff {base[:12]}..{head[:12]}, "
                             f"verification {'included' if _verification_for(db, cid, head) else 'absent'}, "
                             f"{sum(1 for i in pack.items if i['kind'] == 'memory')} approved note(s)")
            return {"prompt": full}
        prompt = ctx.step("review_input", make_input)["prompt"]

        def run_review() -> dict:
            stream_dir = settings.runs_dir / ctx.run_id
            stream_dir.mkdir(parents=True, exist_ok=True)
            stream = stream_dir / "claude-stream.jsonl"
            timeout = max(60, min(int(ctx.spec.get("timeout_s", REVIEW_TIMEOUT_S)), ctx.run["deadline_s"] - 90))
            res = claude_code.run(
                cwd, prompt, exe=pf.exe, mode="read", max_turns=REVIEW_MAX_TURNS, timeout_s=timeout,
                resume=None, append_system_prompt=reviewer.REVIEW_RULES, model=model,
                on_event=make_activity(ctx, cwd), transcript=stream, should_cancel=make_probe(ctx),
                json_schema=reviewer.REVIEW_SCHEMA)
            ctx.add_artifact("claude_transcript", "claude-transcript.jsonl",
                             stream.read_text(encoding="utf-8", errors="replace") if stream.exists() else "",
                             provenance=f"claude-code {res.client_version or pf.version} reviewer, secrets redacted")
            summary = res.summary()
            summary["role"] = "reviewer"
            summary.pop("result", None)
            problems = isolation_problems(res, summary)
            why = failure_reason(res, timeout)
            if res.ok and res.structured_output is None:
                why = "the reviewer did not return structured findings"
            findings = reviewer.normalize_findings(res.structured_output, cwd) if not why else []
            by_sev = reviewer.counts(findings)
            author = f"claude-code {res.client_version or pf.version} ({res.model or model}), independent reviewer"
            meta = {"turn": summary,
                    "review": {"reviewed_revision": head, "base_revision": base, "patch_sha256": pmeta.get("sha256"),
                               "findings": findings, "counts": by_sev,
                               "summary": redact(str((res.structured_output or {}).get("summary", "")))[:2000],
                               "model": res.model, "session_id": res.session_id,
                               "writer_session_id": conv["session_id"],
                               "separate_session": bool(res.session_id and res.session_id != conv["session_id"])}}
            if problems:
                conversations.add_message(
                    db, cid, role="system", author_kind="aios", author="aios", kind="status", run_id=ctx.run_id,
                    meta={"turn": summary},
                    content="Isolation check FAILED, so AIOS will not use this review: " + "; ".join(problems) + ".")
            elif why:
                conversations.add_message(db, cid, role="system", author_kind="aios", author="aios", kind="status",
                                          run_id=ctx.run_id, meta={"turn": summary},
                                          content=f"The review did not complete: {why}.")
            else:
                lines = [meta["review"]["summary"] or "(no summary)",
                         f"{len(findings)} finding(s): {by_sev['high']} high, {by_sev['medium']} medium, "
                         f"{by_sev['low']} low."]
                for f in findings:
                    loc = ""
                    if f["file"]:
                        loc = (f" [{f['file']}" + (f":{f['line']}" if f["line"] else "")
                               + ("" if f["grounded"] else ", location not found") + "]")
                    lines.append(f"- {f['severity'].upper()}: {f['title']}{loc}")
                conversations.add_message(db, cid, role="assistant", author_kind="provider", author=author,
                                          kind="review", content="\n".join(lines), run_id=ctx.run_id, meta=meta)
            ctx.add_evidence("provider_review", f"claude-code {res.client_version}: {res.subtype}, model {res.model}, "
                             f"tools {','.join(res.tools)}, findings {by_sev}, isolated={res.isolated}")
            return {"ok": res.ok and not why, "why": why, "problems": problems, "counts": by_sev,
                    "separate_session": meta["review"]["separate_session"], "rate_limit": res.rate_limit}
        out = ctx.step("claude", run_review, side_effect=True)
        ctx.check()
        if out["problems"]:
            raise RunError("isolation check failed: " + "; ".join(out["problems"]))
        if not out["ok"]:
            raise RunError(f"review did not complete: {out['why']}")
        ctx.step("readiness", lambda: _readiness_note(ctx, cid) or {"done": True})
        return {"summary": f"review of {head[:12]}: {out['counts']}", "reviewed_revision": head,
                "counts": out["counts"], "model": model}
    finally:
        if not worktrees.remove_worktree(repo, cwd):
            conversations.note_once(db, cid, ctx.run_id, f"The temporary review checkout {cwd} could not be removed; "
                                    "it is safe to delete.")
