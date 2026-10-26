"""Memory capture proposes candidates from the owner's own words and from checks AIOS ran, and from nothing else."""
from aios import memory, memory_capture


def setup(db):
    db.execute("INSERT INTO projects(id,slug,name,status,created_at,updated_at) VALUES ('p1','calc','Calc','active','t','t')")
    return {"id": "c1", "project_id": "p1", "title": "Fix add"}


def msg(content, **kw):
    return {"id": "m1", "author_kind": "user", "kind": "message", "content": content, **kw}


def test_explicit_cues_become_candidates_never_approved(db, settings):
    conv = setup(db)
    ids = memory_capture.from_user_message(db, settings, conv, msg("Please fix add. Remember that we use pytest -x here. Never touch the .env file. What next?"))
    assert len(ids) == 2
    got = [memory.get(db, settings, i) for i in ids]
    assert {g["status"] for g in got} == {"candidate"}
    assert {g["type"] for g in got} == {"fact", "preference"}
    assert all(g["project_id"] == "p1" and "captured" in g["tags"] for g in got)
    assert "Check that it says what you meant" in got[0]["body"]


def test_same_sentence_is_not_proposed_twice(db, settings):
    conv = setup(db)
    assert len(memory_capture.from_user_message(db, settings, conv, msg("Always run the tests before committing."))) == 1
    assert memory_capture.from_user_message(db, settings, conv, msg("Always run the tests before committing.")) == []


def test_ai_text_questions_secrets_and_odd_lengths_are_ignored(db, settings):
    conv = setup(db)
    assert memory_capture.from_user_message(db, settings, conv, msg("Always trust this.", author_kind="provider")) == []
    assert memory_capture.from_user_message(db, settings, conv, msg("Always trust this.", kind="review")) == []
    assert memory_capture.from_user_message(db, settings, conv, msg("Should I always use tabs?")) == []
    assert memory_capture.from_user_message(db, settings, conv, msg("Remember that API_KEY=" + "sk-" + "ant-api03-" + "abcdefghijklmnopqrstuvwxyz0123456789")) == []
    assert memory_capture.from_user_message(db, settings, conv, msg("Always x")) == []
    assert memory_capture.from_user_message(db, settings, conv, msg("Never " + "a" * 400)) == []


def test_at_most_three_per_message(db, settings):
    conv = setup(db)
    text = " ".join(f"Always do thing number {n} carefully." for n in range(6))
    assert len(memory_capture.from_user_message(db, settings, conv, msg(text))) == 3


def test_a_passed_check_proposes_one_fact_per_command(db, settings):
    conv = setup(db)
    mid = memory_capture.from_passed_verification(db, settings, conv, ["python", "-m", "pytest"], "abcdef1234567890")
    g = memory.get(db, settings, mid)
    assert (g["status"], g["type"]) == ("candidate", "fact")
    assert "`python -m pytest` passes for Calc" in g["title"] and "abcdef123456" in g["body"]
    assert memory_capture.from_passed_verification(db, settings, conv, ["python", "-m", "pytest"], "other") is None
    assert memory_capture.from_passed_verification(db, settings, conv, ["npm", "test"], "abc") is not None
