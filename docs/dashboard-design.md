# One prompt for any task: the AIOS dashboard

## What it is for

AIOS is a dashboard of your AI agents that anyone can use for any task: a question, a letter, a trip plan, a research
brief, a code change. You type one request. AIOS works out what kind of task it is, picks only the steps that apply, says
which steps it left out and why, and shows progress as it goes. A coding project gets the full path (build, check, review,
correct). A simple question gets an answer and nothing else.

## Understanding (what was asked, what is assumed)

Asked: a single prompt for all agents; AIOS recognises when subagents, review or coding steps are not needed; the interface is
beautiful and welcoming to non-technical and technical users alike.

Assumed:
- "All agents" means the agents AIOS can really use. Claude is run by AIOS through its own sign-in. Gemini and Perplexity are
  used by copy and paste (AIOS writes the prompt, you paste it), and Antigravity stays a manual handoff. The plan labels every step
  with who does it and never presents a pasted step as automatic.
- Every existing safety rule stays: no paid API, no tokens read, checks run only after you approve the exact command, nothing is
  merged without a separate approval, retrieved text is data, not instructions.

## How a request is handled

1. **Triage** (`triage.py`) reads the request with fixed, explainable rules and produces a plan: the kind of task, a confidence, the
   reasons ("it asks a question", "it mentions fixing code"), and a list of steps, each `will` (AIOS does it), `you` (needs you),
   `offer` (optional, one click) or `skip` (not needed, with the reason). It is not a model call: it is instant, free and testable. You
   can change the choice with one click before or after starting.
2. **Kinds**: `answer` (a question or chat), `write` (draft, rewrite, summarise, translate), `research` (needs current facts or sources),
   `plan` (plan, compare, decide), `project_question` (a question about a project's files, read only), `build` (change files in a
   project). Only `build` uses the build, check, review and correct steps.
3. **Doing it** (`assist.py`) creates a conversation and starts the real work through the same code the rest of AIOS uses: a read-only
   Claude turn for everything except `build`, and the start-to-finish workflow for `build`. Claude cannot browse, so `research` says so and
   offers a ready prompt for Perplexity. High-stakes topics (health, money, law) and long requests get a recommended "second look" with a
   ready prompt for another AI.
4. **Dashboard**: `GET /dashboard` gives the agents with what each is doing now, what needs you, and recent tasks.

## What the screen shows

Home is the dashboard. At the top, one large box ("What do you want done?") with example prompts, and as you type a calm "How I'll handle
this" panel showing the steps AIOS will take and the ones it skipped. Below: **Needs you** (approvals and decisions), **Your agents**
(Claude, Gemini, Perplexity, Antigravity, each with a status and what it is doing), **Recent** tasks, and your Universe map. A task opens
as a single timeline with the answer or result at the top and the technical detail (diffs, checks, runs) one click away. Plain words
first; everything technical is still there for people who want it.

## Boundaries and honesty

- Triage can only choose among steps that already exist and are already guarded. It cannot grant a permission.
- `build` needs a project and a check command; without them AIOS says so and offers "Just answer in chat".
- Steps that need you to paste into another AI are shown as yours, never as done.
- A wrong guess is cheap: the plan is shown before anything starts, and any task can be restarted with a different choice.
