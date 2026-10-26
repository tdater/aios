"""claude.apply: merge one reviewed revision into the owner's real project, after an approval bound to the exact action.

Nothing here trusts a model. The change must already be READY by AIOS's own rules, the conversation branch must still
point at the approved revision, and the project must be exactly where the owner saw it when approving. The owner's own
repository hooks are off for the merge. Anything unexpected stops the run before the project is touched."""
from __future__ import annotations

import json
from pathlib import Path

from .. import conversations, worktrees
from ..engine import RunContext, RunError, executor
from .claude_turn import _step_done  # noqa: F401  (kept for symmetry with the other executors)


def _problem(ctx: RunContext, conv: dict, text: str) -> RunError:
    conversations.add_message(ctx.db, conv["id"], role="system", author_kind="aios", author="aios", kind="status",
                              run_id=ctx.run_id, content=f"Not applied: {text}")
    return RunError(text)


@executor("claude.apply")
def claude_apply(ctx: RunContext) -> dict:
    db = ctx.db
    conv = conversations.get(db, str(ctx.spec.get("conversation_id", "")))
    patch_msg = db.one("SELECT * FROM conversation_messages WHERE id=? AND kind='patch'", (str(ctx.spec.get("patch_message_id", "")),))
    if not conv or not patch_msg or patch_msg["conversation_id"] != conv["id"] or not ctx.workspace:
        raise RunError("the conversation, its change or its project folder no longer exists")
    pmeta = json.loads(patch_msg["meta_json"] or "{}")
    head, base = pmeta.get("head_revision"), pmeta.get("base_revision")
    repo = Path(ctx.workspace["path"])

    ch = conversations.changes(db, conv["id"])
    ready = ch["readiness"]
    if not pmeta.get("changed") or not head or ready["head_revision"] != head:
        raise _problem(ctx, conv, "this is no longer the latest change in the conversation. Ask again from the Outcome tab.")
    if not ready["ready"]:
        raise _problem(ctx, conv, "AIOS does not consider this change ready: " + "; ".join(ready["reasons"]))
    if worktrees.branch_tip(repo, conv["branch"] or "") != head:
        raise _problem(ctx, conv, "the conversation's branch no longer points at the reviewed revision, so AIOS will not merge it.")
    st = worktrees.repo_state(repo)
    if not st["usable"]:
        raise _problem(ctx, conv, st["reason"])
    if st["dirty"]:
        raise _problem(ctx, conv, "your project folder has uncommitted changes. Commit or stash them, then ask again.")
    if not st["branch"]:
        raise _problem(ctx, conv, "your project is not on a branch (detached HEAD). Switch to a branch, then ask again.")

    files = [f["path"] for f in pmeta.get("files", [])]
    action = {"type": "apply_revision", "project_path": str(repo), "branch": conv["branch"], "head_revision": head,
              "base_revision": base, "target_branch": st["branch"], "target_head": st["head"],
              "patch_sha256": pmeta.get("sha256"), "files": files[:50], "sensitive_paths": pmeta.get("sensitive_paths", [])}
    title = (db.one("SELECT title FROM conversations WHERE id=?", (conv["id"],)) or {"title": "change"})["title"]
    message = f"Apply AIOS change: {title[:60]}\n\nRevision {head[:12]} from branch {conv['branch']}, checked by AIOS."

    def perform() -> dict:
        try:
            return worktrees.apply_revision(repo, revision=head, expected_branch=st["branch"], expected_head=st["head"],
                                            message=message, hooks_dir=ctx.settings.empty_hooks_dir)
        except worktrees.GitError as e:       # the approval is spent; record why nothing changed
            return {"applied": False, "reason": str(e)}

    conversations.note_once(db, conv["id"], ctx.run_id,
                            f"Waiting for your approval to add revision {head[:12]} ({len(files)} file(s)) to your real project "
                            f"on branch '{st['branch']}'. Review it in Approvals; nothing is changed until you approve.")
    result = ctx.guarded_action(
        action, f"Merge revision {head[:12]} ({len(files)} file(s)) into your project's branch '{st['branch']}'", perform)

    def record() -> dict:
        if result.get("applied"):
            text = (f"Applied to your project: revision {head[:12]} was merged into '{st['branch']}' as commit {result['commit'][:12]}. "
                    + ("The result is identical to what was tested." if result.get("tree_matches_reviewed")
                       else "Your branch had other changes, so the merged result differs from what was tested. Run your tests on it."))
        else:
            text = f"Not applied: {result.get('reason', 'unknown reason')}."
        conversations.add_message(db, conv["id"], role="system", author_kind="aios", author="aios", kind="status", run_id=ctx.run_id,
                                  meta={"applied": {**result, "head_revision": head, "target_branch": st["branch"]}}, content=text)
        ctx.add_evidence("apply", text)
        return result
    out = ctx.step("apply_record", record)
    if not out.get("applied"):
        raise RunError(out.get("reason", "the change was not applied"))
    return {"summary": f"applied revision {head[:12]} as {out['commit'][:12]}", "commit": out["commit"]}
