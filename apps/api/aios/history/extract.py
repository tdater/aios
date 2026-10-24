"""Deterministic candidate extraction + scoring. No model calls.

Rules that matter:
- Preferences/guardrails come ONLY from user_statement messages; tool output, assistant text and
  documents can never create or authorise one (prompt-injection defence).
- Assistant claims are never evidence of outcome. Only preserved test output (or a user
  confirmation, labelled as such) counts.
- Scope is project unless >=2 distinct projects each show it; never global from one incident.
- Nothing is activated. Every candidate is inert until a human reviews it."""
from __future__ import annotations

import hashlib
import json
import re
from collections import defaultdict
from pathlib import Path

from ..db import Database
from ..security import redact
from ..util import canonical_json, new_id, now

ANALYZER_VERSION = 1

STOP = set("the a an and or but to of in on for with that this it is are was be as at by from you your i we "
           "they them then than so if do not dont don't please always never now going forward make sure "
           "prefer want need must should stop using doing use any all can will just also have has had get "
           "when what which who how why too very more some into out about over only like".split())
PREF_RX = re.compile(r"\b(always|never|from now on|going forward|don'?t(?! (know|understand|think|see|care|have|"
                     r"get|remember))|do not|stop (using|doing|adding|making)|make sure|i prefer|"
                     r"i want you to|i need you to|you must|you should)\b", re.I)
NEG_RX = re.compile(r"\b(never|don'?t|do not|stop (using|doing|adding|making))\b", re.I)
CORR_RX = re.compile(r"^\s*(no[,. !]|nope|that'?s (not|wrong|incorrect)|wrong|actually|stop\b|i (said|told you))", re.I)
VERIFY_RX = re.compile(r"\b(tests?|verify|verification|lint|run the suite|prove|evidence|confirm)\b", re.I)
GUARD_RX = re.compile(r"\b(delete|force|push|secrets?|credentials?|tokens?|production|deploy|spend|purchase|"
                      r"billing|permissions?|sudo|admin|overwrite|destructive|publish)\b", re.I)
BACKLOG_RX = re.compile(r"\b(todo|to-do|remember to|we should|need to (add|fix|build|write|implement)|"
                        r"later,? (we|i))\b", re.I)
CLAIM_RX = re.compile(r"\b(fixed|should (now )?work|that (should|will) (fix|do)|resolved|working now|"
                      r"it works now)\b", re.I)
TRIVIAL_CMD = re.compile(r"^(cd|ls|dir|pwd|echo|cat|type|clear|cls|git (status|diff|log|add|branch|show))\b", re.I)
RISKY_CMD = re.compile(r"\b(rm|del|remove-item|push|install|uninstall|format|drop|force)\b", re.I)


def tokens(s: str) -> frozenset[str]:
    return frozenset(t for t in re.findall(r"[a-z0-9_\-\.]{3,}", s.lower()) if t not in STOP)


def jaccard(a, b) -> float:
    a, b = set(a), set(b)
    return len(a & b) / len(a | b) if a and b else 0.0


def sentences(text: str) -> list[str]:
    return [s.strip() for s in re.split(r"(?<=[.!?])\s+|\n+", text) if s.strip()]


def _sig(text: str) -> str:
    line = next((l for l in text.splitlines() if re.search(r"FAIL|Error|error|failed", l)), text[:120])
    line = re.sub(r"0x[0-9a-f]+|[0-9a-f]{8,}", "H", line)
    line = re.sub(r"[A-Za-z]:\\[^\s:]+|/[\w./-]+", "<p>", line)
    return re.sub(r"\d+", "N", line).strip()[:120]


class Proposal:
    def __init__(self, type_: str, key: tuple, title: str, problem: str):
        self.type, self.key, self.title, self.problem = type_, tuple(sorted(key)), title, problem
        self.polarity: str | None = None
        self.outcome = ""
        self.validation = "not_verifiable"
        self.support: dict[int, str] = {}      # message id -> excerpt
        self.counter: dict[int, str] = {}
        self.flags: set[str] = set()
        self.corrections: set[int] = set()
        self.extra: dict = {}

    def add(self, m: dict, role: str = "support", excerpt: str | None = None) -> None:
        d = self.support if role == "support" else self.counter
        d.setdefault(m["id"], redact(excerpt or m["text"])[:300])
        m_src = m["source_id"]
        self.extra.setdefault("msgs", {})[m["id"]] = (m_src, m["project_id"], m["ts"])


def load_messages(db: Database) -> list[dict]:
    return db.query(
        "SELECT m.id, m.source_id, m.session_id, m.seq, m.ts, m.role, m.kind, m.text, m.ref, "
        "m.injection_suspect AS inj, m.test_outcome, s.project_id "
        "FROM messages m JOIN sources s ON s.id=m.source_id "
        "WHERE s.status='parsed' AND m.id=m.canon_id ORDER BY m.id")


def _sessions(msgs: list[dict]) -> dict[str, list[dict]]:
    out: dict[str, list[dict]] = defaultdict(list)
    for m in msgs:
        out[m["session_id"]].append(m)
    for v in out.values():
        v.sort(key=lambda m: (m["ts"] or "", m["id"]))
    return out


def _group(items: list[tuple[frozenset, dict]], threshold=0.6) -> list[tuple[frozenset, list[dict]]]:
    groups: list[tuple[frozenset, list[dict]]] = []
    for key, rec in items:
        for g in groups:
            if jaccard(key, g[0]) >= threshold:
                g[1].append(rec)
                break
        else:
            groups.append((key, [rec]))
    return groups


def extract_preferences(sessions) -> list[Proposal]:
    occ = []   # (key, record)
    for sess in sessions.values():
        prev = None
        for m in sess:
            if m["kind"] == "user_statement" and len(m["text"]) < 4000:
                corr = bool(prev and prev["kind"] == "assistant_suggestion" and CORR_RX.match(m["text"]))
                for s in sentences(m["text"]):
                    if not 12 <= len(s) <= 260 or s.endswith("?") or "```" in s:
                        continue
                    pol = "dont" if NEG_RX.search(s) else "do"
                    if PREF_RX.search(s):
                        key = tokens(PREF_RX.sub("", s))
                        if len(key) >= 2:
                            occ.append((key, dict(kind="pref", m=m, s=s, pol=pol, corr=corr)))
                    elif BACKLOG_RX.search(s):
                        key = tokens(s)
                        if len(key) >= 2:
                            occ.append((key, dict(kind="backlog", m=m, s=s, pol="do", corr=False)))
            prev = m
    out = []
    for kind in ("pref", "backlog"):
        for pol in ("do", "dont"):
            sub = [(k, r) for k, r in occ if r["kind"] == kind and r["pol"] == pol]
            for key, recs in _group(sub):
                first = recs[0]
                text = " ".join(r["s"] for r in recs)
                if kind == "backlog":
                    ty = "backlog"
                elif VERIFY_RX.search(text):
                    ty = "verification_gate"
                elif pol == "dont" and GUARD_RX.search(text):
                    ty = "guardrail"
                else:
                    ty = "preference"
                p = Proposal(ty, key, first["s"][:90], f"User stated: \"{redact(first['s'])[:160]}\"")
                p.polarity = pol if kind == "pref" else None
                p.outcome = "Stated by the user; outcome of following it not evaluated."
                for r in recs:
                    p.add(r["m"], excerpt=r["s"])
                    if r["corr"]:
                        p.corrections.add(r["m"]["id"])
                    if r["m"]["inj"]:
                        p.flags.add("injection_suspect")
                out.append(p)
    return out


def _is_claim(m: dict) -> bool:
    return m["kind"] == "assistant_suggestion" and bool(CLAIM_RX.search(m["text"]))


def extract_lessons(sessions) -> tuple[list[Proposal], int]:
    lessons: dict[str, Proposal] = {}
    unresolved: dict[str, Proposal] = {}
    unverified_claims = 0
    for sess in sessions.values():
        open_fail, window = None, []
        for m in sess:
            if m["kind"] == "test_result" and m["test_outcome"] == "fail":
                if open_fail is None:
                    open_fail, window = m, []
                else:
                    window.append(m)
                continue
            if open_fail is None:
                continue
            resolved_by = None
            validation = None
            if m["kind"] == "test_result" and m["test_outcome"] == "pass":
                resolved_by, validation = m, "preserved_test_evidence"
            elif m["kind"] == "user_confirmation" and any(_is_claim(w) for w in window):
                resolved_by, validation = m, "historically_reported"
            else:
                window.append(m)
                continue
            sig = _sig(open_fail["text"])
            key = (sig, validation)
            p = lessons.get("|".join(key))
            if p is None:
                p = Proposal("lesson", tokens(sig) or frozenset({sig[:20]}), f"Resolved failing check: {sig[:70]}",
                             f"A test/build failed with: {sig}")
                p.validation = validation
                p.extra["sig"] = sig
                p.outcome = ("Later test run passed (preserved tool output)." if validation == "preserved_test_evidence"
                             else "User said it worked after an assistant fix claim; NO passing test preserved.")
                lessons["|".join(key)] = p
            p.add(open_fail)
            p.add(resolved_by)
            for w in window[:8]:
                if w["kind"] == "executed_command":
                    p.add(w)
                elif w["kind"] == "test_result" and w["test_outcome"] == "fail":
                    p.add(w, "counter", "[intermediate failing run] " + w["text"])
                elif _is_claim(w):
                    p.add(w, "counter", "[assistant claimed a fix before the issue was resolved] " + w["text"])
            open_fail, window = None, []
        if open_fail is not None:
            unverified_claims += sum(1 for w in window if _is_claim(w))
            sig = _sig(open_fail["text"])
            p = unresolved.setdefault(sig, Proposal("unresolved_question", tokens(sig) or frozenset({sig[:20]}),
                                                    f"Unresolved failing check: {sig[:70]}",
                                                    f"A test/build failed with: {sig} and no passing run was recorded."))
            p.extra["sig"] = sig
            p.outcome = "No passing run or user confirmation preserved; assistant claims (if any) are not evidence."
            p.add(open_fail)
    resolved_sigs = {p.extra["sig"] for p in lessons.values()}
    keep = [p for s, p in unresolved.items() if s not in resolved_sigs]
    return list(lessons.values()) + keep, unverified_claims


def extract_scripts(sessions) -> list[Proposal]:
    by_cmd: dict[str, list[dict]] = defaultdict(list)
    for sid, sess in sessions.items():
        for m in sess:
            if m["kind"] == "executed_command":
                c = re.sub(r"\s+", " ", m["text"].strip())
                if len(c) >= 12 and not TRIVIAL_CMD.match(c):
                    by_cmd[c.lower()].append(m)
    out = []
    for c, ms in by_cmd.items():
        if len({m["session_id"] for m in ms}) >= 3:
            p = Proposal("script", tokens(c) or frozenset({c[:20]}), f"Script candidate: {c[:70]}",
                         f"Same command run manually in {len({m['session_id'] for m in ms})} sessions.")
            p.outcome = "Observed repetition only; no timing data, so no time saving is claimed."
            p.extra["risky"] = bool(RISKY_CMD.search(c))
            p.extra["cmd"] = c
            for m in ms:
                p.add(m)
            out.append(p)
    return out


def _scope(p: Proposal) -> tuple[str, str | None, set[str]]:
    msgs = p.extra.get("msgs", {})
    projects = [v[1] for k, v in msgs.items() if k in p.support]
    known = {x for x in projects if x}
    flags: set[str] = set()
    if len(known) >= 2 and len(p.support) >= 2:
        flags.add("multi_project")
        return "global", None, flags
    if len(known) == 1:
        if None in projects:
            flags.add("partly_unassigned_project")
        return "project", next(iter(known)), flags
    flags.add("unassigned_project")
    return "project", None, flags


def _chron(msgs_meta: dict, ids) -> tuple:
    return max(((msgs_meta[i][2] or "", i) for i in ids), default=("", 0))


def link_conflicts(props: list[Proposal]) -> None:
    prefs = [p for p in props if p.polarity]
    for i, a in enumerate(prefs):
        for b in prefs[i + 1:]:
            if a.polarity != b.polarity and jaccard(a.key, b.key) >= 0.6:
                for x, y in ((a, b), (b, a)):
                    for mid, ex in y.support.items():
                        x.counter.setdefault(mid, "[contradicting statement] " + ex)
                        x.extra.setdefault("msgs", {})[mid] = y.extra["msgs"][mid]
                    x.flags.add("conflict")
                if _chron(a.extra["msgs"], b.support) > _chron(a.extra["msgs"], a.support):
                    a.flags.add("later_contradiction")
                if _chron(b.extra["msgs"], a.support) > _chron(b.extra["msgs"], b.support):
                    b.flags.add("later_contradiction")


def similar_existing(title: str, skills_dir: Path | None) -> list[str]:
    if not skills_dir or not skills_dir.is_dir():
        return []
    t = tokens(title)
    return [d.name for d in skills_dir.iterdir()
            if d.is_dir() and jaccard(t, tokens(d.name.replace("-", " "))) >= 0.5]


def _fp(p: Proposal) -> str:
    return hashlib.sha256(f"{p.type}|{p.polarity}|{' '.join(p.key)}|{p.validation}".encode()).hexdigest()


def analyze(db: Database, skills_dir: Path | None = None) -> dict:
    sessions = _sessions(load_messages(db))
    props = extract_preferences(sessions)
    lessons, unverified = extract_lessons(sessions)
    props += lessons + extract_scripts(sessions)
    link_conflicts(props)
    rep = {"proposals": len(props), "created": 0, "updated": 0, "reopened": 0,
           "kept_rejected": 0, "unverified_assistant_claims": unverified}
    existing = db.query("SELECT id, fingerprint, type, polarity, key_json, status, evidence_at_decision, validation "
                        "FROM candidates")
    for p in props:
        scope, project_id, sflags = _scope(p)
        flags = set(p.flags) | sflags
        sim = similar_existing(p.title, skills_dir) if p.type in ("script", "skill", "workflow") else []
        flags |= {f"similar_existing:{s}" for s in sim}
        fp = _fp(p)
        match = next((e for e in existing if e["fingerprint"] == fp), None) or next(
            (e for e in existing if e["type"] == p.type and e["polarity"] == p.polarity
             and e["validation"] == p.validation and p.type in ("preference", "guardrail", "verification_gate", "backlog")
             and jaccard(json.loads(e["key_json"]), p.key) >= 0.6), None)
        risk = "high" if p.type == "guardrail" else ("medium" if p.extra.get("risky") or p.type == "verification_gate"
                                                      else "low")
        verification = {
            "lesson": "Re-run the originally failing check in the current project and confirm it passes.",
            "script": "Dry-run the parameterised script on a scratch copy; compare output with the manual run.",
            "preference": "Confirm with the user that the preference still applies in the current project.",
            "guardrail": "Implement as a deterministic check, then test both allowed and blocked cases.",
            "verification_gate": "Add as an executable check; verify it fails when the check is missing.",
        }.get(p.type, "Review manually.")
        with db.tx() as con:
            if match:
                cid = match["id"]
                con.execute("UPDATE candidates SET updated_at=? WHERE id=?", (now(), cid))
                rep["updated"] += 1
            else:
                cid = new_id("cnd")
                con.execute(
                    "INSERT INTO candidates(id,fingerprint,type,title,scope,project_id,problem,outcome,validation,"
                    "key_json,polarity,risk,verification,maintenance,flags_json,created_at,updated_at,benefit,"
                    "benefit_basis,prerequisites) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                    (cid, fp, p.type, redact(p.title), scope, project_id, p.problem, p.outcome, p.validation,
                     canonical_json(list(p.key)), p.polarity, risk, verification,
                     "Review when the project's tooling or conventions change.", canonical_json(sorted(flags)),
                     now(), now(), "unknown: no time measurements in history" if p.type == "script"
                     else "unknown", "unknown", ""))
                rep["created"] += 1
            for role, d in (("support", p.support), ("counter", p.counter)):
                for mid, ex in d.items():
                    src = p.extra["msgs"][mid][0]
                    con.execute("INSERT OR IGNORE INTO candidate_evidence(candidate_id,message_id,source_id,role,"
                                "excerpt) VALUES (?,?,?,?,?)", (cid, mid, src, role, ex))
            con.execute("UPDATE candidates SET corrections=?, scope=CASE WHEN status='candidate' THEN ? ELSE scope END,"
                        " project_id=CASE WHEN status='candidate' THEN ? ELSE project_id END WHERE id=?",
                        (len(p.corrections), scope, project_id, cid))
        recompute_candidate(db, cid, add_flags=flags)
        if match is None:
            existing.append({"id": cid, "fingerprint": fp, "type": p.type, "polarity": p.polarity,
                             "key_json": canonical_json(list(p.key)), "status": "candidate",
                             "evidence_at_decision": None, "validation": p.validation})
    reopened = db.one("SELECT COUNT(*) n FROM candidates WHERE flags_json LIKE '%reconsidered_new_evidence%' "
                      "AND status='candidate'")["n"]
    rep["reopened"] = reopened
    return rep


def recompute_candidate(db: Database, cid: str, add_flags: set[str] | None = None) -> dict:
    """Single place that derives counts, flags, confidence, score, and status consequences."""
    c = db.one("SELECT * FROM candidates WHERE id=?", (cid,))
    occ = db.one("SELECT COUNT(DISTINCT e.message_id) n, COUNT(DISTINCT e.source_id) s FROM candidate_evidence e "
                 "WHERE e.candidate_id=? AND e.role='support'", (cid,))
    counter = db.one("SELECT COUNT(DISTINCT message_id) n FROM candidate_evidence WHERE candidate_id=? "
                     "AND role='counter'", (cid,))["n"]
    flags = set(json.loads(c["flags_json"])) | (add_flags or set())
    n, srcs = occ["n"], occ["s"]
    flags.discard("single_explicit_instruction")
    if n == 1 and c["type"] in ("preference", "guardrail", "verification_gate"):
        flags.add("single_explicit_instruction")
    if counter == 0:
        flags.discard("conflict")
        flags.discard("later_contradiction")
    conflict, inj = "conflict" in flags, "injection_suspect" in flags
    status, ev_dec = c["status"], c["evidence_at_decision"]
    if status == "rejected" and ev_dec is not None and n > ev_dec:
        status = "candidate"
        flags.add("reconsidered_new_evidence")
    if status == "approved" and counter and "conflict" in flags:
        flags.add("new_conflicting_evidence")
    orphaned = False
    if n == 0 and status in ("candidate", "deferred"):
        status, orphaned = "orphaned", True
    elif n == 0 and status == "approved":
        flags.add("evidence_removed")
    elif n > 0 and status == "orphaned":
        status = "candidate"
    preserved = c["validation"] == "preserved_test_evidence"
    conf = 0.35 + 0.12 * max(n - 1, 0) + 0.08 * min(c["corrections"], 3) + (0.05 if srcs > 1 else 0) \
        + (0.15 if preserved else 0) - (0.2 if conflict else 0) - (0.3 if inj else 0)
    conf = max(0.05, min(0.85, conf))
    score = n * 3 + srcs * 2 + c["corrections"] * 3 + (4 if preserved else 0) - (5 if conflict else 0) \
        - (5 if inj else 0)
    if c["type"] in ("backlog", "unresolved_question"):
        score *= 0.5
    uncertainty = []
    if "single_explicit_instruction" in flags:
        uncertainty.append("supported by a single explicit instruction")
    if conflict:
        uncertainty.append("contradicting statements exist; NOT auto-resolved, see counter-evidence")
    if "unassigned_project" in flags:
        uncertainty.append("source not associated with a registered project")
    if inj:
        uncertainty.append("contains injection-like text; treat with suspicion")
    if c["validation"] == "historically_reported":
        uncertainty.append("outcome rests on a user confirmation without preserved test evidence")
    db.execute("UPDATE candidates SET distinct_occurrences=?, distinct_sources=?, confidence=?, score=?, "
               "flags_json=?, status=?, uncertainty=?, updated_at=? WHERE id=?",
               (n, srcs, round(conf, 2), score, canonical_json(sorted(flags)), status, "; ".join(uncertainty),
                now(), cid))
    return {"orphaned": orphaned, "memory_id": c["memory_id"]}


def shortlist(db: Database, limit: int = 10) -> list[dict]:
    rows = db.query("SELECT * FROM candidates WHERE status='candidate' ORDER BY score DESC, created_at LIMIT ?",
                    (limit,))
    for r in rows:
        r["flags"] = json.loads(r.pop("flags_json"))
    return rows
