"""Stand-in for the `claude` CLI used only by tests (never shipped as an integration).

Behaviour is set by the FAKE_CLAUDE_CONFIG env var (JSON): version, auth, outcome
("ok" | "error" | "hang"), edit (bool: fix calc.py in the cwd), log (path to append argv/env).
"""
import json
import os
import sys
import time
import uuid

cfg = json.loads(os.environ.get("FAKE_CLAUDE_CONFIG", "{}"))
args = sys.argv[1:]

if cfg.get("log"):
    with open(cfg["log"], "a", encoding="utf-8") as f:
        f.write(json.dumps({"argv": args, "cwd": os.getcwd(),
                            "api_key_present": "ANTHROPIC_API_KEY" in os.environ,
                            "bedrock_present": "CLAUDE_CODE_USE_BEDROCK" in os.environ}) + "\n")

if args == ["--version"]:
    print(cfg.get("version", "2.1.300 (Claude Code)"))
    sys.exit(0)

if args[:2] == ["auth", "status"]:
    auth = cfg.get("auth", {"loggedIn": True, "authMethod": "claude.ai", "subscriptionType": "max"})
    print(json.dumps(auth))
    sys.exit(0 if auth.get("loggedIn") else 1)

if "-p" in args:
    sid = args[args.index("--resume") + 1] if "--resume" in args else str(uuid.uuid4())
    outcome = cfg.get("outcome", "ok")
    if outcome == "hang":
        time.sleep(60)
    print(json.dumps({"type": "system", "subtype": "init", "session_id": sid,
                      "model": "fake-model", "cwd": os.getcwd()}), flush=True)
    if cfg.get("edit") and "acceptEdits" in args and os.path.exists("calc.py"):
        with open("calc.py", encoding="utf-8") as f:
            src = f.read()
        with open("calc.py", "w", encoding="utf-8") as f:
            f.write(src.replace("return a - b", "return a + b"))
    leaked = "sk-ant-" + "x" * 24  # proves transcripts are redacted
    print(json.dumps({"type": "assistant", "message": {"content": [
        {"type": "text", "text": f"working; saw {leaked}"}]}}), flush=True)
    print("not json at all", flush=True)
    is_error = outcome == "error"
    print(json.dumps({"type": "result", "subtype": "error_max_turns" if is_error else "success",
                      "is_error": is_error, "result": "Changed add to use +.",
                      "session_id": sid, "num_turns": 3, "duration_ms": 1200,
                      "total_cost_usd": 0.01,
                      "permission_denials": [{"tool_name": "Bash"}] if is_error else []}),
          flush=True)
    sys.exit(1 if is_error else 0)

print(f"fake claude: unexpected args {args}", file=sys.stderr)
sys.exit(2)
