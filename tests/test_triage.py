"""Triage decides how much work a request needs. These cases are the product promise: a simple question gets an answer and
nothing else; only a request to change a project's files gets the build, check, review and correct steps."""
import pytest

from aios import triage

PROJECT = {"id": "p1", "name": "Calc"}
EVERYDAY = {"id": "p0", "name": "Everyday", "everyday": True}


def plan(prompt, **kw):
    kw.setdefault("project_has_check", True)
    return triage.plan_for(prompt, **kw)


def ids(p, state):
    return [s["id"] for s in p["steps"] if s["state"] == state]


@pytest.mark.parametrize("prompt,kind", [
    ("What is the capital of Australia?", "answer"),
    ("how do I reverse a list in python", "answer"),
    ("hi", "answer"),
    ("Explain what an escrow account is", "answer"),
    ("tell me a joke", "answer"),
    ("remember that I like short answers", "answer"),
    ("help me figure out what to cook this week", "plan"),
    ("Write an email to my landlord asking to fix the heating", "write"),
    ("Rewrite this paragraph to sound friendlier: We regret to inform you that", "write"),
    ("translate 'good morning' into French", "write"),
    ("write a python script that renames my photos", "write"),
    ("What's the weather in Lisbon this week?", "research"),
    ("what are the best laptops for students in 2026", "research"),
    ("Plan a 3 day trip to Lisbon on a budget", "plan"),
    ("Should I pay off my mortgage early or invest?", "plan"),
    ("Compare React vs Vue", "plan"),
])
def test_everyday_requests_never_get_the_build_steps(prompt, kind):
    p = plan(prompt)
    assert p["kind"] == kind and p["blocker"] is None
    assert "build" in ids(p, "skip") and not {"implement", "verify", "review", "correct"} & {s["id"] for s in p["steps"]}
    assert all(s["why"] for s in p["steps"])                                       # every step says why it is there or why it is not


def test_a_simple_question_is_one_answer_and_nothing_else():
    p = plan("What is the capital of Australia?")
    assert [s["id"] for s in p["steps"] if s["state"] in ("will", "you", "offer")] == ["understand", "answer"]
    assert set(ids(p, "skip")) == {"second_look", "build"}
    assert p["confidence"] == "high" and p["reasons"]


def test_a_request_to_change_a_project_gets_the_whole_path():
    p = plan("Fix the failing test in calc.py", project=PROJECT)
    assert p["kind"] == "build" and p["blocker"] is None and p["uses_project"]
    assert [s["id"] for s in p["steps"]] == ["understand", "implement", "verify", "review", "correct", "result"]
    assert {s["id"]: s["agent"] for s in p["steps"]}["verify"] == "you"          # the owner approves the check, so it is theirs
    assert ids(p, "skip") == []
    assert plan("can you add a dark mode button to the settings page", project=PROJECT)["kind"] == "build"


def test_a_question_about_a_project_is_read_only_not_a_build():
    p = plan("What does this project do?", project=PROJECT)
    assert p["kind"] == "project_question" and "build" in ids(p, "skip") and p["uses_project"]
    assert plan("How do I fix this bug in my app?", project=PROJECT)["kind"] == "project_question"


def test_a_build_with_no_project_or_no_check_says_so_and_offers_a_way_out():
    nop = plan("Fix the failing test in calc.py")
    assert nop["kind"] == "build" and nop["blocker"]["code"] == "needs_project" and nop["blocker"]["alternatives"] == ["answer"]
    assert plan("Fix the failing test in calc.py", project=EVERYDAY)["blocker"]["code"] == "needs_project"      # the chat space is not a project
    nocheck = plan("Fix the failing test in calc.py", project=PROJECT, project_has_check=False)
    assert nocheck["blocker"]["code"] == "no_verify_command"


def test_code_with_no_project_is_just_written_in_chat():
    p = plan("write a python script that renames my photos")
    assert p["kind"] == "write" and p["blocker"] is None and "no project is selected" in p["reasons"][0]


def test_claude_not_ready_is_reported_before_anything_starts():
    assert plan("What is 2+2?", claude_ready=False)["blocker"]["code"] == "claude_not_ready"


def test_high_stakes_and_long_requests_recommend_a_second_look_but_simple_ones_do_not():
    health = plan("I have a lump on my arm, what could it be?")
    second = next(s for s in health["steps"] if s["id"] == "second_look")
    assert health["high_stakes"] and second["state"] == "offer" and "recommended" in second["label"]
    long = plan("Summarize the following text: " + "word " * 80)
    assert next(s for s in long["steps"] if s["id"] == "second_look")["state"] == "offer" and not long["high_stakes"]
    assert next(s for s in plan("tell me a joke")["steps"] if s["id"] == "second_look")["state"] == "skip"
    assert plan("Fix the failing test in calc.py", project=PROJECT)["high_stakes"] is False


def test_research_is_honest_that_claude_cannot_browse():
    p = plan("what are the best laptops for students in 2026")
    answer, lookup = (next(s for s in p["steps"] if s["id"] == i) for i in ("answer", "lookup"))
    assert "cannot browse" in answer["why"] and lookup["agent"] == "perplexity" and lookup["state"] == "offer" and "paste" in lookup["why"]


def test_the_owner_can_override_the_guess_and_the_plan_follows():
    p = plan("hello there", kind="research")
    assert p["kind"] == "research" and p["guessed_kind"] == "answer" and p["confidence"] == "chosen" and "You chose" in p["reasons"][0]
    assert "lookup" in ids(p, "offer")
    assert plan("hello", kind="nonsense")["kind"] == "answer"                      # an unknown choice is ignored, never trusted


def test_an_empty_request_has_no_plan_to_speak_of_and_a_huge_one_is_cut():
    assert plan("")["confidence"] == "low"
    assert len(plan("x " * 20000)["steps"]) >= 2


def test_nothing_in_a_plan_can_be_both_skipped_and_scheduled():
    for prompt in ("hi", "Fix calc.py", "Plan my week", "latest news", "write a letter", "I have a fever"):
        p = plan(prompt, project=PROJECT)
        assert len({s["id"] for s in p["steps"]}) == len(p["steps"]) and {s["state"] for s in p["steps"]} <= {"will", "you", "offer", "skip"}
