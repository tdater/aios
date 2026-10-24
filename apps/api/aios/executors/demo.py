"""Demo/test executors exercising approvals, limits, retries, and crash recovery."""
from __future__ import annotations

import time

from ..engine import Blocked, RetryableError, RunContext, executor
from ..security import resolve_within


@executor("demo.guarded_write")
def guarded_write(ctx: RunContext) -> dict:
    """Writes a marker file under the artifact dir only after an exact-action approval."""
    fname = ctx.spec["filename"]
    content = ctx.spec["content"]
    base = ctx.settings.artifacts_dir / "guarded"
    base.mkdir(parents=True, exist_ok=True)
    target = resolve_within(base, fname)
    action = {"type": "write_file", "path": str(target), "content": content}

    def perform():
        target.write_text(content, encoding="utf-8")
        return {"written": str(target)}
    out = ctx.guarded_action(action, f"Write {len(content)} chars to {target}", perform)
    ctx.add_evidence("effect", f"wrote {target}")
    return {"summary": "guarded write complete", "written": out["written"]}


@executor("demo.loop")
def loop(ctx: RunContext) -> dict:
    for _ in range(ctx.spec.get("iterations", 10)):
        ctx.tick()
        if ctx.spec.get("sleep"):
            time.sleep(ctx.spec["sleep"])
    return {"summary": "loop finished"}


@executor("demo.quota")
def quota(ctx: RunContext) -> dict:
    """Test seam: reports what a real provider quota stop will look like."""
    raise Blocked("provider quota exhausted; AIOS will not switch to paid access", code="quota_exhausted")


@executor("demo.slow_steps")
def slow_steps(ctx: RunContext) -> dict:
    """Test seam: several steps with a pause, so cancellation can be requested mid-run."""
    for i in range(ctx.spec.get("steps", 5)):
        ctx.step(f"s{i}", lambda: time.sleep(ctx.spec.get("pause", 0.2)) or {"i": i})
    return {"summary": "all steps done"}


@executor("demo.flaky")
def flaky(ctx: RunContext) -> dict:
    fail_n = ctx.spec.get("fail_times", 1)
    if ctx.run["attempt"] <= fail_n:
        raise RetryableError(ctx.spec.get("message", f"transient failure on attempt {ctx.run['attempt']}"))
    return {"summary": f"succeeded on attempt {ctx.run['attempt']}"}
