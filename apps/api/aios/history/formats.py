"""Format detection and parsing for approved history sources. Formats are DETECTED from file
structure; anything unrecognised raises Unsupported and is reported, never silently skipped.

NOTE: structures below follow public knowledge of Claude Code JSONL transcripts, claude.ai and
ChatGPT exports. They are validated against synthetic fixtures only until real approved files exist."""
from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass, field
from pathlib import Path

PARSER_VERSION = 1
MAX_BYTES = 150 * 1024 * 1024


class Unsupported(Exception):
    pass


@dataclass
class Msg:
    session: str
    role: str
    kind: str
    text: str
    ref: str
    ts: str | None = None
    uid: str | None = None          # stable id from the source, when it has one
    test_outcome: str | None = None


@dataclass
class Parsed:
    format: str
    provider: str
    messages: list[Msg] = field(default_factory=list)
    cwd: str | None = None
    gaps: list[str] = field(default_factory=list)


SYSTEM_BLOCK = re.compile(r"<(system-reminder|command-[a-z-]+|local-command-[a-z]+|user-prompt-submit-hook)>.*?</\1>",
                          re.S)
CONFIRM = re.compile(r"^\s*(yes|yep|yeah|that worked|it works|works now|worked|fixed( it)?|perfect|great|"
                     r"looks good|confirmed|that did it|all good)\b[\s\w,.!'-]{0,60}$", re.I)
TEST_CMD = re.compile(r"\b(pytest|vitest|jest|gradlew?(\.bat)?\s+\S*test|gradle\s+\S*test|npm (run )?test|"
                      r"cargo test|dotnet test|go test|mvn test|connectedAndroidTest|lint)\b", re.I)
FAIL = re.compile(r"(\bFAILED\b|\bFAIL\b|\d+ failed|BUILD FAILED|\bERROR\b.*test|Tests run:.*Failures: [1-9]|"
                  r"AssertionError|Traceback \(most recent call last\))", re.I)
PASS = re.compile(r"(\d+ passed|BUILD SUCCESSFUL|\bOK\b$|Tests run:.*Failures: 0|All checks passed|"
                  r"Test Files\s+\d+ passed)", re.I | re.M)
INJECTION = re.compile(
    r"(ignore (all |any |the )?(previous|prior|above) (instructions|rules)|disregard .{0,40}instructions|"
    r"you are now\b|new system prompt|auto-?approve|approve (all|every)\b|reveal .{0,30}(key|token|password|secret)|"
    r"curl [^|\n]*\|\s*(ba)?sh|rm -rf\s+/|run the following command)", re.I)


def classify_tool_output(text: str, command: str | None) -> tuple[str, str | None]:
    """Return (kind, test_outcome). Test results need a test-like command or a real test summary."""
    looks_test = bool(command and TEST_CMD.search(command)) or bool(
        re.search(r"(\d+ (passed|failed)|BUILD (SUCCESSFUL|FAILED)|Tests run:|Test Files)", text))
    if not looks_test:
        return "tool_output", None
    if FAIL.search(text):
        return "test_result", "fail"
    if PASS.search(text):
        return "test_result", "pass"
    return "tool_output", None


def _clean_user_text(t: str) -> str:
    return SYSTEM_BLOCK.sub("", t).strip()


def _flat(content) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "\n".join(b.get("text", "") for b in content if isinstance(b, dict) and b.get("type") == "text")
    return ""


def _user_kind(text: str, prev_assistant: bool) -> str:
    return "user_confirmation" if prev_assistant and CONFIRM.match(text) else "user_statement"


def parse_claude_code(lines: list[dict], name: str) -> Parsed:
    p = Parsed("claude_code_session", "claude_code")
    tools: dict[str, tuple[str, str | None]] = {}
    prev_assistant = False
    for i, o in enumerate(lines):
        t = o.get("type")
        if t not in ("user", "assistant"):
            continue
        sess = str(o.get("sessionId") or name)
        p.cwd = p.cwd or o.get("cwd")
        m = o.get("message") or {}
        content = m.get("content")
        ts, uid, ref = o.get("timestamp"), o.get("uuid"), f"{name}:L{i + 1}"
        blocks = [{"type": "text", "text": content}] if isinstance(content, str) else (content or [])
        for j, b in enumerate(blocks):
            if not isinstance(b, dict):
                continue
            bid = f"{uid}#{j}" if uid else None
            bt = b.get("type")
            if bt == "text":
                text = b.get("text", "")
                if t == "assistant":
                    if text.strip():
                        p.messages.append(Msg(sess, "assistant", "assistant_suggestion", text, ref, ts, bid))
                        prev_assistant = True
                else:
                    if o.get("isMeta"):
                        continue
                    clean = _clean_user_text(text)
                    if clean:
                        p.messages.append(Msg(sess, "user", _user_kind(clean, prev_assistant), clean, ref, ts, bid))
                        prev_assistant = False
                    elif text.strip():
                        p.messages.append(Msg(sess, "system", "system_injected", "[harness-injected text]", ref, ts, bid))
            elif bt == "tool_use":
                inp = b.get("input") or {}
                cmd = inp.get("command") if isinstance(inp, dict) else None
                tools[b.get("id", "")] = (b.get("name", ""), cmd)
                if cmd and b.get("name") in ("Bash", "PowerShell", "bash"):
                    p.messages.append(Msg(sess, "assistant", "executed_command", cmd, ref, ts, bid))
            elif bt == "tool_result":
                name_, cmd = tools.get(b.get("tool_use_id", ""), ("", None))
                text = _flat(b.get("content"))
                kind, outcome = classify_tool_output(text, cmd)
                p.messages.append(Msg(sess, "tool", kind, text[:20000], ref, ts, bid, outcome))
    return p


def parse_claude_ai(data: list, name: str) -> Parsed:
    p = Parsed("claude_ai_export", "claude.ai")
    for ci, conv in enumerate(data):
        sess = str(conv.get("uuid") or f"{name}#{ci}")
        prev_assistant = False
        for mi, m in enumerate(conv.get("chat_messages") or []):
            text = m.get("text") or _flat(m.get("content"))
            if not text.strip():
                continue
            ref, ts, uid = f"{name}:c{ci}m{mi}", m.get("created_at"), m.get("uuid")
            if m.get("sender") == "human":
                p.messages.append(Msg(sess, "user", _user_kind(text, prev_assistant), text, ref, ts, uid))
                prev_assistant = False
            else:
                p.messages.append(Msg(sess, "assistant", "assistant_suggestion", text, ref, ts, uid))
                prev_assistant = True
    return p


def parse_chatgpt(data: list, name: str) -> Parsed:
    p = Parsed("chatgpt_export", "chatgpt")
    for ci, conv in enumerate(data):
        sess = str(conv.get("id") or conv.get("conversation_id") or f"{name}#{ci}")
        nodes = [n for n in (conv.get("mapping") or {}).values() if n.get("message")]
        nodes.sort(key=lambda n: (n["message"].get("create_time") or 0))
        prev_assistant = False
        for mi, n in enumerate(nodes):
            msg = n["message"]
            role = (msg.get("author") or {}).get("role")
            parts = (msg.get("content") or {}).get("parts") or []
            text = "\n".join(x for x in parts if isinstance(x, str)).strip()
            if not text or role == "system":
                continue
            ts = msg.get("create_time")
            ts = None if ts is None else str(ts)
            ref, uid = f"{name}:c{ci}m{mi}", msg.get("id")
            if role == "user":
                p.messages.append(Msg(sess, "user", _user_kind(text, prev_assistant), text, ref, ts, uid))
                prev_assistant = False
            elif role == "assistant":
                p.messages.append(Msg(sess, "assistant", "assistant_suggestion", text, ref, ts, uid))
                prev_assistant = True
            else:
                kind, out = classify_tool_output(text, None)
                p.messages.append(Msg(sess, "tool", kind, text, ref, ts, uid, out))
    return p


def parse_generic(msgs: list, name: str) -> Parsed:
    p = Parsed("generic_chat", "unknown")
    prev_assistant = False
    for i, m in enumerate(msgs):
        text = _flat(m.get("content")) if not isinstance(m.get("content"), str) else m["content"]
        role = m.get("role")
        if not text.strip() or role not in ("user", "assistant", "tool"):
            continue
        ref, ts = f"{name}:m{i}", m.get("timestamp") or m.get("created_at")
        if role == "user":
            p.messages.append(Msg(name, "user", _user_kind(text, prev_assistant), text, ref, ts))
            prev_assistant = False
        elif role == "assistant":
            p.messages.append(Msg(name, "assistant", "assistant_suggestion", text, ref, ts))
            prev_assistant = True
        else:
            kind, out = classify_tool_output(text, None)
            p.messages.append(Msg(name, "tool", kind, text, ref, ts, None, out))
    return p


def parse_document(text: str, name: str, fmt: str) -> Parsed:
    p = Parsed(fmt, "document")
    for i in range(0, max(len(text), 1), 6000):
        chunk = text[i:i + 6000]
        if chunk.strip():
            p.messages.append(Msg(name, "document", "document", chunk, f"{name}:{i}"))
    return p


def parse_log(text: str, name: str) -> Parsed:
    p = Parsed("log", "log")
    kind, out = classify_tool_output(text, None)
    for i in range(0, max(len(text), 1), 8000):
        chunk = text[i:i + 8000]
        if chunk.strip():
            k, o = classify_tool_output(chunk, None)
            p.messages.append(Msg(name, "tool", k, chunk, f"{name}:{i}", None, None, o))
    return p


def detect_and_parse(path: Path) -> Parsed:
    size = path.stat().st_size
    if size > MAX_BYTES:
        raise Unsupported(f"file larger than {MAX_BYTES // 2**20} MB")
    if size == 0:
        raise Unsupported("empty file")
    ext, name = path.suffix.lower(), path.name
    raw = path.read_text(encoding="utf-8", errors="replace")
    if ext == ".jsonl":
        objs, bad = [], 0
        for ln in raw.splitlines():
            if not ln.strip():
                objs.append({})
                continue
            try:
                o = json.loads(ln)
                objs.append(o if isinstance(o, dict) else {})
            except json.JSONDecodeError:
                bad += 1
                objs.append({})
        typed = [o for o in objs if o.get("type") in ("user", "assistant") and "message" in o]
        if typed:
            p = parse_claude_code(objs, name)
        elif any("role" in o and "content" in o for o in objs):
            p = parse_generic([o for o in objs if o], name)
        else:
            raise Unsupported("JSONL without recognisable chat/session structure")
        if bad:
            p.gaps.append(f"{bad} malformed JSONL line(s) skipped")
        return p
    if ext == ".json":
        try:
            data = json.loads(raw)
        except json.JSONDecodeError as e:
            raise Unsupported(f"invalid JSON: {e}")
        if isinstance(data, list) and data and isinstance(data[0], dict):
            if "chat_messages" in data[0]:
                return parse_claude_ai(data, name)
            if "mapping" in data[0]:
                return parse_chatgpt(data, name)
        if isinstance(data, dict) and isinstance(data.get("messages"), list):
            return parse_generic(data["messages"], name)
        raise Unsupported("JSON is not a recognised conversation export")
    if ext in (".md", ".markdown", ".txt"):
        return parse_document(raw, name, "markdown" if ext != ".txt" else "text")
    if ext == ".log":
        return parse_log(raw, name)
    raise Unsupported(f"unsupported file type '{ext or '(none)'}'")


def norm(text: str) -> str:
    return re.sub(r"\s+", " ", text.strip().lower())


def fingerprint(m: Msg, nth: int) -> str:
    """Stable identity so re-exports/overlapping sessions dedupe. Prefer source ids."""
    if m.uid:
        return hashlib.sha256(f"id:{m.uid}".encode()).hexdigest()
    base = f"{m.session}|{m.ts or ''}|{m.role}|{norm(m.text)}|{nth}"
    return hashlib.sha256(base.encode()).hexdigest()
