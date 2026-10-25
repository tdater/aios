"""Stand-in for the `claude` CLI used only by tests (never shipped as an integration).

Behaviour is set by the FAKE_CLAUDE_CONFIG env var (JSON):
  version, auth            what `--version` and `auth status` report
  outcome                  "ok" | "error" | "hang" (sleeps before printing anything)
  edit                     fix calc.py in the cwd (only when run with --permission-mode acceptEdits)
  edit_files               {relative path: content} files to write in the cwd (acceptEdits only)
  extra_tools              tools reported at startup beyond the --tools allowlist
  api_key_source           reported apiKeySource (default "none")
  plugins, rate_limit      reported plugins; set rate_limit false to omit the rate-limit event
  reply                    final result text
  log                      path to append argv/env facts to
It mirrors the stream-json shapes observed from Claude Code 2.1.310 (init, assistant text and
tool_use blocks, rate_limit_event, result), so tests exercise AIOS's parsing, not Claude itself.
"""
import json
import os
import sys
import time
import uuid

cfg = json.loads(os.environ.get("FAKE_CLAUDE_CONFIG", "{}"))
args = sys.argv[1:]


def arg(name, default=None):
    return args[args.index(name) + 1] if name in args and args.index(name) + 1 < len(args) else default


if cfg.get("log"):
    with open(cfg["log"], "a", encoding="utf-8") as f:
        f.write(json.dumps({"argv": args, "cwd": os.getcwd(), "pid": os.getpid(),
                            "api_key_present": "ANTHROPIC_API_KEY" in os.environ,
                            "bedrock_present": "CLAUDE_CODE_USE_BEDROCK" in os.environ,
                            "disable_claude_mds": os.environ.get("CLAUDE_CODE_DISABLE_CLAUDE_MDS"),
                            "disable_auto_memory": os.environ.get("CLAUDE_CODE_DISABLE_AUTO_MEMORY")}) + "\n")

if args == ["--version"]:
    print(cfg.get("version", "2.1.300 (Claude Code)"))
    sys.exit(0)

if args[:2] == ["auth", "status"]:
    auth = cfg.get("auth", {"loggedIn": True, "authMethod": "claude.ai", "subscriptionType": "max"})
    print(json.dumps(auth))
    sys.exit(0 if auth.get("loggedIn") else 1)

if "-p" in args:
    if cfg.get("reject_empty_sources") and arg("--setting-sources") == "":
        print("Error processing --setting-sources: Invalid setting source: . "
              "Valid options are: user, project, local", file=sys.stderr)
        sys.exit(1)
    sid = arg("--resume") or str(uuid.uuid4())
    outcome = cfg.get("outcome", "ok")
    if outcome == "hang":
        time.sleep(60)
    tools = [t for t in (arg("--tools") or "").split(",") if t] + list(cfg.get("extra_tools", []))
    print(json.dumps({"type": "system", "subtype": "init", "session_id": sid,
                      "model": "fake-model", "cwd": os.getcwd(), "tools": tools,
                      "plugins": cfg.get("plugins", []), "mcp_servers": [],
                      "apiKeySource": cfg.get("api_key_source", "none"),
                      "permissionMode": arg("--permission-mode"), "claude_code_version": "2.1.300"}),
          flush=True)
    can_edit = "acceptEdits" == arg("--permission-mode")
    if cfg.get("edit") and can_edit and os.path.exists("calc.py"):
        with open("calc.py", encoding="utf-8") as f:
            src = f.read()
        print(json.dumps({"type": "assistant", "message": {"content": [
            {"type": "tool_use", "name": "Edit", "input": {
                "file_path": os.path.join(os.getcwd(), "calc.py"),
                "old_string": "return a - b", "new_string": "return a + b"}}]}}), flush=True)
        with open("calc.py", "w", encoding="utf-8") as f:
            f.write(src.replace("return a - b", "return a + b"))
    if cfg.get("edit_files") and can_edit:
        for rel, content in cfg["edit_files"].items():
            os.makedirs(os.path.dirname(os.path.join(os.getcwd(), rel)) or ".", exist_ok=True)
            with open(os.path.join(os.getcwd(), rel), "w", encoding="utf-8") as f:
                f.write(content)
    leaked = "sk-ant-" + "x" * 24  # proves transcripts are redacted
    print(json.dumps({"type": "assistant", "message": {"content": [
        {"type": "text", "text": f"working; saw {leaked}"}]}}), flush=True)
    print("not json at all", flush=True)
    if cfg.get("rate_limit", True):
        print(json.dumps({"type": "rate_limit_event", "rate_limit_info": {
            "status": "allowed", "overageStatus": "rejected", "unifiedWindows": {
                "five_hour": {"utilization": 0.1, "resetsAt": 1792975200, "status": "allowed"},
                "seven_day": {"utilization": 0.02, "resetsAt": 1793484000, "status": "allowed"}}}}),
              flush=True)
    is_error = outcome == "error"
    print(json.dumps({"type": "result", "subtype": "error_max_turns" if is_error else "success",
                      "is_error": is_error, "result": cfg.get("reply", "Changed add to use +."),
                      "session_id": sid, "num_turns": 3, "duration_ms": 1200,
                      "total_cost_usd": 0.01,
                      "permission_denials": [{"tool_name": "Bash"}] if is_error else []}),
          flush=True)
    sys.exit(1 if is_error else 0)

print(f"fake claude: unexpected args {args}", file=sys.stderr)
sys.exit(2)
