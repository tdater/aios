"""Work out what kind of task a request is, and which steps it needs. Fixed rules, not a model: instant, free, explainable and testable.

The result is a plan: a kind, a confidence, the reasons for the choice, and steps that are each `will` (AIOS does it),
`you` (needs you), `offer` (optional, one click) or `skip` (not needed, with the reason). A simple question gets an answer and
nothing else; only a request to change files in a project gets the build, check, review and correct steps.

Triage can only choose among steps that already exist and are already guarded. It cannot grant a permission, and a wrong guess
is cheap because the plan is shown before anything starts and can be changed with one click."""
from __future__ import annotations

import re

KINDS = {
    "answer": "Answer a question",
    "write": "Write or edit text",
    "research": "Look something up",
    "plan": "Plan or decide",
    "project_question": "Ask about a project",
    "build": "Build or fix something in a project",
}
MAX_PROMPT = 8000

_I = re.IGNORECASE


def _rx(words: str) -> re.Pattern:
    return re.compile(rf"\b(?:{words})\b", _I)


CODE_VERB = _rx(r"fix|debug|refactor|implement|add|create|build|make|change|update|rename|remove|delete|migrate|port|convert|optimi[sz]e|write|patch|wire|hook up")
CODE_NOUN = _rx(r"bugs?|code|codebase|repo|repository|functions?|methods?|class(?:es)?|modules?|scripts?|apps?|apis?|endpoints?|components?|tests?|unit tests?|compile[rs]?|errors?|exceptions?|stack ?trace|lint|commits?|branch|pull request|database|schema|migrations?|buttons?|css|html|login|backend|frontend|features?|program|cli|dependenc(?:y|ies)|config(?:uration)?|build")
FILE_NAME = re.compile(r"\b[\w\-./\\]+\.(?:py|js|jsx|ts|tsx|java|kt|cs|cpp|c|h|go|rs|rb|php|swift|sql|sh|ps1|json|yaml|yml|toml|html|css)\b", _I)
QUESTION_START = re.compile(r"^(?:what|whats|what's|why|how|when|where|who|which|is|are|am|was|were|do|does|did|explain|tell me|define|describe|difference between|meaning of|can you explain|could you explain)\b", _I)
POLITE = re.compile(r"^(?:please\s+|pls\s+|hey\s+|hi\s+|ok\s+|okay\s+)*(?:(?:can|could|would|will)\s+(?:you|we)\s+(?:please\s+)?|i (?:need|want|would like) (?:you )?to\s+|i'd like (?:you )?to\s+|help me (?:to\s+)?|let's\s+|lets\s+)?", _I)
RESEARCH = _rx(r"latest|news|tonight|right now|currently|current|recent(?:ly)?|prices?|price of|cost of|how much (?:is|are|does|do)|who won|scores?|weather|forecast|stocks?|release date|reviews?|top \d+|best [\w\s]{1,30} (?:for|to)|near me|open now|202[5-9]")
RESEARCH_STRONG = _rx(r"look up|look it up|search (?:for|the web|online)|sources?|cite|citations?|find out|find me|fact[- ]check|with links")
WRITE_VERB = _rx(r"write|draft|rewrite|rephrase|reword|proofread|edit|polish|summari[sz]e|translate|paraphrase|shorten|expand|compose|tidy up|improve (?:this|my)")
WRITE_NOUN = _rx(r"e-?mails?|letters?|cover letter|resume|cv|essay|posts?|captions?|messages?|texts?|repl(?:y|ies)|poems?|stor(?:y|ies)|speech|bio|description|paragraphs?|articles?|blogs?|tweets?|slogans?|toast|apology|notes?|reports?|memo|announcement|this|following|below")
WRITE_SURE = _rx(r"translate|proofread|summari[sz]e|rephrase|reword|paraphrase|rewrite")
EXPLICIT_PROJECT = _rx(r"(?:my|our|the|this) (?:project|repo|repository|codebase|code base|app|application|website|site)")
PLAN = _rx(r"plan|planning|schedule|itinerary|roadmap|budget|strategy|outline|checklist|agenda|meal plan|workout|study plan|should i|pros and cons|decide|decision|recommend|organi[sz]e|prioriti[sz]e|compare|options for|ideas for|brainstorm|trade-?offs?|help me (?:choose|pick|figure out|decide)")
HIGH_STAKES = _rx(r"medical|medications?|dos(?:e|age)|symptoms?|diagnos\w*|doctors?|health|lump|pain|rash|infection|fever|injur\w*|cancer|bleeding|allerg\w*|legal|lawyers?|sue|lawsuit|contracts?|tax(?:es)?|invest\w*|loans?|mortgages?|retire\w*|insurance|visa|immigration|custody|divorce|safety|chemicals?|overdose|pregnan\w*")


def _words(text: str) -> int:
    return len(text.split())


def _is_big(text: str) -> bool:
    sentences = [s for s in re.split(r"(?<=[.!?])\s+|\n+", text.strip()) if s.strip()]
    return _words(text) > 60 or len(sentences) >= 4 or bool(re.search(r"(?m)^\s*(?:\d+[.)]|[-*])\s+", text))


def _step(sid: str, label: str, agent: str, state: str, why: str) -> dict:
    return {"id": sid, "label": label, "agent": agent, "state": state, "why": why}


def _steps(kind: str, *, high_stakes: bool, big: bool) -> list[dict]:
    steps = [_step("understand", "AIOS reads your request", "aios", "will", "Always the first step.")]
    if kind == "build":
        return steps + [
            _step("implement", "Claude makes the change in a safe copy of your project", "claude", "will", "Your real project is not touched until you apply the result."),
            _step("verify", "AIOS runs your project's check", "you", "you", "It runs only after you approve the exact command."),
            _step("review", "A separate Claude reviews the change", "claude", "will", "A fresh session that has not seen the first one's reasoning."),
            _step("correct", "Claude fixes real problems found", "claude", "will", "Only if the check or the review finds something."),
            _step("result", "You see the result and decide whether to apply it", "you", "you", "Nothing is merged without your approval."),
        ]
    if kind == "write":
        steps.append(_step("answer", "Claude writes it", "claude", "will", "A first version you can ask to change."))
    elif kind == "research":
        steps.append(_step("answer", "Claude answers from what it knows", "claude", "will", "Claude cannot browse the web, so this may be out of date."))
        steps.append(_step("lookup", "Look it up with sources (Perplexity, by copy and paste)", "perplexity", "offer", "Needs current facts, so a source-linked answer is better. AIOS writes the prompt; you paste it."))
    elif kind == "project_question":
        steps.append(_step("answer", "Claude reads your project and answers", "claude", "will", "Read-only: it cannot change anything."))
    else:                                                    # answer, plan
        steps.append(_step("answer", "Claude answers" if kind == "answer" else "Claude works out a plan", "claude", "will", "A direct answer in plain words."))
    if high_stakes:
        steps.append(_step("second_look", "A second AI double-checks it (recommended)", "gemini", "offer", "This touches health, money or law, so a second opinion is worth a minute. AIOS writes the prompt; you paste it."))
    elif big and kind in ("write", "plan", "research"):
        steps.append(_step("second_look", "A second AI can double-check it", "gemini", "offer", "A longer piece of work benefits from another pair of eyes. Optional."))
    else:
        steps.append(_step("second_look", "Second opinion", "gemini", "skip", "A simple request does not need one."))
    steps.append(_step("build", "Build, test and review", "claude", "skip", "Nothing to build, so nothing to test or review."))
    return steps


def _classify(prompt: str, project: dict | None) -> tuple[str, str, list[str]]:
    """(kind, confidence, reasons)."""
    text = " ".join(prompt.split())
    core = POLITE.sub("", text, count=1).strip()
    low = core.lower()
    asks = bool(QUESTION_START.match(core)) or text.rstrip().endswith("?") and not POLITE.match(text).group(0)
    in_project = bool(project) and not project.get("everyday")
    imperative = bool(CODE_VERB.match(core)) and not QUESTION_START.match(core)      # "fix add so it adds": a command, in a project it is a change
    change = bool(CODE_VERB.search(core)) and bool(CODE_NOUN.search(core) or FILE_NAME.search(text) or "```" in text or (in_project and imperative))
    write = bool(WRITE_SURE.search(core)) or (bool(WRITE_VERB.search(core)) and (bool(WRITE_NOUN.search(core)) or _words(text) > 40))
    explicit_project = bool(EXPLICIT_PROJECT.search(core)) or bool(FILE_NAME.search(text))
    research_strong = bool(RESEARCH_STRONG.search(core))
    research = research_strong or bool(RESEARCH.search(core))
    planning = bool(PLAN.search(text))
    reasons: list[str] = []

    if change and not QUESTION_START.match(core):
        verbs = ", ".join(sorted({m.group(0).lower() for m in CODE_VERB.finditer(core)})[:3])
        if not in_project and not explicit_project:           # "write me a script that renames my photos": just write it in chat
            reasons.append(f"It asks for code (“{verbs}”) but no project is selected, so Claude will write it in chat. Pick a project to have it change real files.")
            return "write", "medium", reasons
        reasons.append(f"It asks to change something in code or files (“{verbs}”).")
        if in_project:
            reasons.append(f"A project is selected: {project['name']}.")
        return "build", "high" if in_project or FILE_NAME.search(text) else "medium", reasons
    if in_project:
        reasons.append(f"A project is selected ({project['name']}) and nothing needs changing, so Claude will read it and answer.")
        return "project_question", "medium", reasons
    if write and not research_strong:
        reasons.append("It asks for something written or edited.")
        return "write", "high" if WRITE_NOUN.search(core) else "medium", reasons
    if research:
        hit = (RESEARCH_STRONG.search(core) or RESEARCH.search(core)).group(0)
        reasons.append(f"It needs current or sourced facts (“{hit}”), which Claude cannot look up itself.")
        return "research", "high" if research_strong else "medium", reasons
    if planning and not (asks and _words(text) < 9):
        reasons.append(f"It asks for a plan, a comparison or a decision (“{PLAN.search(text).group(0).lower()}”).")
        return "plan", "medium", reasons
    reasons.append("It asks a question or starts a chat." if asks else "Nothing here needs more than a direct reply.")
    return "answer", "high" if asks and _words(text) < 40 else "medium", reasons


def plan_for(prompt: str, *, project: dict | None = None, project_has_check: bool = False, claude_ready: bool = True, kind: str | None = None) -> dict:
    """The plan for a request. `kind` is the owner's own choice and overrides the guess. `project` is {id, name, everyday?}."""
    text = (prompt or "").strip()[:MAX_PROMPT]
    guessed, confidence, reasons = _classify(text, project) if text else ("answer", "low", ["Type a request to see the plan."])
    chosen = kind if kind in KINDS else guessed
    if kind in KINDS and kind != guessed:
        reasons = [f"You chose “{KINDS[kind]}”.", f"AIOS would have guessed “{KINDS[guessed]}”."]
        confidence = "chosen"
    in_project = bool(project) and not project.get("everyday")
    high = bool(HIGH_STAKES.search(text)) and chosen not in ("build", "project_question")
    steps = _steps(chosen, high_stakes=high, big=_is_big(text))
    blocker = None
    if not claude_ready:
        blocker = {"code": "claude_not_ready", "message": "Claude is not signed in on this computer yet. Sign in once with `claude` in a terminal, then try again."}
    elif chosen in ("build", "project_question") and not in_project:
        blocker = {"code": "needs_project", "message": "Pick the project this is about. Until then Claude can only answer in chat.", "alternatives": ["answer"]}
    elif chosen == "build" and not project_has_check:
        blocker = {"code": "no_verify_command", "message": "This project has no check command yet, so AIOS could not test what Claude builds. Set one first, or choose “Just answer”.", "alternatives": ["project_question"]}
    return {"kind": chosen, "label": KINDS[chosen], "guessed_kind": guessed, "confidence": confidence, "reasons": reasons,
            "steps": steps, "high_stakes": high, "big": _is_big(text), "blocker": blocker, "kinds": KINDS,
            "uses_project": chosen in ("build", "project_question")}
